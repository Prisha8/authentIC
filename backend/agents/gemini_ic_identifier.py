#!/usr/bin/env python3
"""
Gemini Flash 2.5 - IC Identification Agent

Test if Gemini can:
1. Identify the IC part number
2. Identify manufacturer
3. Provide search terms for datasheet lookup
"""

import google.generativeai as genai
import json
import os
import sys
from pathlib import Path
from PIL import Image
import time
from google.api_core import exceptions

# Add parent directory to path to import utils
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils import get_api_key


def setup_gemini(api_key: str):
    """Configure Gemini API"""
    genai.configure(api_key=api_key)
    
    # Use Gemini 2.5 Flash (free tier: 15 RPM, 1M TPM, 1500 RPD)
    # Model name for 2.5 flash
    model = genai.GenerativeModel('gemini-2.5-flash')
    return model


def identify_ic(model, image_path: str) -> dict:
    """
    Ask Gemini to identify IC and provide datasheet search info
    """
    
    # Load image and ensure it's fully in memory (not tied to file handle)
    # Open, convert, and copy to ensure no file handle is retained
    try:
        with Image.open(image_path) as img_file:
            # Convert to RGB and ensure image is loaded into memory
            img_rgb = img_file.convert('RGB')
            # Copy the image to create a new object independent of the file
            img = img_rgb.copy()
            # Force load all pixel data into memory
            img.load()
    except Exception as e:
        raise IOError(f"Failed to load image from {image_path}: {e}")
    
    prompt = """
You are an expert electronics engineer specializing in integrated circuit identification.

Analyze this IC (Integrated Circuit) image carefully and extract ALL visible information:

1. **Part Number**: The main part number/model number visible on the IC
2. **Manufacturer**: The company that made this IC (look for logos, brand names, or manufacturer codes)
3. **Package Type**: The physical package type (e.g., DIP, SOIC, QFP, QFN, TQFP, etc.)
4. **Pin Count**: How many pins does this IC have? (count carefully)
5. **Date Codes**: Extract any date codes (typically YYWW format like 2345 = year 2023, week 45, or YYMM format)
6. **Lot Codes**: Extract lot/batch codes (alphanumeric codes identifying manufacturing batch)
7. **Country Codes**: Extract country of origin codes (e.g., "PH" for Philippines, "MY" for Malaysia, "CN" for China)
8. **Temperature Grade**: Extract temperature grade codes (e.g., "I" for industrial, "C" for commercial, "M" for military)
9. **Speed Grade**: Extract speed/performance grade codes if visible
10. **Package Variant**: Extract package variant codes (e.g., "AU", "MU", "RC" suffixes)
11. **Additional Markings**: Any other text, symbols, or codes visible
12. **Visible Condition**: Brief assessment of the IC's physical condition

For date codes, decode them:
- YYWW format: First 2 digits = year (00-99, typically 00-23 = 2000-2023), last 2 digits = week (01-52)
- YYMM format: First 2 digits = year, last 2 digits = month (01-12)
- Provide both raw code and decoded meaning

For lot codes, provide the raw code and explain what it typically represents (manufacturing batch/traceability)

Then provide:
13. **Datasheet Search Query**: The exact search terms to use to find the official datasheet
14. **Expected Datasheet URL Pattern**: What the official datasheet URL might look like

Return your analysis as a JSON object with the following structure:
{
  "part_number": "exact part number",
  "manufacturer": "manufacturer name",
  "package_type": "package type",
  "pin_count": number,
  "date_codes": [
    {
      "raw": "2345",
      "decoded": "Year 2023, Week 45",
      "format": "YYWW",
      "location": "description of where on IC"
    }
  ],
  "lot_codes": [
    {
      "raw": "ABC123",
      "meaning": "Manufacturing batch/traceability code",
      "location": "description of where on IC"
    }
  ],
  "country_codes": ["PH", "MY", etc.],
  "temperature_grade": "I/C/M/etc.",
  "speed_grade": "speed code if visible",
  "package_variant": "variant suffix if visible",
  "additional_markings": [
    {
      "text": "marking text",
      "type": "description of what it is",
      "location": "where on IC",
      "decoded": "decoded meaning if applicable"
    }
  ],
  "condition_notes": "brief condition assessment",
  "datasheet_search": {
    "primary_query": "best search query",
    "alternative_queries": ["alternative query 1", "alternative query 2"],
    "expected_url_pattern": "e.g., https://www.ti.com/lit/ds/..."
  },
  "confidence": {
    "part_number": "high/medium/low",
    "manufacturer": "high/medium/low",
    "overall": "high/medium/low"
  },
  "reasoning": "Brief explanation of how you identified these details"
}

Important:
- Extract EVERYTHING visible on the IC - don't skip any markings
- Decode date codes, lot codes, and other codes when possible
- Be precise with part numbers (they are critical for finding the right datasheet)
- Look carefully at manufacturer logos or text
- Count pins carefully (especially important for package identification)
- Provide decoded meanings for all codes you extract
"""

    # Generate response with retry logic
    max_retries = 3
    retry_delay = 60  # seconds
    
    for attempt in range(max_retries):
        try:
            response = model.generate_content([prompt, img])
            response_text = response.text
            break
        except exceptions.ResourceExhausted as e:
            if attempt < max_retries - 1:
                print(f"\n⏳ Rate limit hit. Waiting {retry_delay} seconds before retry {attempt + 2}/{max_retries}...")
                time.sleep(retry_delay)
            else:
                print(f"\n❌ Rate limit exceeded after {max_retries} attempts.")
                print(f"Error: {str(e)}")
                return {"error": "Rate limit exceeded", "message": str(e)}
        except Exception as e:
            print(f"\n❌ Error: {str(e)}")
            return {"error": "API error", "message": str(e)}
    
    # Extract JSON from markdown code blocks if present
    if "```json" in response_text:
        json_start = response_text.find("```json") + 7
        json_end = response_text.find("```", json_start)
        json_text = response_text[json_start:json_end].strip()
    elif "```" in response_text:
        json_start = response_text.find("```") + 3
        json_end = response_text.find("```", json_start)
        json_text = response_text[json_start:json_end].strip()
    else:
        json_text = response_text.strip()
    
    try:
        result = json.loads(json_text)
        return result
    except json.JSONDecodeError as e:
        print(f"Failed to parse JSON: {e}")
        print(f"Raw response: {response_text}")
        return {"error": "Failed to parse response", "raw_response": response_text}


