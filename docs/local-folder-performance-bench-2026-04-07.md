# Local Folder Performance Bench (2026-04-07)

## Scope

- Validate local-folder scan responsiveness for large folders.
- Compare cold/warm scan behavior across preview-throttle profiles.
- Estimate full index sync scheduling cost under current cap settings.

## Command

```bash
BENCH_LOCAL_RUNS=3 npm run bench:local-folder-scan
```

Script: `scripts/bench-local-folder-scan.ts`

## Dataset

- Synthetic markdown files
- File counts: 2,000 and 10,000
- Bucket size: 100 files per sub-folder bucket

## Results (runs=3)

| profile | files | mode | cold_ms | warm_ms | cold_preview | warm_preview |
|---|---:|---|---:|---:|---:|---:|
| default | 2,000 | tree-sync | 58.3 | 45.7 | 128 | 416 |
| default | 2,000 | tree-async | 94.9 | 80.8 | 128 | 416 |
| default | 2,000 | search-async | 46.7 | 39.9 | 0 | 0 |
| default | 10,000 | tree-sync | 214.0 | 207.2 | 128 | 416 |
| default | 10,000 | tree-async | 356.5 | 312.2 | 128 | 416 |
| default | 10,000 | search-async | 181.9 | 162.4 | 0 | 0 |
| no_preview_throttle | 2,000 | tree-sync | 163.5 | 42.8 | 2,000 | 2,000 |
| no_preview_throttle | 2,000 | tree-async | 226.8 | 61.0 | 2,000 | 2,000 |
| no_preview_throttle | 2,000 | search-async | 47.8 | 33.4 | 0 | 0 |
| no_preview_throttle | 10,000 | tree-sync | 660.7 | 551.2 | 10,000 | 10,000 |
| no_preview_throttle | 10,000 | tree-async | 982.3 | 1367.2 | 10,000 | 10,000 |
| no_preview_throttle | 10,000 | search-async | 216.0 | 173.0 | 0 | 0 |
| conservative | 2,000 | tree-sync | 63.8 | 50.6 | 96 | 288 |
| conservative | 2,000 | tree-async | 97.2 | 81.2 | 96 | 288 |
| conservative | 2,000 | search-async | 51.3 | 36.3 | 0 | 0 |
| conservative | 10,000 | tree-sync | 222.9 | 212.8 | 96 | 288 |
| conservative | 10,000 | tree-async | 374.4 | 312.5 | 96 | 288 |
| conservative | 10,000 | search-async | 190.4 | 162.9 | 0 | 0 |

## Key Findings

1. Preview-unlimited scans are the core cold-start killer for big folders.
2. Current default preview throttling is materially faster for 10,000 files on tree scans.
3. Search-async path is already less sensitive to preview throttle settings (no preview reads).
4. Current index scheduling cap (effective 64 per run in cold+startup) trades startup smoothness for catch-up time.

## Index Scheduling Estimate (current defaults)

- base cap: `LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN=256`
- cold full cap enabled: `LOCAL_NOTE_INDEX_SYNC_COLD_FULL_MAX_INDEX_PER_RUN=64`
- startup cap enabled: `LOCAL_NOTE_INDEX_SYNC_STARTUP_MAX_INDEX_PER_RUN=64`
- effective cold startup cap: `64`
- `LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS=180`
- `LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS=120`

Estimated queue-delay floor (not including per-run indexing work):

| files | effective_cap | rounds | estimated_queue_delay_ms |
|---:|---:|---:|---:|
| 2,000 | 64 | 32 | 3,900 |
| 10,000 | 64 | 157 | 18,900 |

## Recommended Production Defaults

1. Keep preview throttling enabled. Do not set `LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN=0` for large mounts.
2. Keep cold/startup preview caps around current defaults:
   - `LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN=768`
   - `LOCAL_LIST_PREVIEW_COLD_SCAN_MAX_READS_PER_SCAN=128`
   - `LOCAL_LIST_PREVIEW_STARTUP_MAX_READS_PER_SCAN=192`
3. Keep cold/startup index caps enabled to protect responsiveness:
   - `LOCAL_NOTE_INDEX_SYNC_COLD_FULL_ADAPTIVE_ENABLED=1`
   - `LOCAL_NOTE_INDEX_SYNC_STARTUP_ADAPTIVE_ENABLED=1`
4. If index catch-up speed is too slow for 10k+ folders, tune in this order:
   - `LOCAL_NOTE_INDEX_SYNC_COLD_FULL_MAX_INDEX_PER_RUN: 64 -> 96`
   - `LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS: 120 -> 80`
   - keep startup cap conservative unless startup jank is acceptable

## Quick Re-run (2026-04-08, runs=2, files=2,000)

Command:

```bash
BENCH_LOCAL_FILE_COUNTS=2000 BENCH_LOCAL_RUNS=2 npx tsx scripts/bench-local-folder-scan.ts
```

| profile | files | mode | cold_ms | warm_ms | cold_preview | warm_preview |
|---|---:|---|---:|---:|---:|---:|
| default | 2,000 | tree-sync | 79.7 | 59.4 | 128 | 320 |
| default | 2,000 | tree-async | 107.9 | 100.9 | 128 | 320 |
| default | 2,000 | tree-async-fast | 94.6 | 84.7 | 0 | 0 |
| default | 2,000 | search-async | 122.7 | 46.7 | 0 | 0 |
| no_preview_throttle | 2,000 | tree-sync | 204.3 | 50.3 | 2,000 | 2,000 |
| no_preview_throttle | 2,000 | tree-async | 321.0 | 71.8 | 2,000 | 2,000 |
| no_preview_throttle | 2,000 | tree-async-fast | 79.3 | 75.8 | 0 | 0 |
| no_preview_throttle | 2,000 | search-async | 58.7 | 45.1 | 0 | 0 |
| conservative | 2,000 | tree-sync | 70.5 | 57.7 | 96 | 224 |
| conservative | 2,000 | tree-async | 105.1 | 82.8 | 96 | 224 |
| conservative | 2,000 | tree-async-fast | 80.8 | 65.2 | 0 | 0 |
| conservative | 2,000 | search-async | 56.3 | 37.1 | 0 | 0 |

Sanity conclusion: preview throttling remains the dominant cold-start lever; unlimited preview reads still 2.5-3x slower on tree cold scans.
`tree-async-fast` (preview disabled + unsorted scan) is consistently faster than full `tree-async` for cold first-load path and is suitable for startup fast-return with background warmup.

## Startup Guard Update (2026-04-08)

Additional long-term guardrails were added to reduce startup jank when FTS rebuild/indexing overlaps with mount scanning:

- FTS rebuild startup-adaptive scheduling in `embedding/database-core.ts`
  - startup delay (default): `KB_FTS_REBUILD_STARTUP_DELAY_MS=1500`
  - startup batch cap (default): `KB_FTS_REBUILD_STARTUP_BATCH_SIZE=192`
  - startup inter-batch gap (default): `KB_FTS_REBUILD_STARTUP_INTER_BATCH_DELAY_MS=8`
- Import indexing stage now separates `FTS-only` and `embedding` concurrency in `import-export/index.ts`
  - `FTS-only` default concurrency: `IMPORT_FTS_ONLY_INDEX_CONCURRENCY=1`
  - dedicated index-stage yielding: `IMPORT_INDEX_YIELD_INTERVAL=8`

These defaults prioritize responsiveness first; throughput can still be tuned upward through env vars for batch/offline scenarios.
