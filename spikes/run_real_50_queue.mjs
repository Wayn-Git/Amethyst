import fs from 'fs';
import { loadEnv } from './load_env.mjs';

const env = loadEnv();
const apiKey = env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('Missing GEMINI_API_KEY');
  process.exit(1);
}

const model = 'gemini-3.5-flash-lite';
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

console.log('--- STARTING 50-ITEM REAL GEMINI QUEUE WITH 4.1s PACING (>=200s DURATION) ---');
const queueStart = new Date().toISOString();
const t0 = Date.now();
const items = [];

for (let i = 1; i <= 50; i++) {
  const itemStart = new Date().toISOString();
  const tItem0 = Date.now();
  const payload = {
    contents: [
      {
        parts: [
          { text: `Item #${i}: Extract 2 keywords from this post: "Building an offline-first mobile companion app with Capacitor, SQLite, and Google Drive sync."` }
        ]
      }
    ],
    generationConfig: {
      maxOutputTokens: 25,
      temperature: 0.1
    }
  };

  let status = 0;
  let responseText = '';
  let error = null;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(payload)
    });
    status = res.status;
    const data = await res.json();
    if (res.ok) {
      responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    } else {
      error = data?.error?.message || res.statusText;
    }
  } catch (err) {
    error = err.message;
  }

  const itemEnd = new Date().toISOString();
  const itemLatency = Date.now() - tItem0;
  items.push({
    index: i,
    startedAt: itemStart,
    finishedAt: itemEnd,
    latencyMs: itemLatency,
    httpStatus: status,
    success: status === 200,
    responseText,
    error
  });

  console.log(`[${i}/50] HTTP ${status} in ${itemLatency}ms: "${responseText}"`);

  // Minimum 4.1s spacing to strictly enforce >=200s total duration and avoid 429
  if (i < 50) {
    await new Promise(r => setTimeout(r, 4100));
  }
}

const queueEnd = new Date().toISOString();
const totalSeconds = (Date.now() - t0) / 1000;
console.log(`Queue completed: 50 items in ${totalSeconds.toFixed(1)}s (Started: ${queueStart}, Ended: ${queueEnd})`);

const summary = {
  test: 'T7_Gemini_Queue_50_Items_Real_Timestamps',
  totalItems: 50,
  startedAt: queueStart,
  endedAt: queueEnd,
  totalDurationSeconds: Number(totalSeconds.toFixed(1)),
  meetsDurationFloor200s: totalSeconds >= 200,
  passedCount: items.filter(i => i.success).length,
  failedCount: items.filter(i => !i.success).length,
  rateLimit429Count: items.filter(i => i.httpStatus === 429).length,
  items
};

fs.writeFileSync('spikes/evidence/t7_gemini_50_queue_real_run.json', JSON.stringify(summary, null, 2));
console.log('Saved to spikes/evidence/t7_gemini_50_queue_real_run.json');
