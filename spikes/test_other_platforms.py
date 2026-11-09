import requests
import json
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

print("==================== 1. TIKTOK ====================")
tt_url = "https://www.tiktok.com/@scout2015/video/6718335390845095173"
# Official oEmbed: https://www.tiktok.com/oembed?url=...
try:
    r = requests.get(f"https://www.tiktok.com/oembed?url={tt_url}", headers=headers, timeout=10)
    print(f"TikTok oEmbed Status: {r.status_code}")
    if r.status_code == 200:
        data = r.json()
        print("TikTok oEmbed keys:", list(data.keys()))
        print("Title/Caption:", data.get("title"))
        print("Author:", data.get("author_name"))
        print("HTML embed snippet:", data.get("html")[:100])
except Exception as e:
    print(f"TikTok oEmbed error: {e}")

# Check TikTok direct page for __UNIVERSAL_DATA_FOR_REHYDRATION__ or SIGI_STATE
try:
    r = requests.get(tt_url, headers=headers, timeout=10)
    print(f"TikTok Direct HTML Status: {r.status_code}, Length: {len(r.text)}")
    m = re.search(r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)</script>', r.text)
    if m:
        tt_json = json.loads(m.group(1))
        default_scope = tt_json.get("__DEFAULT_SCOPE__", {})
        detail = default_scope.get("webapp.video-detail", {}).get("itemInfo", {}).get("itemStruct", {})
        print("Found Universal Data! Video Detail Keys:", list(detail.keys()))
        print("Caption:", detail.get("desc"))
        music = detail.get("music", {})
        print("Music attribution:", {"title": music.get("title"), "author": music.get("authorName"), "original": music.get("original")})
        video = detail.get("video", {})
        print("Direct PlayAddr:", video.get("playAddr", "")[:80])
        print("DownloadAddr:", video.get("downloadAddr", "")[:80])
except Exception as e:
    print(f"TikTok Direct HTML error: {e}")

print("\n==================== 2. X (TWITTER) ====================")
x_url = "https://x.com/kobelilitan/status/1980901763269214653"
# Official publish oEmbed: https://publish.twitter.com/oembed?url=...
try:
    r = requests.get(f"https://publish.twitter.com/oembed?url={x_url}", headers=headers, timeout=10)
    print(f"X publish oEmbed Status: {r.status_code}")
    if r.status_code == 200:
        data = r.json()
        print("X oEmbed keys:", list(data.keys()))
        print("Author:", data.get("author_name"))
        print("HTML snippet:", data.get("html")[:150])
except Exception as e:
    print(f"X oEmbed error: {e}")

# Syndication API: https://cdn.syndication.twimg.com/tweet-result?id=...
try:
    tweet_id = "1980901763269214653"
    r = requests.get(f"https://cdn.syndication.twimg.com/tweet-result?id={tweet_id}&token=x", headers=headers, timeout=10)
    print(f"X Syndication API Status: {r.status_code}")
    if r.status_code == 200:
        data = r.json()
        print("Syndication keys:", list(data.keys()))
        print("Text:", data.get("text"))
        print("Media:", [m.get("type") for m in data.get("mediaDetails", [])])
        for m in data.get("mediaDetails", []):
            if "video_info" in m:
                variants = m["video_info"].get("variants", [])
                print("Video variants:", [(v.get("content_type"), v.get("bitrate"), v.get("url")[:60]) for v in variants])
except Exception as e:
    print(f"X Syndication error: {e}")

print("\n==================== 3. YOUTUBE ====================")
yt_url = "https://www.youtube.com/shorts/5RFnufJ39H8"
# Official oEmbed: https://www.youtube.com/oembed?url=...&format=json
try:
    r = requests.get(f"https://www.youtube.com/oembed?url={yt_url}&format=json", headers=headers, timeout=10)
    print(f"YouTube oEmbed Status: {r.status_code}")
    if r.status_code == 200:
        data = r.json()
        print("YouTube oEmbed keys:", list(data.keys()))
        print("Title:", data.get("title"))
        print("Author:", data.get("author_name"))
except Exception as e:
    print(f"YouTube oEmbed error: {e}")

print("\n==================== 4. REDDIT ====================")
reddit_url = "https://www.reddit.com/r/maybemaybemaybe/comments/1uxyyp0/maybe_maybe_maybe/"
# Official oEmbed: https://www.reddit.com/oembed?url=...
try:
    r = requests.get(f"https://www.reddit.com/oembed?url={reddit_url}", headers=headers, timeout=10)
    print(f"Reddit oEmbed Status: {r.status_code}")
    if r.status_code == 200:
        data = r.json()
        print("Reddit oEmbed keys:", list(data.keys()))
        print("Title:", data.get("title"))
        print("Author:", data.get("author_name"))
except Exception as e:
    print(f"Reddit oEmbed error: {e}")

# Reddit JSON endpoint: append .json to URL
try:
    json_url = reddit_url.rstrip("/") + ".json"
    r = requests.get(json_url, headers={"User-Agent": "AmethystBot/1.0"}, timeout=10)
    print(f"Reddit .json endpoint Status: {r.status_code}")
    if r.status_code == 200:
        data = r.json()
        post = data[0]["data"]["children"][0]["data"]
        print("Reddit Post keys:", ["title", "selftext", "media", "secure_media", "url_overridden_by_dest"])
        print("Title:", post.get("title"))
        media = post.get("secure_media") or post.get("media") or {}
        reddit_video = media.get("reddit_video", {})
        print("Reddit Video fallback_url (video stream):", reddit_video.get("fallback_url"))
        print("HLS URL:", reddit_video.get("hls_url"))
        print("Duration:", reddit_video.get("duration"))
except Exception as e:
    print(f"Reddit .json error: {e}")

print("\n==================== 5. FACEBOOK REELS ====================")
fb_url = "https://www.facebook.com/reel/2277713513083702"
# Facebook oEmbed requires an app access token or client token
try:
    r = requests.get(f"https://www.facebook.com/plugins/video/oembed.json/?url={fb_url}", headers=headers, timeout=10)
    print(f"Facebook oEmbed (no auth) Status: {r.status_code}")
    print(f"Facebook oEmbed response: {r.text[:200]}")
except Exception as e:
    print(f"Facebook oEmbed error: {e}")

# Check Facebook direct/embed HTML
try:
    # Test m.facebook.com or www.facebook.com
    r = requests.get(fb_url, headers=headers, timeout=10)
    print(f"Facebook direct page Status: {r.status_code}, Final URL: {r.url}, Length: {len(r.text)}")
    # Check for og:title, og:description, og:video
    og_title = re.search(r'<meta property="og:title" content="([^"]+)"', r.text)
    og_desc = re.search(r'<meta property="og:description" content="([^"]+)"', r.text)
    og_video = re.search(r'<meta property="og:video" content="([^"]+)"', r.text)
    print("og:title:", og_title.group(1) if og_title else None)
    print("og:description:", og_desc.group(1) if og_desc else None)
    print("og:video:", og_video.group(1)[:80] if og_video else None)
except Exception as e:
    print(f"Facebook direct error: {e}")

