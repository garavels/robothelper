#!/usr/bin/env python3
"""
Test script to check InterHuman API connectivity
"""
import asyncio
import os
import sys
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

API_KEY = os.getenv("INTERHUMAN_API_KEY", "")
WS_URL = "wss://api.interhuman.ai/v1/stream/analyze"

async def test_interhuman():
    print(f"Testing InterHuman API connection...")
    print(f"API Key: {API_KEY[:20]}...{API_KEY[-10:] if len(API_KEY) > 30 else API_KEY}")
    print(f"WebSocket URL: {WS_URL}")
    
    if not API_KEY:
        print("❌ No INTERHUMAN_API_KEY found in .env")
        return False
    
    try:
        import websockets
        print("✅ websockets library is installed")
    except ImportError:
        print("❌ websockets library not installed. Install with: pip install websockets")
        return False
    
    headers = {"Authorization": f"Bearer {API_KEY}"}
    
    # Try different connection methods
    methods = [
        {"additional_headers": headers, "max_size": None},
        {"extra_headers": headers, "max_size": None},
        {"subprotocols": [API_KEY], "max_size": None},
    ]
    
    for i, kwargs in enumerate(methods, 1):
        print(f"\n--- Attempt {i} ---")
        print(f"Method: {kwargs}")
        try:
            async with websockets.connect(WS_URL, **kwargs) as ws:
                print("✅ Connection successful!")
                print(f"Connected to: {ws.remote_address}")
                
                # Try to send a config message
                try:
                    import json
                    config = {"include": ["conversation_quality_overall"]}
                    await ws.send(json.dumps(config))
                    print("✅ Config message sent successfully")
                    
                    # Wait for a response with timeout
                    try:
                        response = await asyncio.wait_for(ws.recv(), timeout=5.0)
                        print(f"✅ Received response: {response[:100]}...")
                        return True
                    except asyncio.TimeoutError:
                        print("⚠️ No response received within 5 seconds (might be normal)")
                        return True
                        
                except Exception as e:
                    print(f"⚠️ Could not send config message: {e}")
                    return True  # Connection worked, even if config failed
                    
        except TypeError as e:
            print(f"❌ TypeError (wrong parameters): {e}")
            continue
        except Exception as e:
            print(f"❌ Connection failed: {type(e).__name__}: {e}")
            if i == len(methods):
                return False
            continue
    
    return False

if __name__ == "__main__":
    try:
        result = asyncio.run(test_interhuman())
        if result:
            print("\n✅ InterHuman API connection test PASSED")
            sys.exit(0)
        else:
            print("\n❌ InterHuman API connection test FAILED")
            sys.exit(1)
    except KeyboardInterrupt:
        print("\n⚠️ Test interrupted")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Test failed with error: {e}")
        sys.exit(1)