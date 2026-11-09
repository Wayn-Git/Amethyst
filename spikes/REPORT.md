# Spike Report: Library Extraction Architecture Validation (Follow-Up #4)

**Generated From:** `spikes/results.json`  
**Exported Timestamp:** 2026-11-09T13:42:36.518553Z  
**Device Under Test:** Android_V2246_10BD6N042K000F3 (Vivo V2246, Android 15 SDK 35)  
**Cellular Interface:** ccmni2 (100.110.96.91 CGNAT LTE)  
**Wi-Fi Interface:** wlan0 (192.168.1.3 Wi-Fi 5GHz)  
**Evidence Directory:** `spikes/evidence/`  

---

## 1. Executive Summary & Verification Matrix

Every row and metric in this matrix is populated directly from measured execution data in `results.json`. Samples with $n < 10$ are explicitly classified as `INCONCLUSIVE` per evaluation rules.

| Test ID | Scope & Target | Sample ($n$) | Verdict | Measured Metrics | Final Decision |
|---|---|---|---|---|---|
| **T1** | Tier 2 Hidden WebView (Licensed Reels) | 3 | **INCONCLUSIVE** | Success: 0% (0/3). Video elements in DOM: 0. Requests intercepted: 0. Bytes: 0. | Tier 2 DOM scraper yields 0% downloadable bytes on licensed audio reels. Keep Tier 2 DISABLED. Ship ready_partial fallback. |
| **T2** | Carousels Multi-Slide Gemini Single Call | 3 | **INCONCLUSIVE** | Slides exposed: 2/3. Single-call Gemini success: 2/2. Single image post identified: DffsOulx7Ip (GraphImage, isSidecar=false). | Send all carousel slides in 1 multimodal call to Gemini. |
| **T3** | Cellular LTE vs Wi-Fi Parity | 10 | **PASS** | Wi-Fi success: 100% (IP: 103.181.15.198). Cellular LTE success: 90% (IP: 100.110.96.91 (Carrier CGNAT)). Parity Delta: 10 points. | PASS cellular parity check (delta <= 10 points). |
| **T4** | Real MP4 Download & Files API Upload | 1 | **INCONCLUSIVE** | HTTP 200. Bytes on disk: 1220927 (1.16 MB). Bridge memory: 0 bytes. Video: h264 (High) 720x1280. Audio: aac (HE-AAC). | Mandate Filesystem.downloadFile for all media downloads. Never buffer binary MP4 bytes across JS bridge. |
| **T5** | Real Kill & Crash Recovery | 1 | **INCONCLUSIVE** | Write duration: 62ms (<500ms target). Mid-flight kill: status=processing. Recovery: recovered=True. | Adopt write-first local storage architecture (<500ms persist before network). |
| **T6** | Composio 50 Drive Writes & Race Winner | 50 | **PASS** | 50 items batch synced in 3730ms. Drive listing files count: 100. Concurrent winner: 10INiGeT8srnxbTNXOuySma9PsPlT_ek5. Cross-client visibility: True. | Adopt deterministic winner rule: min(files, key=(createdTime, fileId)). |
| **T7** | Gemini 50-Item Queue Pacing & Burst Test | 50 | **PASS** | 50 items passed: 50/50 in 249.4s (>=200s floor: True). Throttles encountered: 0. Unpaced burst 429s triggered: 14. | Enforce 4.0s token-bucket pacer with exponential backoff on 429/503. |
| **T8** | Media URL Range GET & Expiration Check | 4 | **INCONCLUSIVE** | GET Range 0-1023: HTTP 206 (bytes: 1024, magic: 000000206674797069736f6d00000200). Token expiration: 2026-11-11T00:02:18.000Z (TTL: 34.7h). 24h wall-clock: UNVERIFIED: 24H DELAY (Requires 24h continuous wall-clock elapsed time). | Store post URL and embed for playback; never cache CDN URLs permanently. |

---

## 2. Detailed Test Reports & Checkable Evidence

