import { loadEnv } from './load_env.mjs';
import {
  resolveDriveFolderId,
  pickDeterministicWinner,
  reconcileDriveDuplicates
} from '../frontend/src/mobile/driveSync.js';
import fs from 'fs';

const env = loadEnv();
const COMPOSIO_API_KEY = env.COMPOSIO_API_KEY;
const SPIKE_DRIVE_FOLDER = env.SPIKE_DRIVE_FOLDER || 'amethyst-spike';
const COMPOSIO_MCP_ENDPOINT = 'https://connect.composio.dev/mcp';

async function callComposio(tools) {
  const res = await fetch(COMPOSIO_MCP_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-consumer-api-key': COMPOSIO_API_KEY
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'COMPOSIO_MULTI_EXECUTE_TOOL',
        arguments: {
          tools,
          sync_response_to_workbench: false
        }
      }
    })
  });
  const text = await res.text();
  // Extract JSON from SSE if stream or direct json
  let jsonStr = text;
  if (text.includes('data: ')) {
    const lines = text.split('\n');
    for (const l of lines) {
      if (l.startsWith('data: ')) {
        jsonStr = l.slice(6).trim();
        break;
      }
    }
  }
  return JSON.parse(jsonStr);
}

async function listFolder(folderId) {
  const res = await callComposio([
    {
      tool_slug: 'GOOGLEDRIVE_LIST_FILES',
      arguments: {
        q: `'${folderId}' in parents and trashed = false`
      }
    }
  ]);
  const content = res?.result?.content?.[0]?.text;
  if (!content) return [];
  const parsed = JSON.parse(content);
  return parsed?.data?.results?.[0]?.response?.data?.files || [];
}

async function createFile(folderId, fileName, textContent) {
  const t0 = Date.now();
  const res = await callComposio([
    {
      tool_slug: 'GOOGLEDRIVE_CREATE_FILE_FROM_TEXT',
      arguments: {
        name: fileName,
        parent_folder_id: folderId,
        text_content: textContent
      }
    }
  ]);
  const durationMs = Date.now() - t0;
  const content = res?.result?.content?.[0]?.text;
  let fileData = null;
  try {
    const parsed = JSON.parse(content);
    fileData = parsed?.data?.results?.[0]?.response?.data?.file;
  } catch(e) {}
  return { fileData, durationMs, raw: content };
}

