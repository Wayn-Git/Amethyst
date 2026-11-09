import requests
import json
import re
import time

urls = [
    "https://www.instagram.com/reel/DV79WToDXwb/",
    "https://www.instagram.com/reel/DVlQSpfk8tl/",
]

headers = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

print("=== 1. Testing Instagram Official oEmbed ===")
# Meta deprecated unauthenticated oEmbed in October 2020. Testing if public oEmbed works:
for u in urls:
    oembed_url = f"https://api.instagram.com/oembed/?url={u}"
    try:
        r = requests.get(oembed_url, timeout=5)
        print(f"oEmbed status for {u}: {r.status_code}")
        print(f"oEmbed response: {r.text[:200]}")
    except Exception as e:
        print(f"oEmbed error: {e}")

print("\n=== 2. Testing /embed/captioned/ and /embed/ plain HTTP ===")
for u in urls:
    shortcode = u.strip("/").split("/")[-1]
    embed_url = f"https://www.instagram.com/p/{shortcode}/embed/captioned/"
    r = requests.get(embed_url, headers=headers, timeout=10)
    print(f"\nShortcode: {shortcode}, Embed Status: {r.status_code}, Length: {len(r.text)}")
    
    # Check if redirect to login or error
    if "login" in r.url:
        print("Redirected to login!")
    elif "httpErrorPage" in r.text:
        print("Embed served httpErrorPage (blocked / not found without session)")
    else:
        print("Embed served normal page")
        
    # Check for Caption
    cap_match = re.findall(r'<div class="Caption">([\s\S]*?)</div>', r.text)
    if cap_match:
        print(f"Caption found: {cap_match[0][:100]}")
    else:
        # Check text in body
        print("No <div class='Caption'> found.")

    # Check for media / video / mp4
    mp4s = re.findall(r'https?://[^\s\"\'\<\>]+(?:\.mp4|\.m4a)[^\s\"\'\<\>]*', r.text)
    print(f"Direct media URLs found in embed: {len(mp4s)}")
    
    # Check for music / audio attribution
    music_matches = re.findall(r'(?:music_metadata|clips_music_attribution_info|audio_asset_id|song_name|artist_name)', r.text)
    print(f"Music attribution tokens found: {set(music_matches)}")

print("\n=== 3. Testing Direct Reel Page plain HTTP ===")
for u in urls:
    r = requests.get(u, headers=headers, timeout=10)
    print(f"\nReel URL: {u}, Status: {r.status_code}, Final URL: {r.url}, Length: {len(r.text)}")
    if "/accounts/login" in r.url:
        print("Redirected to /accounts/login - direct page blocked by login gate!")
    else:
        # Check if login wall inside HTML
        if "Login • Instagram" in r.text or "login" in r.text.lower() and len(r.text) < 10000:
            print("Login wall served in HTML body.")
        else:
            print(f"Page title or content sample: {r.text[:300]}")
            mp4s = re.findall(r'https?://[^\s\"\'\<\>]+(?:\.mp4|\.m4a)[^\s\"\'\<\>]*', r.text)
            print(f"Direct media URLs found in direct page: {len(mp4s)}")

