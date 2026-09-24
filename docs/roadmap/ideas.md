# Pipeline Improvement Ideas

## Implemented (P0)

### Transcription Fallback Chain
- `transcribe()` now tries all configured Whisper providers in order
- Groq → OpenAI fallback on 429/503/network errors
- Non-retryable errors (401/413) still raise immediately
- Single file read shared across all providers

### Deferred Enrichment
- DM reply now fires *before* enrichment, not after
- User gets "Saved: …" as soon as capture + transcript is done
- Enrichment runs as the last step — failures never delay the reply

## Planned (P1)

### Parallel Vision + Transcription
- Run audio transcription and frame extraction concurrently
- Merge: transcript + visual text for text-overlay reels
- `text_source` = "transcript and visual content" when both succeed

### Independent `ingest` Tier
- Dedicated `ingest:` tier in providers.yaml for background analysis
- Prevents enrichment from competing with interactive chat latency
- Vision extraction explicitly assigned to Gemini Flash

## Planned (P2)

### Transcript Quality Scoring
- Detect Whisper hallucinations (music-only tracks generate gibberish)
- Score based on words-per-second and unique-word ratio
- Low-quality transcripts still trigger vision extraction

### Auto Re-enrichment on Provider Recovery
- When a provider comes back online, query for failed items
- Auto-queue re-enrichment for items with failure notes
- Same for transcript-less items when Whisper becomes available
