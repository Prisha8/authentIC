"""
Utility functions for backend scripts
"""

import os
from pathlib import Path


def load_env():
    """
    Load environment variables from root .env file
    
    This ensures all backend scripts use the same .env file as the frontend
    """
    # Get the root directory (parent of backend/)
    backend_dir = Path(__file__).parent.parent
    root_dir = backend_dir.parent
    env_file = root_dir / '.env'
    
    if not env_file.exists():
        print(f"Warning: .env file not found at {env_file}")
        return
    
    # Read and parse .env file
    with open(env_file, 'r') as f:
        for line in f:
            line = line.strip()
            
            # Skip comments and empty lines
            if not line or line.startswith('#'):
                continue
            
            # Parse KEY=VALUE
            if '=' in line:
                key, value = line.split('=', 1)
                key = key.strip()
                value = value.strip()
                
                # Set environment variable if not already set
                if key and not os.getenv(key):
                    os.environ[key] = value


def get_api_key(key_name: str) -> str:
    """
    Get API key from environment, loading .env if needed
    
    Args:
        key_name: Name of the API key (e.g., 'GEMINI_API_KEY')
    
    Returns:
        API key value
    
    Raises:
        ValueError if key is not found
    """
    load_env()
    
    value = os.getenv(key_name)
    if not value:
        raise ValueError(f"{key_name} not found in environment. Please set it in .env file at project root.")
    
    return value