def test_identification(api_key: str, image_path: str):
    """Test IC identification on a sample image"""
    
    print("=" * 70)
    print("GEMINI FLASH 2.5 - IC IDENTIFICATION TEST")
    print("=" * 70)
    print(f"\nAnalyzing: {image_path}\n")
    
    # Setup
    model = setup_gemini(api_key)
    
    # Identify
    print("🔍 Sending to Gemini...")
    result = identify_ic(model, image_path)
    
    # Display results
    print("\n" + "=" * 70)
    print("IDENTIFICATION RESULTS")
    print("=" * 70)
    
    if "error" in result:
        print(f"\n❌ Error: {result['error']}")
        print(f"\nRaw response:\n{result.get('raw_response', '')}")
        return result
    
    print(f"\n📦 Part Number: {result.get('part_number', 'N/A')}")
    print(f"🏭 Manufacturer: {result.get('manufacturer', 'N/A')}")
    print(f"📐 Package Type: {result.get('package_type', 'N/A')}")
    print(f"📍 Pin Count: {result.get('pin_count', 'N/A')}")
    
    if result.get('additional_markings'):
        print(f"\n📝 Additional Markings:")
        for marking in result['additional_markings']:
            print(f"   - {marking}")
    
    print(f"\n🔍 Condition: {result.get('condition_notes', 'N/A')}")
    
    # Datasheet search info
    if 'datasheet_search' in result:
        print(f"\n📚 DATASHEET SEARCH INFO:")
        print(f"   Primary Query: {result['datasheet_search'].get('primary_query', 'N/A')}")
        if result['datasheet_search'].get('alternative_queries'):
            print(f"   Alternative Queries:")
            for alt in result['datasheet_search']['alternative_queries']:
                print(f"      - {alt}")
        print(f"   Expected URL: {result['datasheet_search'].get('expected_url_pattern', 'N/A')}")
    
    # Confidence
    if 'confidence' in result:
        print(f"\n✅ CONFIDENCE LEVELS:")
        print(f"   Part Number: {result['confidence'].get('part_number', 'N/A')}")
        print(f"   Manufacturer: {result['confidence'].get('manufacturer', 'N/A')}")
        print(f"   Overall: {result['confidence'].get('overall', 'N/A')}")
    
    # Reasoning
    if 'reasoning' in result:
        print(f"\n💭 REASONING:")
        print(f"   {result['reasoning']}")
    
    print("\n" + "=" * 70)
    
    # Save results
    output_path = image_path.replace('.png', '_gemini_identification.json')
    with open(output_path, 'w') as f:
        json.dump(result, f, indent=2)
    print(f"\n✅ Results saved to: {output_path}")
    
    return result


if __name__ == '__main__':
    
    # Get API key from root .env
    try:
        API_KEY = get_api_key('GEMINI_API_KEY')
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)
    
    if len(sys.argv) < 2:
        print("Usage: python gemini_ic_identifier.py <ic_image.png>")
        print("\nTrying with default test image...")
        
        # Try to find a test image
        test_images = [
            "/Users/shnjnmkkr/Desktop/SIH again/counterfeit_IC/backend/matching/dataset/TrainingData/Authentic/A-D-08DIP-12-18F.png",
            "/Users/shnjnmkkr/Desktop/SIH again/counterfeit_IC/backend/matching/dataset/TestingData/Counterfeit/C-O-08DIP-17-06F.png"
        ]
        
        for img_path in test_images:
            if Path(img_path).exists():
                print(f"Found test image: {img_path}\n")
                result = test_identification(API_KEY, img_path)
                break
        else:
            print("No test images found. Please provide an image path.")
            sys.exit(1)
    else:
        image_path = sys.argv[1]
        result = test_identification(API_KEY, image_path)

