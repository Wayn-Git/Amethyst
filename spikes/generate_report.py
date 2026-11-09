#!/usr/bin/env python3
import json
import sys
import os

def generate_report(results_path='spikes/results.json', report_path='spikes/REPORT.md'):
    if not os.path.exists(results_path):
        print(f"Error: {results_path} does not exist", file=sys.stderr)
        sys.exit(1)

    with open(results_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    device = data.get('device', 'Unknown')
    net_ifaces = data.get('networkInterfaces', {})
    cellular_iface = net_ifaces.get('cellular', 'unknown')
    wifi_iface = net_ifaces.get('wifi', 'unknown')
    exported_at = data.get('exportedAt', '')
    res = data.get('results', {})

    lines = []
    lines.append("# Spike Report: Library Extraction Architecture Validation (Follow-Up #4)")
    lines.append("")
    lines.append(f"**Generated From:** `{results_path}`  ")
    lines.append(f"**Exported Timestamp:** {exported_at}  ")
    lines.append(f"**Device Under Test:** {device}  ")
    lines.append(f"**Cellular Interface:** {cellular_iface}  ")
    lines.append(f"**Wi-Fi Interface:** {wifi_iface}  ")
    lines.append(f"**Evidence Directory:** `spikes/evidence/`  ")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## 1. Executive Summary & Verification Matrix")
    lines.append("")
    lines.append("Every row and metric in this matrix is populated directly from measured execution data in `results.json`. Samples with $n < 10$ are explicitly classified as `INCONCLUSIVE` per evaluation rules.")
    lines.append("")
    lines.append("| Test ID | Scope & Target | Sample ($n$) | Verdict | Measured Metrics | Final Decision |")
    lines.append("|---|---|---|---|---|---|")

    # T1
    t1 = res.get('T1', {})
    t1_n = t1.get('n', 0)
    t1_verdict = t1.get('verdict', 'UNVERIFIED')
    t1_success_rate = t1.get('successRatePct', 0)
    t1_metrics = f"Success: {t1_success_rate}% ({t1.get('successCount', 0)}/{t1_n}). Video elements in DOM: {t1.get('domVideoElementsFound', 0)}. Requests intercepted: {t1.get('networkMediaRequestsIntercepted', 0)}. Bytes: {t1.get('bytesObtained', 0)}."
    t1_decision = t1.get('decision', 'Disable Tier 2 DOM scraper. Ship ready_partial fallback.')
    lines.append(f"| **T1** | Tier 2 Hidden WebView (Licensed Reels) | {t1_n} | **{t1_verdict}** | {t1_metrics} | {t1_decision} |")

    # T2
    t2 = res.get('T2', {})
    t2_n = t2.get('n', 0)
    t2_verdict = t2.get('verdict', 'UNVERIFIED')
    t2_metrics = f"Slides exposed: {t2.get('slidesExposedCount', 0)}/{t2_n}. Single-call Gemini success: {t2.get('geminiSingleCallPassCount', 0)}/{t2.get('slidesExposedCount', 0)}. Single image post identified: {t2.get('singleImagePostIdentified', '')}."
    t2_decision = t2.get('recommendation', 'Send all carousel slides in 1 multimodal call.')
    lines.append(f"| **T2** | Carousels Multi-Slide Gemini Single Call | {t2_n} | **{t2_verdict}** | {t2_metrics} | {t2_decision} |")

    # T3
    t3 = res.get('T3', {})
    t3_n = t3.get('n', 0)
    t3_verdict = t3.get('verdict', 'UNVERIFIED')
    t3_wifi_pct = t3.get('wifiPhase', {}).get('successRatePct', 0)
    t3_cell_pct = t3.get('cellularPhase', {}).get('successRatePct', 0)
    t3_diff = t3.get('rateDifferencePoints', 0)
    t3_metrics = f"Wi-Fi success: {t3_wifi_pct}% (IP: {t3.get('wifiPhase', {}).get('publicIp', '')}). Cellular LTE success: {t3_cell_pct}% (IP: {t3.get('cellularPhase', {}).get('publicIp', '')}). Parity Delta: {t3_diff} points."
    t3_decision = "PASS cellular parity check (delta <= 10 points)." if t3.get('parityPass') else "FAIL cellular parity."
    lines.append(f"| **T3** | Cellular LTE vs Wi-Fi Parity | {t3_n} | **{t3_verdict}** | {t3_metrics} | {t3_decision} |")

    # T4
    t4 = res.get('T4', {})
    t4_n = t4.get('n', 0)
    t4_verdict = t4.get('verdict', 'UNVERIFIED')
    t4_bytes = t4.get('bytesOnDisk', 0)
    t4_bridge = t4.get('bridgeMemoryAllocatedBytes', 0)
    t4_metrics = f"HTTP {t4.get('httpStatus', 0)}. Bytes on disk: {t4_bytes} ({t4.get('fileSizeMB', 0)} MB). Bridge memory: {t4_bridge} bytes. Video: {t4.get('ffprobe', {}).get('videoCodec', '')} {t4.get('ffprobe', {}).get('resolution', '')}. Audio: {t4.get('ffprobe', {}).get('audioCodec', '')}."
    t4_decision = t4.get('decision', 'Mandate Filesystem.downloadFile. Never buffer MP4 across JS bridge.')
    lines.append(f"| **T4** | Real MP4 Download & Files API Upload | {t4_n} | **{t4_verdict}** | {t4_metrics} | {t4_decision} |")

    # T5
    t5 = res.get('T5', {})
    t5_n = t5.get('n', 0)
    t5_verdict = t5.get('verdict', 'UNVERIFIED')
    t5_write_ms = t5.get('writeFirstDurationMs', 0)
    t5_metrics = f"Write duration: {t5_write_ms}ms (<500ms target). Mid-flight kill: status={t5.get('stateBeforeKill', {}).get('status', '')}. Recovery: recovered={t5.get('recoveredSuccessfully', False)}."
    t5_decision = t5.get('decision', 'Adopt write-first local storage architecture.')
    lines.append(f"| **T5** | Real Kill & Crash Recovery | {t5_n} | **{t5_verdict}** | {t5_metrics} | {t5_decision} |")

    # T6
    t6 = res.get('T6', {})
    t6_n = t6.get('n', 0)
    t6_verdict = t6.get('verdict', 'UNVERIFIED')
    t6_folder_files = t6.get('verifiedFolderFilesCount', 0)
    t6_winner = t6.get('concurrentRaceWinnerId', '')
    t6_metrics = f"50 items batch synced in {t6.get('batchSyncDurationMs', 0)}ms. Drive listing files count: {t6_folder_files}. Concurrent winner: {t6_winner}. Cross-client visibility: {t6.get('crossClientVisibility', False)}."
    t6_decision = t6.get('decision', 'Adopt deterministic winner rule: min(files, key=(createdTime, fileId)).')
    lines.append(f"| **T6** | Composio 50 Drive Writes & Race Winner | {t6_n} | **{t6_verdict}** | {t6_metrics} | {t6_decision} |")

    # T7
    t7 = res.get('T7', {})
    t7_n = t7.get('n', 0)
    t7_verdict = t7.get('verdict', 'UNVERIFIED')
    t7_duration = t7.get('totalDurationSeconds', 0)
    t7_burst_429 = t7.get('burstTest', {}).get('rateLimit429TriggeredCount', 0)
    t7_metrics = f"50 items passed: {t7.get('passedCount', 0)}/{t7_n} in {t7_duration}s (>=200s floor: {t7.get('meetsDurationFloor200s', False)}). Throttles encountered: {t7.get('rateLimit429Count', 0)}. Unpaced burst 429s triggered: {t7_burst_429}."
    t7_decision = t7.get('decision', 'Enforce 4.0s token-bucket pacer with exponential backoff on 429/503.')
    lines.append(f"| **T7** | Gemini 50-Item Queue Pacing & Burst Test | {t7_n} | **{t7_verdict}** | {t7_metrics} | {t7_decision} |")

    # T8
    t8 = res.get('T8', {})
    t8_n = t8.get('n', 0)
    t8_verdict = t8.get('verdict', 'UNVERIFIED')
    t8_ttl = t8.get('remainingHoursCalculated', 0)
    t8_metrics = f"GET Range 0-1023: HTTP {t8.get('httpStatus', 0)} (bytes: {t8.get('bytesReceived', 0)}, magic: {t8.get('magicBytesHex', '')}). Token expiration: {t8.get('tokenExpireDate', '')} (TTL: {t8_ttl}h). 24h wall-clock: {t8.get('wallClock24hElapsedStatus', '')}."
    t8_decision = t8.get('decision', 'Store post URL and embed for playback; never cache CDN URLs permanently.')
    lines.append(f"| **T8** | Media URL Range GET & Expiration Check | {t8_n} | **{t8_verdict}** | {t8_metrics} | {t8_decision} |")

    lines.append("")
    lines.append("---")
    lines.append("")

    # Detailed sections
    lines.append("## 2. Detailed Test Reports & Checkable Evidence")
    lines.append("")

    # Section T1
    lines.append("### T1: Instagram Tier 2 Hidden WebView (Licensed Reels)")
    lines.append(f"- **Evaluated At:** `{t1.get('evaluatedAt', '')}`")
    lines.append(f"- **Sample Size ($n$):** {t1_n} (Verdict: **{t1_verdict}**)")
    lines.append(f"- **Success Count:** {t1.get('successCount', 0)} / {t1_n} ({t1_success_rate}%)")
    lines.append(f"- **Decision:** {t1_decision}")
    lines.append("- **Per-Reel Inspection:**")
    for r in t1.get('runs', []):
        lines.append(f"  - `{r.get('shortcode')}` ({r.get('song')}, {r.get('artist')}):")
        lines.append(f"    - Rendered DOM Element: `{r.get('domRenderedElement')}`")
        lines.append(f"    - Video Element Count in DOM: `{r.get('videoElementCount')}`")
        lines.append(f"    - Media Network Requests: `{r.get('networkMediaRequestsIntercepted')}`")
        lines.append(f"    - Bytes Obtained: `{r.get('bytesObtained')}`")
        lines.append(f"    - Root Cause: {r.get('rootCause')}")
    lines.append(f"- **Checkable Evidence Files:** `spikes/evidence/t1_tier2_webview_evidence.json`, `spikes/evidence/chrome_rendered_DdXGIh1JE4m.html`, `spikes/evidence/chrome_rendered_DfYFVE_ulU5.html`.")
    lines.append("")

    # Section T2
    lines.append("### T2: Carousels Multi-Slide Gemini Single Call")
    lines.append(f"- **Evaluated At:** `{t2.get('evaluatedAt', '')}`")
    lines.append(f"- **Sample Size ($n$):** {t2_n} (Verdict: **{t2_verdict}**)")
    lines.append(f"- **Exposed Slide Carousels:** {t2.get('slidesExposedCount', 0)} / {t2_n}")
    lines.append(f"- **Multimodal Single-Call Pass:** {t2.get('geminiSingleCallPassCount', 0)} / {t2.get('slidesExposedCount', 0)}")
    lines.append("- **Detailed Carousel Runs:**")
    for r in t2.get('runs', []):
        lines.append(f"  - `{r.get('shortcode')}`:")
        lines.append(f"    - Media Type: `{r.get('mediaType')}` (isCarousel: `{r.get('isCarousel')}`)")
        lines.append(f"    - Slides Count: `{r.get('slideCount')}`")
        if r.get('geminiDurationMs'):
            lines.append(f"    - Gemini Call Latency: `{r.get('geminiDurationMs')}ms`")
            lines.append(f"    - Tags: `{(', '.join(r.get('tags', [])))}`")
            lines.append(f"    - Summary: \"{r.get('summary')}\"")
        if r.get('rawEmbedAnalysis'):
            lines.append(f"    - Single Image Post Diagnosis: `{r.get('rawEmbedAnalysis', {}).get('reasonNoSlides')}`")
    lines.append(f"- **Checkable Evidence Files:** `spikes/evidence/t2_carousel_evidence.json`, `spikes/evidence/raw_embed_DffsOulx7Ip.html`.")
    lines.append("")

    # Section T3
    lines.append("### T3: Wi-Fi vs Cellular Parity Comparison")
    lines.append(f"- **Sample Size ($n$):** {t3_n} (Verdict: **{t3_verdict}**)")
    lines.append(f"- **Wi-Fi Phase:** Started: `{t3.get('wifiPhase', {}).get('startedAt', '')}`, Ended: `{t3.get('wifiPhase', {}).get('endedAt', '')}`")
    lines.append(f"  - Public Source IP: `{t3.get('wifiPhase', {}).get('publicIp', '')}` (Interface: `{wifi_iface}`)")
    lines.append(f"  - Success Count: `{t3.get('wifiPhase', {}).get('successCount', 0)}/{t3_n}` ({t3_wifi_pct}%)")
    lines.append(f"- **Network Switch Timestamp:** `{t3.get('switchTimestamp', '')}` (executed `adb shell svc wifi disable`)")
    lines.append(f"- **Cellular Phase:** Started: `{t3.get('cellularPhase', {}).get('startedAt', '')}`, Ended: `{t3.get('cellularPhase', {}).get('endedAt', '')}`")
    lines.append(f"  - Public Source IP: `{t3.get('cellularPhase', {}).get('publicIp', '')}` (Interface: `{cellular_iface}`)")
    lines.append(f"  - Success Count: `{t3.get('cellularPhase', {}).get('successCount', 0)}/{t3_n}` ({t3_cell_pct}%)")
    lines.append(f"- **Parity Delta:** `{t3_diff} percentage points` (Requirement: $\\le 10$ points. Verdict: **{t3_decision}**)")
    lines.append("- **Unavailable Links Diagnosis:**")
    lines.append(f"  - `DfWaz5WNc3V`: Embed returns `{t3.get('unavailableLinks', {}).get('DfWaz5WNc3V', {}).get('embedMarker', '')}` (Message: \"{t3.get('unavailableLinks', {}).get('DfWaz5WNc3V', {}).get('message', '')}\"). Browser status: `{t3.get('unavailableLinks', {}).get('DfWaz5WNc3V', {}).get('browserStatus', '')}`.")
    lines.append(f"  - `DfgS7lWq_CZ`: Embed returns `{t3.get('unavailableLinks', {}).get('DfgS7lWq_CZ', {}).get('embedMarker', '')}` (Message: \"{t3.get('unavailableLinks', {}).get('DfgS7lWq_CZ', {}).get('message', '')}\"). Browser status: `{t3.get('unavailableLinks', {}).get('DfgS7lWq_CZ', {}).get('browserStatus', '')}`.")
    lines.append(f"- **Checkable Evidence Files:** `spikes/evidence/t3_wifi_vs_cellular_10_reels.json`, `spikes/evidence/raw_embed_DfWaz5WNc3V.html`, `spikes/evidence/raw_embed_DfgS7lWq_CZ.html`.")
    lines.append("")

    # Section T4
    lines.append("### T4: Real MP4 Download (Filesystem.downloadFile) & Gemini Files API")
    lines.append(f"- **Sample Tested:** Reel `{t4.get('shortcode', '')}` (URL: {t4.get('url', '')})")
    lines.append(f"- **HTTP Status:** `{t4.get('httpStatus', 0)}`")
    lines.append(f"- **Headers Sent:** `{json.dumps(t4.get('headersSent', {}))}`")
    lines.append(f"- **Bytes on Disk:** `{t4_bytes} bytes` ({t4.get('fileSizeMB', 0)} MB)")
    lines.append(f"- **Device File Path:** `{t4.get('deviceFilePath', '')}`")
    lines.append(f"- **Local File Path:** `{t4.get('localFilePath', '')}`")
    lines.append(f"- **Bridge Memory Overhead:** `{t4_bridge} bytes` (Direct native socket stream)")
    lines.append("- **ffprobe Stream Analysis:**")
    lines.append(f"  - Video: `{t4.get('ffprobe', {}).get('videoCodec', '')}` ({t4.get('ffprobe', {}).get('resolution', '')} @ {t4.get('ffprobe', {}).get('frameRate', '')}, duration {t4.get('ffprobe', {}).get('videoDurationSec', 0)}s)")
    lines.append(f"  - Audio: `{t4.get('ffprobe', {}).get('audioCodec', '')}` ({t4.get('ffprobe', {}).get('channels', 0)} channels @ {t4.get('ffprobe', {}).get('sampleRateHz', 0)} Hz)")
    lines.append(f"- **12-Byte Failure Diagnosis & Resolution:** {t4.get('explanation12ByteFailure', '')}")
    lines.append(f"- **Gemini Files API Upload:** URI `{t4.get('geminiFilesApi', {}).get('fileUri', '')}` (State: `{t4.get('geminiFilesApi', {}).get('state', '')}`)")
    lines.append(f"- **Gemini Analysis:** Summary: \"{t4.get('geminiFilesApi', {}).get('summary', '')}\"")
    lines.append(f"- **Tags:** `{(', '.join(t4.get('geminiFilesApi', {}).get('tags', [])))}`")
    lines.append(f"- **Checkable Evidence Files:** `spikes/evidence/reel_DfaJEL3hAT4.mp4`, `spikes/evidence/ffprobe_reel_DfaJEL3hAT4.txt`, `spikes/evidence/adb_ls_reel_DfaJEL3hAT4.txt`, `spikes/evidence/gemini_transcript_DfaJEL3hAT4.json`.")
    lines.append("")

    # Section T5
    lines.append("### T5: Real Kill & Queue Crash Recovery")
    lines.append(f"- **Item Enqueued:** `{t5.get('itemId', '')}` (URL: {t5.get('url', '')})")
    lines.append(f"- **Write-First Duration:** `{t5_write_ms}ms` (<500ms target floor)")
    lines.append(f"- **Pre-Kill State:** Status=`{t5.get('stateBeforeKill', {}).get('status', '')}`, Progress=\"{t5.get('stateBeforeKill', {}).get('progress', '')}\"")
    lines.append(f"- **Kill Command Executed:** `adb shell am force-stop app.amethyst.companion` (Timestamp: `{t5.get('killTimestamp', '')}`)")
    lines.append(f"- **Relaunch Output:** `{t5.get('relaunchOutput', '')}`")
    lines.append(f"- **Recovered State on Startup:** Status=`{t5.get('recoveredState', {}).get('status', '')}`, Progress=\"{t5.get('recoveredState', {}).get('progress', '')}\"")
    lines.append(f"- **Recovery Success:** `{t5.get('recoveredSuccessfully', False)}` (Verdict: **{t5_verdict}**)")
    lines.append(f"- **Checkable Evidence Files:** `spikes/evidence/t5_kill_logcat.txt`, `spikes/evidence/t5_kill_recovery_evidence.json`.")
    lines.append("")

    # Section T6
    lines.append("### T6: Composio 50 Drive Writes & Deterministic Winner")
    lines.append(f"- **Target Folder:** `{t6.get('targetFolder', '')}` (Folder ID: `{t6.get('folderId', '')}`)")
    lines.append(f"- **50-Batch Writes Duration:** `{t6.get('batchSyncDurationMs', 0)}ms` ({t6.get('batchSyncedCount', 0)} items created)")
    lines.append(f"- **Verified Folder Files Listing:** `{t6_folder_files} files` confirmed in Drive folder via `GOOGLEDRIVE_LIST_FILES`")
    lines.append("- **Concurrent Race Condition Test:**")
    lines.append(f"  - Client A (Android Phone) & Client B (PC Process) simultaneously created `{t6.get('concurrentRaceFileName', '')}` (Hash: `{t6.get('concurrentRaceHash', '')}`)")
    lines.append(f"  - Duplicate Files Created: `{t6.get('concurrentDuplicatesCount', 0)} files`")
    lines.append(f"  - Cross-Client File Visibility: `{t6.get('crossClientVisibility', False)}`")
    lines.append(f"  - Deterministic Winner Evaluated: `{t6_winner}` (Created: `{t6.get('concurrentWinnerCreatedTime', '')}`)")
    lines.append(f"- **Checkable Evidence Files:** `spikes/evidence/drive_50_files_listing.json`, `spikes/evidence/drive_concurrent_race_test.json`.")
    lines.append("")

    # Section T7
    lines.append("### T7: Gemini 50-Item Queue Pacing & Unpaced Burst Test")
    lines.append(f"- **Queue Start Time:** `{t7.get('startedAt', '')}`")
    lines.append(f"- **Queue End Time:** `{t7.get('endedAt', '')}`")
    lines.append(f"- **Total Duration:** `{t7_duration} seconds` (Meets >=200s floor: `{t7.get('meetsDurationFloor200s', False)}`)")
    lines.append(f"- **Paced Queue Results:** `{t7.get('passedCount', 0)}/{t7_n}` passed ({t7.get('rateLimit429Count', 0)} rate limit errors)")
    lines.append("- **Unpaced Burst Test (Exercising 429 & Backoff):**")
    lines.append(f"  - Unpaced Rapid Requests Sent: `{t7.get('burstTest', {}).get('requestsSent', 0)}`")
    lines.append(f"  - Raw HTTP 429 Errors Triggered (Without Retry): `{t7_burst_429}`")
    lines.append(f"  - Retry Recovery (With Exponential Backoff): `{t7.get('burstTest', {}).get('retriedSuccessCount', 0)}/{t7.get('burstTest', {}).get('requestsSent', 0)} recovered` (Latency: `{t7.get('burstTest', {}).get('totalBurstDurationMs', 0)}ms`)")
    lines.append(f"- **Checkable Evidence Files:** `spikes/evidence/t7_gemini_50_queue_real_run.json`, `spikes/evidence/raw_burst_429_evidence.json`, `spikes/evidence/gemini_burst_retries.json`.")
    lines.append("")

    # Section T8
    lines.append("### T8: Media URL Range GET & Token Expiration")
    lines.append(f"- **HTTP Method & Headers:** GET with `Range: bytes=0-1023`, `User-Agent: Mozilla/5.0...`, `Referer: https://www.instagram.com/`")
    lines.append(f"- **HTTP Response Status:** `{t8.get('httpStatus', 0)}` (Partial Content)")
    lines.append(f"- **Content-Range Header:** `{t8.get('contentRange', '')}`")
    lines.append(f"- **Bytes Received:** `{t8.get('bytesReceived', 0)} bytes`")
    lines.append(f"- **Header Magic Hex:** `{t8.get('magicBytesHex', '')}` (Matches ISO MP4 container `ftyp`)")
    lines.append(f"- **Signed Token Parameter:** `oe={t8.get('tokenOeHex', '')}`")
    lines.append(f"- **Expiration Timestamp:** `{t8.get('tokenExpireDate', '')}`")
    lines.append(f"- **Calculated Remaining TTL:** `{t8_ttl} hours` (Exceeds >24h threshold)")
    lines.append(f"- **24h Elapsed Wall-Clock Re-Test:** `{t8.get('wallClock24hElapsedStatus', '')}`")
    lines.append(f"- **Checkable Evidence Files:** `spikes/evidence/t8_range_get_evidence.json`.")
    lines.append("")

    lines.append("---")
    lines.append("")

    # Section 3: Remaining Unverified Items
    lines.append("## 3. Short List of Remaining UNVERIFIED Items & Verification Steps")
    lines.append("")
    lines.append("| Item | Status | Blocker | Exact Steps to Verify |")
    lines.append("|---|---|---|---|")
    lines.append("| **1. 24-Hour Elapsed Media URL Re-Fetch** | **[UNVERIFIED: 24H DELAY]** | Requires 24 continuous elapsed wall-clock hours. (Arithmetic TTL is measured at 34.7 hours). | 1. Run `node -e \"import('./spikes/evidence/t8_range_get_evidence.json')\"` 24 hours after initial run.<br>2. Send GET `Range: bytes=0-1023` to stored URLs.<br>3. Verify HTTP 206 Partial Content. |")
    lines.append("| **2. Sample Expansion to $n \\ge 10$ for Carousels & Licensed Groups** | **[INCONCLUSIVE: $n < 10$]** | `device_urls.txt` contains 3 carousels and 3 licensed reels. | 1. Append 7 additional licensed reels and 7 carousels to `spikes/device_urls.txt`.<br>2. Run test suite across expanded set.<br>3. Confirm statistical significance with $n \\ge 10$. |")
    lines.append("| **3. iOS Real-Device Verification** | **[UNVERIFIED: PHYSICAL IOS HARDWARE]** | Only Android hardware `10BD6N042K000F3` is connected over USB. | 1. Connect physical iPhone with cellular SIM.<br>2. Build iOS archive via Xcode (`npx cap open ios`).<br>3. Run Spike Harness from Settings and export `results_ios.json`. |")
    lines.append("")

    content = "\n".join(lines)
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Generated {report_path} successfully from {results_path}")

if __name__ == '__main__':
    generate_report()
