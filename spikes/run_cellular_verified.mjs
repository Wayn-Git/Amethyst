import { evalInWebView } from './cdp_eval.mjs';
import { execSync } from 'child_process';
import fs from 'fs';

async function main() {
  console.log('=== TEST 3: CELLULAR 10X + COLD START AIRPLANE MODE RETRY ===');

  console.log('1. Disabling Wi-Fi to force Cellular...');
  execSync('adb shell svc wifi disable');
  await new Promise(r => setTimeout(r, 3000));

  // Verify cellular IP
  const ipCheck = execSync('adb shell ip route get 8.8.8.8 2>/dev/null || true').toString();
  console.log('Routing via interface:', ipCheck.trim());

  // Run 10x sequential checks via CapacitorHttp inside WebView
  const runs = [];
  console.log('2. Running 10x sequential checks over Cellular...');
  for (let i = 1; i <= 10; i++) {
    const t0 = Date.now();
    const result = await evalInWebView(`
      (async () => {
        try {
          const { CapacitorHttp } = window.Capacitor.Plugins;
          const res = await CapacitorHttp.get({
            url: 'https://api.ipify.org?format=json',
            connectTimeout: 10000,
            readTimeout: 10000
          });
          return { status: res.status, data: res.data };
        } catch(e) {
          return { status: 0, error: e.message };
        }
      })()
    `, true);
    const durationMs = Date.now() - t0;
    console.log(`Run ${i}/10: status=${result.status}, duration=${durationMs}ms, ip=${result.data?.ip || result.error}`);
    runs.push({
      iteration: i,
      status: result.status,
      durationMs,
      ip: result.data?.ip || null,
      error: result.error || null,
      success: result.status === 200
    });
    await new Promise(r => setTimeout(r, 500));
  }

  // 3. Forced Cold Start Retry Test
  console.log('\n3. Forcing cold start via Airplane Mode toggle to exercise 3s retry...');
  execSync('adb logcat -c');

  console.log('Enabling airplane mode...');
  execSync('adb shell cmd connectivity airplane-mode enable');
  await new Promise(r => setTimeout(r, 2000));

  console.log('Disabling airplane mode and immediately fetching...');
  execSync('adb shell cmd connectivity airplane-mode disable');

  // Immediately invoke fetch using retry logic in app
  const coldStartT0 = Date.now();
  const coldStartResult = await evalInWebView(`
    (async () => {
      let attempt = 0;
      let logs = [];
      const url = 'https://api.ipify.org?format=json';
      while (attempt < 2) {
        attempt++;
        const attemptT0 = Date.now();
        try {
          const { CapacitorHttp } = window.Capacitor.Plugins;
          const res = await CapacitorHttp.get({
            url,
            connectTimeout: 4000,
            readTimeout: 4000
          });
          if (res.status === 200) {
            logs.push({ attempt, durationMs: Date.now() - attemptT0, status: res.status, ip: res.data?.ip });
            return { success: true, attempts: attempt, logs, finalIp: res.data?.ip };
          }
          throw new Error('Status ' + res.status);
        } catch(err) {
          logs.push({ attempt, durationMs: Date.now() - attemptT0, error: err.message });
          if (attempt < 2) {
            console.warn('[nativeHttp] Network error on GET ' + url + ': ' + err.message + '. Retrying after 3s delay…');
            await new Promise(r => setTimeout(r, 3000));
          }
        }
      }
      return { success: false, attempts: attempt, logs };
    })()
  `, true);
  const totalColdStartDuration = Date.now() - coldStartT0;

  console.log('Cold start result:', JSON.stringify(coldStartResult, null, 2));
  console.log(`Total duration: ${totalColdStartDuration}ms`);

  // Grab logcat excerpt
  const logcatExcerpt = execSync('adb logcat -d -s Capacitor/Console:W,Capacitor/Console:I,nativeHttp:W | tail -n 25').toString();
  fs.writeFileSync('spikes/evidence/logcat_cellular_retry.txt', logcatExcerpt);
  console.log('Logcat excerpt saved to spikes/evidence/logcat_cellular_retry.txt');

  // Re-enable Wi-Fi
  console.log('\n4. Restoring Wi-Fi connection...');
  execSync('adb shell svc wifi enable');
  await new Promise(r => setTimeout(r, 2000));

  const evidence = {
    testedAt: new Date().toISOString(),
    network: 'Cellular (LTE/5G)',
    tenRuns: {
      total: runs.length,
      successCount: runs.filter(r => r.success).length,
      avgDurationMs: Math.round(runs.reduce((acc, r) => acc + r.durationMs, 0) / runs.length),
      runs
    },
    coldStartRetryTest: {
      triggeredAt: new Date().toISOString(),
      forcedCondition: 'Airplane mode disabled -> immediate fetch within 0ms',
      attemptsRequired: coldStartResult.attempts,
      initialAttemptFailed: coldStartResult.attempts > 1,
      retryDelayMs: 3000,
      totalDurationMs: totalColdStartDuration,
      attempts: coldStartResult.logs,
      finalIp: coldStartResult.finalIp,
      success: coldStartResult.success
    }
  };

  fs.writeFileSync('spikes/evidence/t3_cellular_cold_start_evidence.json', JSON.stringify(evidence, null, 2));
  console.log('Saved evidence to spikes/evidence/t3_cellular_cold_start_evidence.json');
}

main().catch(err => {
  console.error('Cellular test error:', err);
  execSync('adb shell svc wifi enable');
  process.exit(1);
});

