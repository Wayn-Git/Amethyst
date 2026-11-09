import requests
import json
import re
import subprocess

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

print("=== 1. TIKTOK DEEP ===")
tt_url = "https://www.tiktok.com/@scout2015/video/6718335390845095173"
r = requests.get(f"https://www.tiktok.com/oembed?url={tt_url}", headers=headers)
print("TikTok oEmbed raw text[:200]:", repr(r.text[:200]))
try:
    print("TikTok oEmbed parsed JSON:", r.json().get("title"))
except Exception as e:
    print("TikTok oEmbed json decode error:", e)

# Test TikTok with yt-dlp to see how yt-dlp extracts it
p = subprocess.run([".venv/bin/yt-dlp", "--dump-json", tt_url], capture_output=True, text=True)
if p.returncode == 0:
    tt_meta = json.loads(p.stdout)
    print("yt-dlp TikTok success:")
    print("  title/desc:", tt_meta.get("title"), "/", tt_meta.get("description"))
    print("  uploader:", tt_meta.get("uploader"))
    print("  track/artist:", tt_meta.get("track"), "/", tt_meta.get("artist"))
    print("  formats count:", len(tt_meta.get("formats", [])))
    print("  sample format url:", tt_meta.get("url")[:80] if tt_meta.get("url") else None)
else:
    print("yt-dlp TikTok error:", p.stderr[:200])

print("\n=== 2. X (TWITTER) DEEP ===")
x_url_1 = "https://x.com/kobelilitan/status/1980901763269214653"
x_url_2 = "https://x.com/kawaiyusukeno3/status/1932402723233890575"
for xu in [x_url_1, x_url_2]:
    print(f"Testing X URL: {xu}")
    # Test vxtwitter / fxtwitter public API (widely used in mobile/open source)
    fx_url = xu.replace("x.com", "api.fxtwitter.com")
    try:
        r_fx = requests.get(fx_url, headers=headers, timeout=5)
        print(f"  fxtwitter API status: {r_fx.status_code}")
        if r_fx.status_code == 200:
            fx_data = r_fx.json()
            tweet = fx_data.get("tweet", {})
            print("  fxtwitter text:", tweet.get("text")[:100] if tweet.get("text") else None)
            print("  fxtwitter media:", tweet.get("media"))
    except Exception as e:
        print("  fxtwitter error:", e)

    p = subprocess.run([".venv/bin/yt-dlp", "--dump-json", xu], capture_output=True, text=True)
    if p.returncode == 0:
        x_meta = json.loads(p.stdout)
        print("  yt-dlp X success:")
        print("    title/desc:", x_meta.get("description") or x_meta.get("title"))
        print("    uploader:", x_meta.get("uploader"))
        print("    url:", x_meta.get("url")[:80] if x_meta.get("url") else None)
    else:
        print("  yt-dlp X error:", p.stderr[:200])

print("\n=== 3. REDDIT DEEP ===")
reddit_url = "https://www.reddit.com/r/maybemaybemaybe/comments/1uxyyp0/maybe_maybe_maybe/"
# Reddit requires a custom User-Agent in specific format: <platform>:<app ID>:<version> (by /u/<username>)
reddit_headers = {"User-Agent": "android:app.amethyst.companion:v1.0 (by /u/amethyst_app)"}
r_red = requests.get(reddit_url.rstrip("/") + ".json", headers=reddit_headers, timeout=10)
print(f"Reddit .json with app User-Agent status: {r_red.status_code}")
if r_red.status_code == 200:
    red_data = r_red.json()
    post = red_data[0]["data"]["children"][0]["data"]
    print("Reddit post title:", post.get("title"))
    media = post.get("secure_media") or post.get("media") or {}
    print("Reddit video fallback_url:", media.get("reddit_video", {}).get("fallback_url"))
    print("Reddit audio URL:", media.get("reddit_video", {}).get("fallback_url", "").split("?")[0].rsplit("/", 1)[0] + "/DASH_AUDIO_128.mp4")

p = subprocess.run([".venv/bin/yt-dlp", "--dump-json", reddit_url], capture_output=True, text=True)
if p.returncode == 0:
    red_meta = json.loads(p.stdout)
    print("yt-dlp Reddit success:")
    print("  title:", red_meta.get("title"))
    print("  url:", red_meta.get("url")[:80] if red_meta.get("url") else None)
else:
    print("yt-dlp Reddit error:", p.stderr[:200])

print("\n=== 4. FACEBOOK REELS DEEP ===")
fb_reels = [
    "https://www.facebook.com/reel/2277713513083702",
    "https://www.facebook.com/reel/1737837581070505",
    "https://www.facebook.com/reel/923758310489811",
]
for fbu in fb_reels:
    print(f"Testing FB: {fbu}")
    p = subprocess.run([".venv/bin/yt-dlp", "--dump-json", fbu], capture_output=True, text=True)
    if p.returncode == 0:
        fb_meta = json.loads(p.stdout)
        print("  yt-dlp FB success:")
        print("    title:", fb_meta.get("title") or fb_meta.get("description"))
        print("    uploader:", fb_meta.get("uploader"))
        print("    url:", fb_meta.get("url")[:80] if fb_meta.get("url") else None)
    else:
        print("  yt-dlp FB error:", p.stderr[:200])

