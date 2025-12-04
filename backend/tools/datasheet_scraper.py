#!/usr/bin/env python3
"""
Universal Datasheet Scraper

Scrapes datasheets from multiple sources:
1. Manufacturer websites (TI, Analog Devices, Microchip, etc.)
2. alldatasheet.com (fallback with CAPTCHA handling)
3. Distributor sites (Mouser, Digi-Key) as last resort

Handles:
- Multiple manufacturers
- CAPTCHA detection and bypass
- Retry logic
- PDF validation
"""

import requests
from bs4 import BeautifulSoup
import re
import time
import json
import os
import sys
from pathlib import Path
from typing import Dict, Optional, List, Tuple
from urllib.parse import urljoin, quote
import hashlib

# Add parent directory to path to import utils
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils import get_api_key


class DatasheetScraper:
    """Universal datasheet scraper with fallback sources"""
    
    def __init__(self, output_dir: str = "./datasheets"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # User agent to avoid bot detection
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        }
        
        self.session = requests.Session()
        self.session.headers.update(self.headers)
    
    def identify_manufacturer(self, part_number: str) -> Optional[str]:
        """
        Identify manufacturer from part number prefix
        
        Common prefixes:
        - SN74*, TPS*, LM*, TLV* → Texas Instruments
        - AD*, ADM*, ADP* → Analog Devices
        - MCP*, PIC*, AT* → Microchip
        - STM*, ST* → STMicroelectronics
        - NE555, LM358, etc. → Generic (multiple sources)
        """
        part_upper = part_number.upper()
        
        # Texas Instruments
        if any(part_upper.startswith(prefix) for prefix in ['SN74', 'TPS', 'LM', 'TLV', 'TLC', 'CD40']):
            return 'ti'
        
        # Analog Devices
        if any(part_upper.startswith(prefix) for prefix in ['AD', 'ADM', 'ADP', 'LT', 'MAX']):
            return 'analog'
        
        # Microchip
        if any(part_upper.startswith(prefix) for prefix in ['MCP', 'PIC', 'AT24', 'AT25', 'ATMEGA', 'ATTINY']):
            return 'microchip'
        
        # STMicroelectronics
        if any(part_upper.startswith(prefix) for prefix in ['STM32', 'ST', 'L78', 'L79']):
            return 'st'
        
        # NXP
        if any(part_upper.startswith(prefix) for prefix in ['74HC', '74HCT', 'PCF', 'PCA']):
            return 'nxp'
        
        return None
    
    
    def _validate_datasheet(self, pdf_content: bytes, part_number: str, url: str) -> Tuple[bool, float]:
        """
        Validate if PDF is likely a datasheet
        
        Returns:
            (is_valid, confidence_score)
        """
        score = 0.0
        base_part = part_number.split('-')[0].upper()
        
        # 1. File size check (50KB - 50MB is reasonable for datasheets)
        size_mb = len(pdf_content) / (1024 * 1024)
        if 0.05 < size_mb < 50:
            score += 0.2
        else:
            return False, 0.0  # Reject if size is unreasonable
        
        # 2. Trusted source domains (manufacturer and distributor sites)
        trusted_domains = ['ti.com', 'analog.com', 'mouser.com', 'digikey.com', 
                          'microchip.com', 'st.com', 'nxp.com', 'onsemi.com',
                          'infineon.com', 'renesas.com']
        if any(domain in url.lower() for domain in trusted_domains):
            score += 0.3
        
        # 3. Part number in URL/filename
        if base_part.lower() in url.lower():
            score += 0.2
        
        # 4. Quick content check (first page only for speed)
        try:
            import pdfplumber
            from io import BytesIO
            
            with pdfplumber.open(BytesIO(pdf_content)) as pdf:
                # Page count (datasheets usually 2-200 pages)
                page_count = len(pdf.pages)
                if 2 <= page_count <= 200:
                    score += 0.1
                elif page_count < 2:
                    return False, score  # Too short to be a datasheet
                
                # Check first page for datasheet keywords
                try:
                    first_page = pdf.pages[0].extract_text()
                    if first_page:
                        first_page_lower = first_page.lower()
                        keywords = ['datasheet', 'data sheet', 'specifications', 
                                   'electrical characteristics', 'features',
                                   base_part.lower()]
                        matches = sum(1 for kw in keywords if kw in first_page_lower)
                        score += min(matches * 0.05, 0.2)
                except:
                    pass  # Text extraction failed, skip
        except:
            # pdfplumber failed, but we can still accept based on other criteria
            pass
        
        # Minimum threshold: 0.5 (50% confidence)
        is_valid = score >= 0.5
        return is_valid, score
    
    # TODO: Implement alldatasheet.com-specific scraper
    # def scrape_alldatasheet_with_captcha(self, part_number: str) -> Optional[str]:
    #     """
    #     Scrape from alldatasheet.com with CAPTCHA bypass
    #     
    #     Requirements:
    #     - Use Playwright with stealth mode
    #     - Solve image CAPTCHA (OCR or manual solving service)
    #     - Navigate to: https://www.alldatasheet.com/datasheet-pdf/download/XXXXX/...
    #     - Fill security code form
    #     - Click download button
    #     - Extract PDF from response
    #     
    #     Note: This is complex and may violate alldatasheet.com ToS
    #     Consider using it only as a last resort fallback
    #     """
    #     pass
    
    def tavily_search_datasheet(self, part_number: str) -> Optional[str]:
        """
        Use Tavily search API to find datasheet PDF
        
        Searches multiple results and validates each before accepting
        """
        print(f"  [Tavily] Searching for datasheet...")
        
        try:
            from tavily import TavilyClient
        except ImportError:
            print(f"  [Tavily] tavily-python not installed")
            return None
        
        # Get API key from root .env
        try:
            api_key = get_api_key('TAVILY_API_KEY')
        except ValueError as e:
            print(f"  [Tavily] {e}")
            return None
        
        base_part = part_number.split('-')[0].upper()
        query = f"{base_part} datasheet pdf download"
        
        # Track candidates with scores
        candidates = []
        
        try:
            client = TavilyClient(api_key=api_key)
            
            # Search with Tavily
            response = client.search(
                query=query,
                search_depth="advanced",
                max_results=10,
                include_raw_content=False
            )
            
            if response and 'results' in response:
                for result in response['results']:
                    url = result.get('url', '')
                    title = result.get('title', '')
                    
                    print(f"  [Tavily] Checking: {title[:60]}...")
                    
                    # Look for direct PDF URLs
                    if '.pdf' in url.lower():
                        print(f"  [Tavily] Found PDF: {url[:80]}...")
                        
                        try:
                            # Try with retries for slow servers (like st.com)
                            pdf_response = None
                            for attempt in range(2):  # 2 attempts
                                try:
                                    pdf_response = self.session.get(url, timeout=30, allow_redirects=True)
                                    break
                                except Exception as retry_e:
                                    if attempt == 0:
                                        print(f"  [Tavily] Retry {attempt+1}/2...")
                                        time.sleep(2)
                                    else:
                                        raise retry_e
                            
                            if pdf_response and pdf_response.status_code == 200 and pdf_response.content.startswith(b'%PDF'):
                                # Validate this PDF
                                is_valid, confidence = self._validate_datasheet(
                                    pdf_response.content, part_number, url
                                )
                                
                                if is_valid:
                                    candidates.append({
                                        'content': pdf_response.content,
                                        'url': url,
                                        'confidence': confidence,
                                        'size': len(pdf_response.content)
                                    })
                                    print(f"  [Tavily] ✓ Valid datasheet (confidence: {confidence:.2f})")
                                else:
                                    print(f"  [Tavily] ✗ Invalid datasheet (confidence: {confidence:.2f})")
                        except Exception as e:
                            print(f"  [Tavily] Failed to download: {str(e)[:50]}...")
                            continue
                    
                    # Check if the page might have PDF links
                    elif 'datasheet' in title.lower() or any(domain in url for domain in ['alldatasheet.com', 'analog.com', 'ti.com', 'mouser.com', 'digikey.com']):
                        try:
                            page_response = self.session.get(url, timeout=15)
                            
                            if page_response.status_code == 200:
                                soup = BeautifulSoup(page_response.content, 'html.parser')
                                
                                # Find PDF links on the page
                                # Check for various link patterns
                                pdf_links = []
                                
                                # Method 1: Direct <a> tags with .pdf
                                for link in soup.find_all('a', href=True):
                                    href = link['href']
                                    if '.pdf' in href.lower():
                                        pdf_links.append(urljoin(url, href))
                                
                                # Method 2: Alldatasheet.com specific patterns
                                if 'alldatasheet.com' in url:
                                    # Look for download buttons/links
                                    for link in soup.find_all(['a', 'button']):
                                        text = link.get_text().lower()
                                        href = link.get('href', '')
                                        onclick = link.get('onclick', '')
                                        
                                        if any(keyword in text for keyword in ['download', 'pdf', 'datasheet']):
                                            if href and ('pdf' in href or 'download' in href):
                                                pdf_links.append(urljoin(url, href))
                                        
                                        # Check onclick handlers for PDF URLs
                                        if 'pdf' in onclick.lower():
                                            match = re.search(r'["\']([^"\']*\.pdf[^"\']*)["\']', onclick)
                                            if match:
                                                pdf_links.append(urljoin(url, match.group(1)))
                                
                                # Method 3: Look for iframe with PDF
                                for iframe in soup.find_all('iframe'):
                                    src = iframe.get('src', '')
                                    if '.pdf' in src.lower():
                                        pdf_links.append(urljoin(url, src))
                                
                                # Try each PDF link
                                for pdf_url in pdf_links:
                                    try:
                                        print(f"  [Tavily] Trying PDF link: {pdf_url[:80]}...")
                                        pdf_response = self.session.get(pdf_url, timeout=15, allow_redirects=True)
                                        
                                        if pdf_response.status_code == 200 and pdf_response.content.startswith(b'%PDF'):
                                            # Validate this PDF
                                            is_valid, confidence = self._validate_datasheet(
                                                pdf_response.content, part_number, pdf_url
                                            )
                                            
                                            if is_valid:
                                                candidates.append({
                                                    'content': pdf_response.content,
                                                    'url': pdf_url,
                                                    'confidence': confidence,
                                                    'size': len(pdf_response.content)
                                                })
                                                print(f"  [Tavily] ✓ Valid datasheet from page (confidence: {confidence:.2f})")
                                                break  # Found valid PDF on this page
                                    except Exception as e:
                                        print(f"  [Tavily] Failed PDF link: {str(e)[:40]}...")
                                        continue
                        except Exception as e:
                            print(f"  [Tavily] Failed to parse page: {str(e)[:40]}...")
                            continue
                    
                    # Stop if we have a high-confidence result
                    if candidates and max(c['confidence'] for c in candidates) >= 0.9:
                        break
                
                # Select best candidate
                if candidates:
                    # Sort by confidence (descending)
                    best = max(candidates, key=lambda x: x['confidence'])
                    print(f"  [Tavily] ✓ Selected best datasheet (confidence: {best['confidence']:.2f}, {best['size']} bytes)")
                    return self._save_pdf(best['content'], part_number, 'tavily')
        
        except Exception as e:
            print(f"  [Tavily] ✗ Failed: {e}")
        
        return None
    
    
    def _save_pdf(self, content: bytes, part_number: str, source: str) -> str:
        """
        Save PDF and validate it's actually a PDF
        
        Returns: Path to saved PDF
        """
        # Validate it's a PDF
        if not content.startswith(b'%PDF'):
            raise ValueError("Downloaded file is not a valid PDF")
        
        # Generate filename
        safe_part = re.sub(r'[^\w\-]', '_', part_number)
        filename = f"{safe_part}_{source}.pdf"
        filepath = self.output_dir / filename
        
        # Save
        with open(filepath, 'wb') as f:
            f.write(content)
        
        # Calculate hash for verification
        file_hash = hashlib.md5(content).hexdigest()
        
        print(f"  ✓ Saved: {filepath} ({len(content)} bytes, md5: {file_hash[:8]}...)")
        
        return str(filepath)
    
    def _extract_base_part_number(self, part_number: str) -> str:
        """
        Extract base part number by removing package/temperature suffixes
        
        Examples:
            ST8024LAC -> ST8024
            STM32F107RCT7 -> STM32F107RC
            SN74HC04N -> SN74HC04
            AD8232ACPZ -> AD8232
        """
        import re
        
        # Common suffix patterns to remove
        # Package codes: TR, DR, AC, LAC, T7, N, D, P, etc.
        # Temperature codes: C (commercial), I (industrial), etc.
        
        # Remove trailing package/temp codes (1-3 chars after main part)
        # Keep the core part number
        patterns = [
            r'([A-Z0-9]+?)(?:LAC|TR|DR|CPZ|ACPZ|T7|TA|TB|TC)$',  # Specific suffixes
            r'([A-Z0-9]+?)(?:[A-Z]{1,3})$',  # Generic 1-3 letter suffix
        ]
        
        for pattern in patterns:
            match = re.match(pattern, part_number)
            if match:
                base = match.group(1)
                if len(base) >= 5:  # Ensure we keep meaningful base
                    return base
        
        return part_number
    
    def _extract_product_family(self, part_number: str) -> Optional[str]:
        """
        Extract product family by removing specific variant digits
        
        Examples:
            ST8024 -> ST802x (family)
            STM32F107 -> STM32F1xx (family)
            SN74HC04 -> SN74HC (family)
        """
        import re
        
        # For parts like ST8024, try ST802x
        if re.match(r'^[A-Z]{2}\d{3,4}', part_number):
            # Remove last digit: ST8024 -> ST802
            family = part_number[:-1]
            return family
        
        # For STM32 style: STM32F107 -> STM32F1
        if 'STM32' in part_number:
            match = re.match(r'(STM32[A-Z]\d)', part_number)
            if match:
                return match.group(1)
        
        return None
    
    def scrape(self, part_number: str, manufacturer: Optional[str] = None) -> Dict:
        """
        Main scraping function - tries all sources in order
        
        Returns:
            {
                'success': bool,
                'pdf_path': str or None,
                'source': str or None,
                'manufacturer': str or None,
                'attempts': List[str]
            }
        """
        print(f"\n{'='*70}")
        print(f"SCRAPING DATASHEET: {part_number}")
        print(f"{'='*70}")
        
        # Auto-detect manufacturer if not provided
        if not manufacturer:
            manufacturer = self.identify_manufacturer(part_number)
            if manufacturer:
                print(f"Detected manufacturer: {manufacturer.upper()}")
        
        result = {
            'success': False,
            'pdf_path': None,
            'source': None,
            'manufacturer': manufacturer,
            'attempts': []
        }
        
        # HIERARCHICAL SEARCH STRATEGY (Top-Down Approach)
        # Level 1: Try EXACT part number
        print(f"[Level 1] Searching for exact part number: {part_number}")
        result['attempts'].append('tavily_exact')
        pdf_path = self.tavily_search_datasheet(part_number)
        if pdf_path:
            result['success'] = True
            result['pdf_path'] = pdf_path
            result['source'] = 'tavily_exact'
            return result
        
        # Level 2: Try part number WITHOUT suffix (e.g., ST8024LAC -> ST8024)
        base_part = self._extract_base_part_number(part_number)
        if base_part != part_number:
            print(f"[Level 2] Searching for base part number: {base_part}")
            result['attempts'].append('tavily_base')
            pdf_path = self.tavily_search_datasheet(base_part)
            if pdf_path:
                result['success'] = True
                result['pdf_path'] = pdf_path
                result['source'] = 'tavily_base'
                print(f"  ✓ Found datasheet for base part: {base_part}")
                return result
        
        # Level 3: Try product FAMILY (e.g., ST8024 -> ST802x)
        family = self._extract_product_family(part_number)
        if family and family != base_part:
            print(f"[Level 3] Searching for product family: {family}")
            result['attempts'].append('tavily_family')
            pdf_path = self.tavily_search_datasheet(family)
            if pdf_path:
                result['success'] = True
                result['pdf_path'] = pdf_path
                result['source'] = 'tavily_family'
                print(f"  ✓ Found datasheet for product family: {family}")
                return result
        
        print(f"\n✗ Failed to find datasheet for {part_number}")
        print(f"  Tried: {', '.join(result['attempts'])}")
        
        return result


def main():
    """CLI interface"""
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python datasheet_scraper.py <part_number> [manufacturer]")
        print("\nExamples:")
        print("  python datasheet_scraper.py SN74HC04")
        print("  python datasheet_scraper.py AD8232 analog")
        print("  python datasheet_scraper.py MCP3008")
        sys.exit(1)
    
    part_number = sys.argv[1]
    manufacturer = sys.argv[2] if len(sys.argv) > 2 else None
    
    scraper = DatasheetScraper()
    result = scraper.scrape(part_number, manufacturer)
    
    print(f"\n{'='*70}")
    print("RESULT:")
    print(json.dumps(result, indent=2))
    print(f"{'='*70}")
    
    if result['success']:
        print(f"\n✓ Success! Datasheet saved to: {result['pdf_path']}")
        sys.exit(0)
    else:
        print(f"\n✗ Failed to download datasheet")
        sys.exit(1)


if __name__ == '__main__':
    main()

