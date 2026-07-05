#!/usr/bin/env python3
"""
Conversational Agent using Gemini
Handles natural language conversations, maintains chat memory, and decides when to use tools
"""

import google.generativeai as genai
from typing import List, Dict, Optional, Tuple
from pathlib import Path
import json
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils import get_api_key

class ConversationalAgent:
    """Agent that maintains conversation context and can trigger detection pipelines"""
    
    def __init__(self):
        api_key = get_api_key('GEMINI_API_KEY')
        genai.configure(api_key=api_key)
        from utils.gemini_fallback import FallbackGenerativeModel
        self.model = FallbackGenerativeModel('gemini-2.5-flash')  # Using 2.5 flash for conversation
        self.chat_sessions = {}  # Store chat histories per session
    
    def chat(self, 
             message: str, 
             session_id: str,
             chat_history: Optional[List[Dict]] = None,
             has_image: bool = False,
             image_path: Optional[str] = None) -> Dict:
        """
        Handle conversational query with context awareness
        
        Args:
            message: User's message
            session_id: Unique session identifier
            chat_history: Previous messages in format [{"role": "user/bot", "content": "..."}]
            has_image: Whether user attached an image
            image_path: Path to image if has_image is True
            
        Returns:
            {
                "response": str,
                "should_trigger_detection": bool,
                "reasoning": str
            }
        """
        # Initialize or retrieve chat history for this session
        if session_id not in self.chat_sessions:
            self.chat_sessions[session_id] = []
        
        # Add system prompt
        if not self.chat_sessions[session_id]:
            system_prompt = """You are an expert assistant specialized in counterfeit IC detection. 
You help users analyze integrated circuits (ICs) for authenticity.

Your capabilities:
1. Answer questions about IC detection, electronics, and counterfeit detection methods
2. Trigger IC detection analysis when users upload images
3. Explain detection results and answer follow-up questions
4. Provide general guidance about IC authentication

When a user uploads an image, you should acknowledge it and indicate that detection will start.
When answering questions, be conversational, helpful, and use the chat history for context.
If asked about a previous detection, reference the specific results from that detection.

Be natural and conversational - greet users, answer questions, and guide them through the detection process."""
            
            self.chat_sessions[session_id].append({
                "role": "user",
                "parts": [system_prompt]
            })
            self.chat_sessions[session_id].append({
                "role": "model",
                "parts": ["I understand. I'm ready to help with IC detection and answer your questions. How can I assist you?"]
            })
        
        # Add user message to history
        user_parts = [message]
        if has_image and image_path:
            try:
                from PIL import Image
                img = Image.open(image_path)
                user_parts.append(img)
            except Exception as e:
                print(f"[Agent] Failed to load image: {e}")
        
        self.chat_sessions[session_id].append({
            "role": "user",
            "parts": user_parts
        })
        
        # Generate response
        try:
            chat = self.model.start_chat(history=self.chat_sessions[session_id][:-1])  # Exclude current message
            response = chat.send_message(user_parts)
            response_text = response.text
            
            # Determine if detection should be triggered
            should_trigger_detection = has_image or self._should_trigger_detection(message, response_text)
            
            # Add model response to history
            self.chat_sessions[session_id].append({
                "role": "model",
                "parts": [response_text]
            })
            
            return {
                "response": response_text,
                "should_trigger_detection": should_trigger_detection,
                "reasoning": "Image detected" if has_image else "User query requires detection analysis"
            }
            
        except Exception as e:
            print(f"[Agent] Error generating response: {e}")
            return {
                "response": "I apologize, but I encountered an error processing your request. Please try again.",
                "should_trigger_detection": has_image,
                "reasoning": str(e)
            }
    
    def _should_trigger_detection(self, message: str, response: str) -> bool:
        """Determine if detection pipeline should be triggered based on message"""
        message_lower = message.lower()
        
        # Keywords that suggest detection is needed
        detection_keywords = [
            "analyze", "detect", "check", "verify", "authentic", "counterfeit",
            "examine", "inspect", "test", "validate", "identify"
        ]
        
        # Check if message contains detection-related keywords
        return any(keyword in message_lower for keyword in detection_keywords)
    
    def get_chat_history(self, session_id: str) -> List[Dict]:
        """Get chat history for a session"""
        return self.chat_sessions.get(session_id, [])
    
    def clear_session(self, session_id: str):
        """Clear chat history for a session"""
        if session_id in self.chat_sessions:
            del self.chat_sessions[session_id]

# Global agent instance
_agent = None

def get_agent() -> ConversationalAgent:
    """Get or create global agent instance"""
    global _agent
    if _agent is None:
        _agent = ConversationalAgent()
    return _agent

