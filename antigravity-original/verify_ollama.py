import urllib.request
import urllib.error
import json
import sys

def test_ollama(host, model):
    print(f"Testing connection to {host} with model '{model}'...")
    
    # Robust Host Normalization
    host = host.strip().rstrip('/')
    for suffix in ["/api/generate", "/api/tags", "/api/chat"]:
        if host.endswith(suffix):
            host = host[:-len(suffix)]
    
    # 1. Test Tags Endpoint (List Models)
    try:
        print("1. Fetching models...")
        with urllib.request.urlopen(f"{host}/api/tags", timeout=5) as response:
            data = json.loads(response.read().decode('utf-8'))
            models = [m['name'] for m in data.get('models', [])]
            print(f"   Success! Found models: {models}")
            if model not in models:
                print(f"   WARNING: Model '{model}' not found in list.")
    except Exception as e:
        print(f"   Failed to fetch models: {e}")

    # 2. Test Generate Endpoint (Chat)
    try:
        print(f"2. Sending prompt to model '{model}'...")
        url = f"{host}/api/generate"
        data = {
            "model": model,
            "prompt": "Hello",
            "stream": False
        }
        req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
        # Increased timeout to 120s
        with urllib.request.urlopen(req, timeout=120) as response:
            result = json.loads(response.read().decode('utf-8'))
            print(f"   Success! Response: {result.get('response', '')[:50]}...")
            
    except urllib.error.HTTPError as e:
        print(f"   HTTP Error: {e.code} {e.reason}")
        try:
            error_body = e.read().decode('utf-8')
            print(f"   Error Body: {error_body}")
        except:
            pass
    except Exception as e:
        print(f"   Error: {e}")

if __name__ == "__main__":
    # Default values
    HOST = "http://localhost:11434"
    MODEL = "llama3"
    
    if len(sys.argv) > 1:
        HOST = sys.argv[1]
    if len(sys.argv) > 2:
        MODEL = sys.argv[2]
        
    test_ollama(HOST, MODEL)