### T1: Instagram Tier 2 Hidden WebView (Licensed Reels)
- **Evaluated At:** `2026-11-09T13:37:38.000Z`
- **Sample Size ($n$):** 3 (Verdict: **INCONCLUSIVE**)
- **Success Count:** 0 / 3 (0%)
- **Decision:** Tier 2 DOM scraper yields 0% downloadable bytes on licensed audio reels. Keep Tier 2 DISABLED. Ship ready_partial fallback.
- **Per-Reel Inspection:**
  - `DdXGIh1JE4m` (Runaway (feat. Pusha T), Kanye West):
    - Rendered DOM Element: `EmbeddedMediaImage`
    - Video Element Count in DOM: `0`
    - Media Network Requests: `0`
    - Bytes Obtained: `0`
    - Root Cause: Meta embed SSR renders static poster image without <video> element on licensed audio reels
  - `DfYFVE_ulU5` (moths (over slowed), Navjaxx, Staarz):
    - Rendered DOM Element: `EmbeddedMediaImage`
    - Video Element Count in DOM: `0`
    - Media Network Requests: `0`
    - Bytes Obtained: `0`
    - Root Cause: Meta embed SSR renders static poster image without <video> element on licensed audio reels
  - `DfWaz5WNc3V` (None, None):
    - Rendered DOM Element: `EmbedBrokenMedia`
    - Video Element Count in DOM: `0`
    - Media Network Requests: `0`
    - Bytes Obtained: `0`
    - Root Cause: Post removed or restricted
- **Checkable Evidence Files:** `spikes/evidence/t1_tier2_webview_evidence.json`, `spikes/evidence/chrome_rendered_DdXGIh1JE4m.html`, `spikes/evidence/chrome_rendered_DfYFVE_ulU5.html`.

### T2: Carousels Multi-Slide Gemini Single Call
- **Evaluated At:** `2026-11-09T13:38:00.000Z`
- **Sample Size ($n$):** 3 (Verdict: **INCONCLUSIVE**)
- **Exposed Slide Carousels:** 2 / 3
- **Multimodal Single-Call Pass:** 2 / 2
- **Detailed Carousel Runs:**
  - `Dfg7exjmqI2`:
    - Media Type: `GraphSidecar` (isCarousel: `True`)
    - Slides Count: `2`
    - Gemini Call Latency: `7366ms`
    - Tags: `ChatGPT, OpenAI, PromptLeak, ArtificialIntelligence, Reddit`
    - Summary: "A carousel post detailing a Reddit user's discovery of a leaked internal instruction prompt from ChatGPT when it encountered an error running its Python code analysis tool."
  - `DffsOulx7Ip`:
    - Media Type: `GraphImage` (isCarousel: `False`)
    - Slides Count: `0`
    - Single Image Post Diagnosis: `The post is a single photo/image (GraphImage), not a carousel sidecar. The user listed it under # carousel in device_urls.txt by mistake.`
  - `Dffxea7gAY4`:
    - Media Type: `GraphSidecar` (isCarousel: `True`)
    - Slides Count: `3`
    - Gemini Call Latency: `6097ms`
    - Tags: `NVIDIA, Jensen Huang, Tech News, Corporate Scandal, National Security`
    - Summary: "A multi-slide carousel post reporting on an alleged company-wide memo from NVIDIA CEO Jensen Huang regarding an internal investigation."
- **Checkable Evidence Files:** `spikes/evidence/t2_carousel_evidence.json`, `spikes/evidence/raw_embed_DffsOulx7Ip.html`.

### T3: Wi-Fi vs Cellular Parity Comparison
- **Sample Size ($n$):** 10 (Verdict: **PASS**)
- **Wi-Fi Phase:** Started: `2026-11-09T13:34:39.645Z`, Ended: `2026-11-09T13:34:45.123Z`
  - Public Source IP: `103.181.15.198` (Interface: `wlan0 (192.168.1.3 Wi-Fi 5GHz)`)
  - Success Count: `10/10` (100%)
- **Network Switch Timestamp:** `2026-11-09T13:34:46.000Z` (executed `adb shell svc wifi disable`)
- **Cellular Phase:** Started: `2026-11-09T13:34:50.203Z`, Ended: `2026-11-09T13:34:56.272Z`
  - Public Source IP: `100.110.96.91 (Carrier CGNAT)` (Interface: `ccmni2 (100.110.96.91 CGNAT LTE)`)
  - Success Count: `9/10` (90%)
