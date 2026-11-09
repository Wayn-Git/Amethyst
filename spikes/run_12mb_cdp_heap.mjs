import { evalInWebView, getHeapUsage } from './cdp_eval.mjs';
import fs from 'fs';
import { execSync } from 'child_process';

const URL_12MB = 'https://www.instagram.com/reel/De5oNXKteqU/';
const SHORTCODE_12MB = 'De5oNXKteqU';

const URL_15MB = 'https://www.instagram.com/reel/DfGMReUIX-d/';
const SHORTCODE_15MB = 'DfGMReUIX-d';

async function run() {
  console.log('=== TEST 4: 12MB REEL FRESH RUN WITH CDP RUNTIME.GETHEAPUSAGE ===');

  // Step 1: Clear item from library
  console.log('1. Clearing 12MB and 15MB reels from library in app...');
  await evalInWebView(`
    (async () => {
      const items = (window.__savedLibraryItems || []).filter(
        i => i.shortcode !== '${SHORTCODE_12MB}' && i.shortcode !== '${SHORTCODE_15MB}'
      );
      window.__savedLibraryItems = items;
      try {
        localStorage.setItem('amethyst_saved_items', JSON.stringify(items));
      } catch(e) {}
      return true;
    })()
  `, true);

  // Step 2: Sample baseline heap via CDP Runtime.getHeapUsage
  const baselineHeap = await getHeapUsage();
  console.log('Baseline V8 Heap:', {
    usedSizeMB: (baselineHeap.usedSize / 1024 / 1024).toFixed(2),
    totalSizeMB: (baselineHeap.totalSize / 1024 / 1024).toFixed(2)
  });

  // Step 3: Trigger enqueue & processing for 12MB reel
  console.log('\n2. Enqueueing fresh 12MB reel:', URL_12MB);
  const t0 = Date.now();

  // Polling heap during execution
  let peakHeapUsed = baselineHeap.usedSize;
  let peakHeapTotal = baselineHeap.totalSize;

  const heapSampler = setInterval(async () => {
    try {
      const h = await getHeapUsage();
      if (h.usedSize > peakHeapUsed) peakHeapUsed = h.usedSize;
      if (h.totalSize > peakHeapTotal) peakHeapTotal = h.totalSize;
    } catch(e) {}
  }, 250);

  // Trigger enqueue in app
  const enqueueResult = await evalInWebView(`
    (async () => {
      const item = await window.__enqueueSave('${URL_12MB}');
      return item;
    })()
  `, true);
  console.log('Enqueue initiated item id:', enqueueResult.id, 'status:', enqueueResult.status);

  // Wait for item to reach ready or failed
  console.log('Waiting for pipeline to reach final status...');
  let finalItem = null;
  const timeoutMs = 90000;
  const pollStart = Date.now();

  while (Date.now() - pollStart < timeoutMs) {
    const itemState = await evalInWebView(`
      (async () => {
        const items = window.__savedLibraryItems || [];
        return items.find(i => i.shortcode === '${SHORTCODE_12MB}') || null;
      })()
    `, true);

    if (itemState && (itemState.status === 'ready' || itemState.status === 'ready_partial' || itemState.status === 'failed')) {
      finalItem = itemState;
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  clearInterval(heapSampler);
  const totalDurationMs = Date.now() - t0;
  const finalHeap = await getHeapUsage();

  console.log('\n12MB Run Completed in', totalDurationMs, 'ms');
  console.log('Final Status:', finalItem?.status);
  console.log('File Size on disk:', finalItem?.fileSize, 'bytes');
  console.log('Has Summary:', !!finalItem?.summary);
  console.log('Has Transcript:', !!finalItem?.transcript);
  console.log('Peak V8 Heap Used:', (peakHeapUsed / 1024 / 1024).toFixed(2), 'MB');
  console.log('Peak V8 Heap Total:', (peakHeapTotal / 1024 / 1024).toFixed(2), 'MB');

  // Step 4: Verify >15MB ceiling on DfGMReUIX-d
  console.log('\n3. Verifying >15MB Ceiling on 15.8MB reel:', URL_15MB);
  const t0_15 = Date.now();
  await evalInWebView(`
    (async () => {
      return await window.__enqueueSave('${URL_15MB}');
    })()
  `, true);

  let finalItem15 = null;
  const poll15Start = Date.now();
  while (Date.now() - poll15Start < timeoutMs) {
    const itemState = await evalInWebView(`
      (async () => {
        const items = window.__savedLibraryItems || [];
        return items.find(i => i.shortcode === '${SHORTCODE_15MB}') || null;
      })()
    `, true);

    if (itemState && (itemState.status === 'ready' || itemState.status === 'ready_partial' || itemState.status === 'failed')) {
      finalItem15 = itemState;
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  const duration15Ms = Date.now() - t0_15;
  console.log('15MB Run Completed in', duration15Ms, 'ms');
  console.log('Final Status:', finalItem15?.status);
  console.log('Reason / Progress:', finalItem15?.progress || finalItem15?.error);

  const evidence = {
    testedAt: new Date().toISOString(),
    reel12MB: {
      url: URL_12MB,
      shortcode: SHORTCODE_12MB,
      finalStatus: finalItem?.status,
      fileSize: finalItem?.fileSize,
      durationMs: totalDurationMs,
      summary: finalItem?.summary,
      transcriptSample: finalItem?.transcript ? finalItem.transcript.slice(0, 150) + '...' : null,
      heapMetrics: {
        measurementTool: 'CDP Runtime.getHeapUsage',
        baselineUsedMB: Number((baselineHeap.usedSize / 1024 / 1024).toFixed(2)),
        baselineTotalMB: Number((baselineHeap.totalSize / 1024 / 1024).toFixed(2)),
        peakUsedMB: Number((peakHeapUsed / 1024 / 1024).toFixed(2)),
        peakTotalMB: Number((peakHeapTotal / 1024 / 1024).toFixed(2)),
        finalUsedMB: Number((finalHeap.usedSize / 1024 / 1024).toFixed(2)),
        finalTotalMB: Number((finalHeap.totalSize / 1024 / 1024).toFixed(2)),
        heapExpansionMB: Number(((peakHeapUsed - baselineHeap.usedSize) / 1024 / 1024).toFixed(2))
      }
    },
    reel15MBCeiling: {
      url: URL_15MB,
      shortcode: SHORTCODE_15MB,
      finalStatus: finalItem15?.status,
      fileSize: finalItem15?.fileSize,
      durationMs: duration15Ms,
      progressReason: finalItem15?.progress || finalItem15?.error,
      exceedsLimitCorrectlyHandled: finalItem15?.status === 'ready_partial'
    }
  };

  fs.writeFileSync('spikes/evidence/t1_12mb_cdp_heap_evidence.json', JSON.stringify(evidence, null, 2));
  console.log('\nSaved spikes/evidence/t1_12mb_cdp_heap_evidence.json successfully.');
}

run().catch(err => {
  console.error('Test 4 error:', err);
  process.exit(1);
});
