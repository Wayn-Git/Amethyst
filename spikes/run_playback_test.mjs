import fs from 'fs';
import { execSync } from 'child_process';

async function run() {
  console.log('=== Item 1: In-App WebView Video Playback Test ===');

  // Ensure port 9222 forwarded
  const pid = execSync('adb shell pidof app.amethyst.companion').toString().trim();
  console.log('App PID:', pid);
  execSync(`adb forward --remove-all && adb forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);

  const pageRes = await fetch('http://127.0.0.1:9222/json');
  const pages = await pageRes.json();
  const page = pages.find(p => p.type === 'page') || pages[0];
  console.log('Connecting to WebView:', page.title, page.url);

  let msgIdCounter = 1000;
  function cdpEval(expr) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      const reqId = ++msgIdCounter;
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('CDP timeout for req ' + reqId));
      }, 30000);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          id: reqId,
          method: 'Runtime.evaluate',
          params: { expression: expr, awaitPromise: true, returnByValue: true }
        }));
      };

      ws.onmessage = (evt) => {
        const data = JSON.parse(evt.data);
        if (data.id !== reqId) return; // Skip unsolicited push events
        clearTimeout(timer);
        ws.close();
        if (data.result?.exceptionDetails) {
          reject(new Error(data.result.exceptionDetails.exception?.description || 'CDP exception'));
        } else {
          resolve(data.result?.result?.value);
        }
      };

      ws.onerror = (err) => {
        clearTimeout(timer);
        reject(err);
      };
    });
  }

  // 1. Re-resolve fresh video URL for ready reel DfaJEL3hAT4
  console.log('1. Re-resolving fresh video URL for DfaJEL3hAT4 via in-app CapacitorHttp...');
  const extractFn = async () => {
    const http = window.Capacitor.Plugins.CapacitorHttp;
    const res = await http.get({
      url: 'https://www.instagram.com/reel/DfaJEL3hAT4/embed/captioned/',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
      }
    });
    const html = res.data || '';
    const idx = html.indexOf('video_url');
    if (idx === -1) return { found: false, htmlLen: html.length };
    const start = html.indexOf('http', idx);
    let end = html.indexOf('"', start);
    let raw = html.slice(start, end);
    let cleanUrl = raw.replace(/\\\\+/g, '').replace(/\\+/g, '');
    return { found: true, videoUrl: cleanUrl };
  };

  const extractRes = await cdpEval('(' + extractFn.toString() + ')()');
  if (!extractRes || !extractRes.found || !extractRes.videoUrl) {
    throw new Error(`Failed to extract fresh video_url: ${JSON.stringify(extractRes)}`);
  }
  const videoUrl = extractRes.videoUrl;
  console.log('Extracted Fresh Video URL (len ' + videoUrl.length + '):', videoUrl.slice(0, 80) + '...');

  // 2. Test Range GET HTTP status with and without Referer via fetch inside the WebView
  console.log('2. Testing HTTP status with and without Referer inside WebView...');
  const testFetchFn = async (url) => {
    async function check(ref) {
      try {
        const headers = { 'Range': 'bytes=0-1024' };
        if (ref !== null) headers['Referer'] = ref;
        const r = await fetch(url, { headers });
        return { status: r.status, ok: r.ok, type: r.headers.get('content-type') };
      } catch (e) {
        return { error: e.message };
      }
    }
    const noRef = await check(null);
    const withLocalhostRef = await check('https://localhost/');
    const withIgRef = await check('https://www.instagram.com/');
    return { noRef, withLocalhostRef, withIgRef };
  };

  const httpStatuses = await cdpEval('(' + testFetchFn.toString() + ')(' + JSON.stringify(videoUrl) + ')');
  console.log('HTTP Statuses:', JSON.stringify(httpStatuses, null, 2));

  // 3. Test Playback WITHOUT Referer
  console.log('\n3. Testing <video> playback WITHOUT Referer (referrerPolicy="no-referrer")...');
  const playNoRefFn = async (url) => {
    let old = document.getElementById('spike_video_test');
    if (old) old.remove();

    const v = document.createElement('video');
    v.id = 'spike_video_test';
    v.referrerPolicy = 'no-referrer';
    v.playsInline = true;
    v.muted = false;
    v.volume = 1.0;
    v.controls = true;
    v.style.position = 'fixed';
    v.style.top = '100px';
    v.style.left = '50px';
    v.style.width = '300px';
    v.style.height = '400px';
    v.style.zIndex = '999999';
    v.style.backgroundColor = '#000';
    document.body.appendChild(v);

    v.src = url;
    let playErr = null;
    try {
      await v.play();
    } catch(e) {
      playErr = e.message;
    }

    return {
      started: !v.paused,
      currentTime: v.currentTime,
      duration: v.duration,
      playError: playErr,
      readyState: v.readyState
    };
  };

  const noRefStart = await cdpEval('(' + playNoRefFn.toString() + ')(' + JSON.stringify(videoUrl) + ')');
  console.log('Playback start (no-referrer):', noRefStart);

  // t0 screenshot
  execSync('adb exec-out screencap -p > spikes/evidence/playback_no_ref_t0.png');
  console.log('Captured spikes/evidence/playback_no_ref_t0.png');

  // Wait 3 seconds for frame advancement
  console.log('Waiting 3s for frames to advance...');
  await new Promise(r => setTimeout(r, 3000));

  const checkStateFn = () => {
    const v = document.getElementById('spike_video_test');
    return {
      paused: v ? v.paused : true,
      currentTime: v ? v.currentTime : 0,
      readyState: v ? v.readyState : 0,
      ended: v ? v.ended : false
    };
  };

  const noRefT3State = await cdpEval('(' + checkStateFn.toString() + ')()');
  console.log('State at t=3s (no-referrer):', noRefT3State);

  // t3 screenshot
  execSync('adb exec-out screencap -p > spikes/evidence/playback_no_ref_t3.png');
  console.log('Captured spikes/evidence/playback_no_ref_t3.png');

  // Check audio focus
  execSync('adb shell dumpsys audio > spikes/evidence/playback_no_ref_audio.txt');
  const audioDumpNoRef = fs.readFileSync('spikes/evidence/playback_no_ref_audio.txt', 'utf8');
  const hasAudioFocusNoRef = audioDumpNoRef.includes('app.amethyst.companion');
  const streamMusicActiveNoRef = audioDumpNoRef.includes('STREAM_MUSIC') && audioDumpNoRef.includes('active');
  console.log('Audio focus attributed to app.amethyst.companion:', hasAudioFocusNoRef);
  console.log('STREAM_MUSIC active:', streamMusicActiveNoRef);

  // 4. Test Playback WITH Referer
  console.log('\n4. Testing <video> playback WITH Referer (referrerPolicy="origin")...');
  const playWithRefFn = async (url) => {
    let old = document.getElementById('spike_video_test');
    if (old) old.remove();

    const v = document.createElement('video');
    v.id = 'spike_video_test';
    v.referrerPolicy = 'origin';
    v.playsInline = true;
    v.muted = false;
    v.volume = 1.0;
    v.controls = true;
    v.style.position = 'fixed';
    v.style.top = '100px';
    v.style.left = '50px';
    v.style.width = '300px';
    v.style.height = '400px';
    v.style.zIndex = '999999';
    v.style.backgroundColor = '#000';
    document.body.appendChild(v);

    v.src = url;
    let playErr = null;
    try {
      await v.play();
    } catch(e) {
      playErr = e.message;
    }

    return {
      started: !v.paused,
      currentTime: v.currentTime,
      duration: v.duration,
      playError: playErr,
      readyState: v.readyState
    };
  };

  const withRefStart = await cdpEval('(' + playWithRefFn.toString() + ')(' + JSON.stringify(videoUrl) + ')');
  console.log('Playback start (with-referrer):', withRefStart);

  // t0 screenshot
  execSync('adb exec-out screencap -p > spikes/evidence/playback_with_ref_t0.png');
  console.log('Captured spikes/evidence/playback_with_ref_t0.png');

  // Wait 3 seconds for frame advancement
  console.log('Waiting 3s for frames to advance...');
  await new Promise(r => setTimeout(r, 3000));

  const withRefT3State = await cdpEval('(' + checkStateFn.toString() + ')()');
  console.log('State at t=3s (with-referrer):', withRefT3State);

  // t3 screenshot
  execSync('adb exec-out screencap -p > spikes/evidence/playback_with_ref_t3.png');
  console.log('Captured spikes/evidence/playback_with_ref_t3.png');

  // Check audio focus
  execSync('adb shell dumpsys audio > spikes/evidence/playback_with_ref_audio.txt');
  const audioDumpWithRef = fs.readFileSync('spikes/evidence/playback_with_ref_audio.txt', 'utf8');
  const hasAudioFocusWithRef = audioDumpWithRef.includes('app.amethyst.companion');
  console.log('Audio focus attributed to app.amethyst.companion:', hasAudioFocusWithRef);

  // Clean up test video element in WebView
  await cdpEval('(() => { const v = document.getElementById("spike_video_test"); if (v) v.remove(); })()');

  // Assemble structured evidence
  const evidence = {
    testedAt: new Date().toISOString(),
    shortcode: 'DfaJEL3hAT4',
    videoUrlResolved: true,
    httpStatuses,
    noReferer: {
      referrerPolicy: 'no-referrer',
      t0: noRefStart,
      t3: noRefT3State,
      frameAdvancing: noRefT3State.currentTime > noRefStart.currentTime,
      secondsAdvanced: +(noRefT3State.currentTime - noRefStart.currentTime).toFixed(2),
      audioFocusAttributed: hasAudioFocusNoRef,
      screenshots: [
        'spikes/evidence/playback_no_ref_t0.png',
        'spikes/evidence/playback_no_ref_t3.png'
      ],
      audioDump: 'spikes/evidence/playback_no_ref_audio.txt'
    },
    withReferer: {
      referrerPolicy: 'origin',
      t0: withRefStart,
      t3: withRefT3State,
      frameAdvancing: withRefT3State.currentTime > withRefStart.currentTime,
      secondsAdvanced: +(withRefT3State.currentTime - withRefStart.currentTime).toFixed(2),
      audioFocusAttributed: hasAudioFocusWithRef,
      screenshots: [
        'spikes/evidence/playback_with_ref_t0.png',
        'spikes/evidence/playback_with_ref_t3.png'
      ],
      audioDump: 'spikes/evidence/playback_with_ref_audio.txt'
    }
  };

  fs.writeFileSync('spikes/evidence/t1_playback_evidence.json', JSON.stringify(evidence, null, 2));
  console.log('Wrote spikes/evidence/t1_playback_evidence.json successfully!');
}

run().catch(err => {
  console.error('Fatal error in playback test:', err);
  process.exit(1);
});