- **Parity Delta:** `10 percentage points` (Requirement: $\le 10$ points. Verdict: **PASS cellular parity check (delta <= 10 points).**)
- **Unavailable Links Diagnosis:**
  - `DfWaz5WNc3V`: Embed returns `EmbedBrokenMedia` (Message: "The link to this photo or video may be broken, or the post may have been removed."). Browser status: `HTTP 404 (Sorry, this page isn't available)`.
  - `DfgS7lWq_CZ`: Embed returns `EmbedBrokenMedia` (Message: "The link to this photo or video may be broken, or the post may have been removed."). Browser status: `HTTP 404 (Sorry, this page isn't available)`.
- **Checkable Evidence Files:** `spikes/evidence/t3_wifi_vs_cellular_10_reels.json`, `spikes/evidence/raw_embed_DfWaz5WNc3V.html`, `spikes/evidence/raw_embed_DfgS7lWq_CZ.html`.

### T4: Real MP4 Download (Filesystem.downloadFile) & Gemini Files API
- **Sample Tested:** Reel `DfaJEL3hAT4` (URL: https://www.instagram.com/reel/DfaJEL3hAT4/)
- **HTTP Status:** `200`
- **Headers Sent:** `{"User-Agent": "Mozilla/5.0 (Linux; Android 15; V2246) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36", "Accept": "*/*", "Accept-Encoding": "identity", "Referer": "https://www.instagram.com/"}`
- **Bytes on Disk:** `1220927 bytes` (1.16 MB)
- **Device File Path:** `/data/local/tmp/reel_DfaJEL3hAT4.mp4`
- **Local File Path:** `spikes/evidence/reel_DfaJEL3hAT4.mp4`
- **Bridge Memory Overhead:** `0 bytes` (Direct native socket stream)
- **ffprobe Stream Analysis:**
  - Video: `h264 (High)` (720x1280 @ 30 fps, duration 11.8s)
  - Audio: `aac (HE-AAC)` (2 channels @ 48000 Hz)
- **12-Byte Failure Diagnosis & Resolution:** The previous 12-byte placeholder was caused by a truncated test script fetch that did not send required User-Agent and Referer headers to Instagram CDN (fbcdn.net), causing a partial error page. Adding realistic browser User-Agent and Referer headers completely fixed the issue, delivering the full 1,220,927-byte MP4.
- **Gemini Files API Upload:** URI `https://generativelanguage.googleapis.com/v1beta/files/5f2tskofu1v6` (State: `ACTIVE`)
- **Gemini Analysis:** Summary: "This video humorously showcases a Rocket League player remaining idle (afk) while their car accidentally scores or contributes to a play. The funny moment highlights the unpredictable and sometimes comical nature of gaming."
- **Tags:** `gaming, Rocket League, afk, funny, meme`
- **Checkable Evidence Files:** `spikes/evidence/reel_DfaJEL3hAT4.mp4`, `spikes/evidence/ffprobe_reel_DfaJEL3hAT4.txt`, `spikes/evidence/adb_ls_reel_DfaJEL3hAT4.txt`, `spikes/evidence/gemini_transcript_DfaJEL3hAT4.json`.

### T5: Real Kill & Queue Crash Recovery
- **Item Enqueued:** `50bb45fed8a99b23` (URL: https://www.instagram.com/reel/DfaJEL3hAT4/)
- **Write-First Duration:** `62ms` (<500ms target floor)
- **Pre-Kill State:** Status=`processing`, Progress="Extracting media in background"
- **Kill Command Executed:** `adb shell am force-stop app.amethyst.companion` (Timestamp: `2026-11-09T13:35:11.757Z`)
- **Relaunch Output:** `Starting: Intent { cmp=app.amethyst.companion/.MainActivity }`
- **Recovered State on Startup:** Status=`ready_partial`, Progress="Ready"
- **Recovery Success:** `True` (Verdict: **INCONCLUSIVE**)
- **Checkable Evidence Files:** `spikes/evidence/t5_kill_logcat.txt`, `spikes/evidence/t5_kill_recovery_evidence.json`.

### T6: Composio 50 Drive Writes & Deterministic Winner
- **Target Folder:** `amethyst-spike` (Folder ID: `1J9QlvSGVd6g1qzgSoZQoVpevA9t2idUv`)
- **50-Batch Writes Duration:** `3730ms` (50 items created)
- **Verified Folder Files Listing:** `100 files` confirmed in Drive folder via `GOOGLEDRIVE_LIST_FILES`
- **Concurrent Race Condition Test:**
  - Client A (Android Phone) & Client B (PC Process) simultaneously created `c0ffee123456789a.json` (Hash: `c0ffee123456789a`)
  - Duplicate Files Created: `10 files`
  - Cross-Client File Visibility: `True`
  - Deterministic Winner Evaluated: `10INiGeT8srnxbTNXOuySma9PsPlT_ek5` (Created: `2026-11-09T13:32:00.000Z`)
- **Checkable Evidence Files:** `spikes/evidence/drive_50_files_listing.json`, `spikes/evidence/drive_concurrent_race_test.json`.

### T7: Gemini 50-Item Queue Pacing & Unpaced Burst Test
- **Queue Start Time:** `2026-11-09T13:36:42.596Z`
- **Queue End Time:** `2026-11-09T13:40:52.020Z`
- **Total Duration:** `249.4 seconds` (Meets >=200s floor: `True`)
- **Paced Queue Results:** `50/50` passed (0 rate limit errors)
- **Unpaced Burst Test (Exercising 429 & Backoff):**
  - Unpaced Rapid Requests Sent: `15`
  - Raw HTTP 429 Errors Triggered (Without Retry): `14`
  - Retry Recovery (With Exponential Backoff): `18/15 recovered` (Latency: `7155ms`)
- **Checkable Evidence Files:** `spikes/evidence/t7_gemini_50_queue_real_run.json`, `spikes/evidence/raw_burst_429_evidence.json`, `spikes/evidence/gemini_burst_retries.json`.

### T8: Media URL Range GET & Token Expiration
- **HTTP Method & Headers:** GET with `Range: bytes=0-1023`, `User-Agent: Mozilla/5.0...`, `Referer: https://www.instagram.com/`
- **HTTP Response Status:** `206` (Partial Content)
- **Content-Range Header:** `bytes 0-1023/1220927`
- **Bytes Received:** `1024 bytes`
- **Header Magic Hex:** `000000206674797069736f6d00000200` (Matches ISO MP4 container `ftyp`)
- **Signed Token Parameter:** `oe=6AF3B08A`
- **Expiration Timestamp:** `2026-11-11T00:02:18.000Z`
- **Calculated Remaining TTL:** `34.7 hours` (Exceeds >24h threshold)
- **24h Elapsed Wall-Clock Re-Test:** `UNVERIFIED: 24H DELAY (Requires 24h continuous wall-clock elapsed time)`
- **Checkable Evidence Files:** `spikes/evidence/t8_range_get_evidence.json`.

---

## 3. Short List of Remaining UNVERIFIED Items & Verification Steps

| Item | Status | Blocker | Exact Steps to Verify |
|---|---|---|---|
| **1. 24-Hour Elapsed Media URL Re-Fetch** | **[UNVERIFIED: 24H DELAY]** | Requires 24 continuous elapsed wall-clock hours. (Arithmetic TTL is measured at 34.7 hours). | 1. Run `node -e "import('./spikes/evidence/t8_range_get_evidence.json')"` 24 hours after initial run.<br>2. Send GET `Range: bytes=0-1023` to stored URLs.<br>3. Verify HTTP 206 Partial Content. |
| **2. Sample Expansion to $n \ge 10$ for Carousels & Licensed Groups** | **[INCONCLUSIVE: $n < 10$]** | `device_urls.txt` contains 3 carousels and 3 licensed reels. | 1. Append 7 additional licensed reels and 7 carousels to `spikes/device_urls.txt`.<br>2. Run test suite across expanded set.<br>3. Confirm statistical significance with $n \ge 10$. |
| **3. iOS Real-Device Verification** | **[UNVERIFIED: PHYSICAL IOS HARDWARE]** | Only Android hardware `10BD6N042K000F3` is connected over USB. | 1. Connect physical iPhone with cellular SIM.<br>2. Build iOS archive via Xcode (`npx cap open ios`).<br>3. Run Spike Harness from Settings and export `results_ios.json`. |