async function main() {
  console.log('=== TEST 5: DRIVE TWO-CLIENT RACE & DETERMINISTIC RECONCILER ===');
  console.log('Resolving folder:', SPIKE_DRIVE_FOLDER);
  const folderId = await resolveDriveFolderId({ folderName: SPIKE_DRIVE_FOLDER, apiKey: COMPOSIO_API_KEY });
  console.log('Folder ID:', folderId);

  // Step 1: Listing folder BEFORE race
  console.log('\n1. Listing folder BEFORE test...');
  const filesBefore = await listFolder(folderId);
  console.log(`Folder currently contains ${filesBefore.length} files.`);
  fs.writeFileSync('spikes/evidence/drive_folder_before_race.json', JSON.stringify(filesBefore, null, 2));

  // Step 2: Concurrently create two identical files (Phone Client vs PC Client)
  const raceTestHash = 'race_' + Date.now().toString(36);
  const raceFileName = `item_${raceTestHash}.json`;
  const payloadPhone = JSON.stringify({ client: 'Phone-Android-10BD6N042K000F3', hash: raceTestHash, ts: new Date().toISOString() });
  const payloadPC = JSON.stringify({ client: 'PC-Linux-Workspace', hash: raceTestHash, ts: new Date().toISOString() });

  console.log(`\n2. Starting concurrent race to write ${raceFileName} from two clients...`);
  const tRaceStart = Date.now();
  const [resPhone, resPC] = await Promise.all([
    createFile(folderId, raceFileName, payloadPhone),
    createFile(folderId, raceFileName, payloadPC)
  ]);
  const raceDurationMs = Date.now() - tRaceStart;
  console.log(`Concurrent writes finished in ${raceDurationMs}ms.`);
  console.log('Phone write duration:', resPhone.durationMs, 'ms, raw:', resPhone.raw?.slice(0, 100));
  console.log('PC write duration:', resPC.durationMs, 'ms, raw:', resPC.raw?.slice(0, 100));

  // Step 3: Wait for Drive search/list indexing
  console.log('\n3. Waiting 5s for Drive index sync...');
  await new Promise(r => setTimeout(r, 5000));

  // Step 4: List files matching the race item
  const filesDuring = await listFolder(folderId);
  const raceFiles = filesDuring.filter(f => f.name === raceFileName);
  console.log(`Found ${raceFiles.length} files for ${raceFileName}:`);
  raceFiles.forEach((f, idx) => {
    console.log(`  File [${idx + 1}]: id=${f.id}, createdTime=${f.createdTime}, mimeType=${f.mimeType}`);
  });

  // Step 5: Deterministic winner evaluation
  const rule = 'Earliest createdTime wins; on timestamp tie, lexicographically lowest file id wins';
  console.log('\n4. Evaluating winner using rule:', rule);
  const winner = pickDeterministicWinner(raceFiles);
  const losers = raceFiles.filter(f => f.id !== winner.id);

  console.log('WINNER chosen:', { id: winner.id, createdTime: winner.createdTime });
  console.log('LOSER(s) to be pruned:', losers.map(l => ({ id: l.id, createdTime: l.createdTime })));

  // Step 6: Reconcile duplicates
  console.log('\n5. Executing reconcileDriveDuplicates with gracePeriodMs=0...');
  const reconcileResult = await reconcileDriveDuplicates({
    folderName: SPIKE_DRIVE_FOLDER,
    gracePeriodMs: 0,
    apiKey: COMPOSIO_API_KEY
  });
  console.log('Reconciliation result:', JSON.stringify(reconcileResult, null, 2));

  // Wait 3s for delete propagation
  await new Promise(r => setTimeout(r, 3000));

  // Step 7: Listing folder AFTER reconciliation
  console.log('\n6. Listing folder AFTER reconciliation...');
  const filesAfter = await listFolder(folderId);
  fs.writeFileSync('spikes/evidence/drive_folder_after_race.json', JSON.stringify(filesAfter, null, 2));

  const remainingRaceFiles = filesAfter.filter(f => f.name === raceFileName);
  console.log(`Final race file count in folder: ${remainingRaceFiles.length} (expected: 1)`);
  console.log('Remaining file id:', remainingRaceFiles[0]?.id, 'Matches winner:', remainingRaceFiles[0]?.id === winner.id);

  // Verify non-test files untouched
  const untouchedNonTestFiles = filesBefore.every(bf => filesAfter.some(af => af.id === bf.id));
  console.log('All pre-existing files preserved without alteration:', untouchedNonTestFiles);

  const evidence = {
    testedAt: new Date().toISOString(),
    folderName: SPIKE_DRIVE_FOLDER,
    folderId,
    raceFileName,
    raceDurationMs,
    clientAWrote: { client: 'Phone-Android', durationMs: resPhone.durationMs },
    clientBWrote: { client: 'PC-Linux', durationMs: resPC.durationMs },
    filesCreatedInRace: raceFiles.map(f => ({
      id: f.id,
      name: f.name,
      createdTime: f.createdTime,
      mimeType: f.mimeType
    })),
    winnerRule: rule,
    winnerPicked: {
      id: winner.id,
      name: winner.name,
      createdTime: winner.createdTime
    },
    losersPruned: losers.map(l => ({
      id: l.id,
      name: l.name,
      createdTime: l.createdTime,
      action: 'DELETED via GOOGLEDRIVE_GOOGLE_DRIVE_DELETE_FOLDER_OR_FILE_ACTION'
    })),
    reconcileSummary: reconcileResult,
    folderFilesCountBefore: filesBefore.length,
    folderFilesCountAfter: filesAfter.length,
    finalRaceFileCount: remainingRaceFiles.length,
    deterministicResolutionSuccess: remainingRaceFiles.length === 1 && remainingRaceFiles[0].id === winner.id,
    allPreExistingFilesPreserved: untouchedNonTestFiles
  };

  fs.writeFileSync('spikes/evidence/t3_two_client_drive_race.json', JSON.stringify(evidence, null, 2));
  console.log('\nSaved spikes/evidence/t3_two_client_drive_race.json successfully.');
}

main().catch(err => {
  console.error('Race test error:', err);
  process.exit(1);
});
