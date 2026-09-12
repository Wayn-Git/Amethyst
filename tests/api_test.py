import os
import requests

api_key = "cpk_2fa4875787ea4e0cbf6b6b307fdcc57a.c5872b8310bc5012bf720e547404f6bb.B7gM5mZTNTRQWpwW0reGPVbvg6GKGrBq"
url = "https://llm.chutes.ai/v1/chat/completions"
headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json",
}
data = {
    "model": "google/gemma-4-31B-turbo-TEE",
    "messages": [
        {
            "role": "user",
            "content": "Hello!"
        }
    ],
    "stream": True,
    "max_tokens": 1024,
    "temperature": 0.7
}

import json

response = requests.request("POST", url, headers=headers, json=data, stream=True)
response.raise_for_status()

for line in response.iter_lines():
    if not line:
        continue
    line = line.decode("utf-8")
    if not line.startswith("data: "):
        continue
    chunk = line[6:]
    if chunk == "[DONE]":
        break
    try:
        choices = json.loads(chunk).get("choices") or []
    except json.JSONDecodeError:
        continue
    if not choices:
        continue
    content = choices[0].get("delta", {}).get("content")
    if content:
        print(content, end="", flush=True)
print()