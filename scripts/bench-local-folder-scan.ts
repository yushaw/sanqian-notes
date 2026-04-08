/**
 * Benchmark local-folder tree scan performance with synthetic markdown files.
 *
 * Run:
 *   npx tsx scripts/bench-local-folder-scan.ts
 *
 * Optional env:
 *   BENCH_LOCAL_FILE_COUNTS=2000,10000
 *   BENCH_LOCAL_RUNS=2
 *   BENCH_LOCAL_BUCKET_SIZE=100
 *   BENCH_LOCAL_KEEP_DATA=1
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { performance } from 'perf_hooks'
import { spawnSync } from 'child_process'

type ScanMode = 'tree-sync' | 'tree-async' | 'tree-async-fast' | 'search-async'

interface ScanRunMetric {
  runIndex: number
  durationMs: number
  fileCount: number
  previewNonEmptyCount: number
}

interface WorkerResult {
  mode: ScanMode
  runs: number
  metrics: ScanRunMetric[]
}

interface ProfileConfig {
  name: string
  env: Record<string, string>
}

interface BenchmarkSummaryRow {
  profile: string
  datasetFiles: number
  mode: ScanMode
  coldMs: number
  warmMs: number
  previewCold: number
  previewWarm: number
  fileCount: number
}

interface IndexSchedulingEstimate {
  datasetFiles: number
  effectiveMaxIndexPerRun: number
  rounds: number
  estimatedQueueDelayMs: number
}

function parseArg(flag: string): string | null {
  const index = process.argv.indexOf(flag)
  if (index < 0) return null
  const value = process.argv[index + 1]
  return value || null
}

function parsePositiveInt(raw: string | undefined, fallback: number, min: number = 1): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.floor(parsed))
}

function parseFileCounts(raw: string | undefined): number[] {
  const values = (raw || '2000,10000')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.floor(value))
  if (values.length === 0) return [2000, 10000]
  return values
}

function createMount(rootPath: string): {
  notebook: {
    id: string
    name: string
    icon: string
    source_type: 'local-folder'
    order_index: number
    created_at: string
  }
  mount: {
    notebook_id: string
    root_path: string
    canonical_root_path: string
    status: 'active'
    created_at: string
    updated_at: string
  }
} {
  const now = new Date().toISOString()
  return {
    notebook: {
      id: 'bench-local-folder',
      name: 'Bench Local Folder',
      icon: 'logo:notes',
      source_type: 'local-folder',
      order_index: 0,
      created_at: now,
    },
    mount: {
      notebook_id: 'bench-local-folder',
      root_path: rootPath,
      canonical_root_path: rootPath,
      status: 'active',
      created_at: now,
      updated_at: now,
    },
  }
}

function generateSyntheticMarkdownDataset(rootPath: string, fileCount: number, bucketSize: number): void {
  const normalizedBucketSize = Math.max(1, bucketSize)
  for (let index = 0; index < fileCount; index += 1) {
    const bucket = Math.floor(index / normalizedBucketSize)
    const bucketDir = path.join(
      rootPath,
      `group-${String(Math.floor(bucket / 10)).padStart(3, '0')}`,
      `bucket-${String(bucket).padStart(4, '0')}`
    )
    mkdirSync(bucketDir, { recursive: true })
    const fileName = `note-${String(index).padStart(6, '0')}.md`
    const body = [
      `# Synthetic Note ${index}`,
      '',
      `This is benchmark content for file ${index}.`,
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
      'Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae.',
      '',
      '- item one',
      '- item two',
      '- item three',
      '',
      '```ts',
      `const sample = ${index}`,
      '```',
      '',
      `[[link-${index % 17}]]`,
      '',
    ].join('\n')
    writeFileSync(path.join(bucketDir, fileName), body, 'utf-8')
  }
}

async function runWorkerMode(): Promise<void> {
  const rootPath = parseArg('--root')
  const modeRaw = parseArg('--mode')
  const runs = parsePositiveInt(parseArg('--runs') || undefined, 2)
  if (!rootPath || !modeRaw) {
    throw new Error('Missing --root or --mode for worker mode.')
  }

  const mode = modeRaw as ScanMode
  if (
    mode !== 'tree-sync'
    && mode !== 'tree-async'
    && mode !== 'tree-async-fast'
    && mode !== 'search-async'
  ) {
    throw new Error(`Unsupported worker mode: ${modeRaw}`)
  }

  const mount = createMount(rootPath)
  const scanModule = require('../src/main/local-folder/scan') as typeof import('../src/main/local-folder/scan')

  const metrics: ScanRunMetric[] = []
  for (let runIndex = 0; runIndex < runs; runIndex += 1) {
    const startedAt = performance.now()
    let result: Awaited<ReturnType<typeof scanModule.scanLocalFolderMountForSearchAsync>>
    if (mode === 'tree-sync') {
      result = scanModule.scanLocalFolderMount(mount)
    } else if (mode === 'tree-async') {
      result = await scanModule.scanLocalFolderMountAsync(mount)
    } else if (mode === 'tree-async-fast') {
      result = await scanModule.scanLocalFolderMountAsync(mount, {
        includePreview: false,
        sortEntries: false,
      })
    } else {
      result = await scanModule.scanLocalFolderMountForSearchAsync(mount)
    }
    const durationMs = performance.now() - startedAt
    const previewNonEmptyCount = result.files.reduce((count, file) => (
      (file.preview?.trim().length || 0) > 0 ? count + 1 : count
    ), 0)
    metrics.push({
      runIndex,
      durationMs,
      fileCount: result.files.length,
      previewNonEmptyCount,
    })
  }

  const payload: WorkerResult = {
    mode,
    runs,
    metrics,
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function runWorkerProcess(input: {
  scriptPath: string
  rootPath: string
  runs: number
  mode: ScanMode
  profile: ProfileConfig
}): WorkerResult {
  const child = spawnSync(
    process.execPath,
    ['-r', 'tsx/cjs', input.scriptPath, '--worker', '--root', input.rootPath, '--mode', input.mode, '--runs', String(input.runs)],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        ...input.profile.env,
      },
    }
  )

  if (child.status !== 0) {
    throw new Error(
      [
        `Worker failed: profile=${input.profile.name}, mode=${input.mode}, status=${child.status}`,
        child.stdout || '',
        child.stderr || '',
      ].join('\n')
    )
  }

  const lines = (child.stdout || '').split('\n').map((line) => line.trim()).filter(Boolean)
  const lastLine = lines[lines.length - 1]
  if (!lastLine) {
    throw new Error(`Worker produced no result: profile=${input.profile.name}, mode=${input.mode}`)
  }
  return JSON.parse(lastLine) as WorkerResult
}

function formatNumber(value: number, fractionDigits: number = 1): string {
  return value.toFixed(fractionDigits)
}

function estimateWarmMs(metrics: ScanRunMetric[]): number {
  if (metrics.length <= 1) return metrics[0]?.durationMs || 0
  const warmMetrics = metrics.slice(1)
  const total = warmMetrics.reduce((sum, metric) => sum + metric.durationMs, 0)
  return total / warmMetrics.length
}

function estimateWarmPreview(metrics: ScanRunMetric[]): number {
  if (metrics.length <= 1) return metrics[0]?.previewNonEmptyCount || 0
  const warmMetrics = metrics.slice(1)
  const total = warmMetrics.reduce((sum, metric) => sum + metric.previewNonEmptyCount, 0)
  return Math.round(total / warmMetrics.length)
}

function printSummaryTable(rows: BenchmarkSummaryRow[]): void {
  const header = [
    'profile',
    'files',
    'mode',
    'cold_ms',
    'warm_ms',
    'cold_preview',
    'warm_preview',
    'scanned_files',
  ]
  const lines = [header.join('\t')]
  for (const row of rows) {
    lines.push([
      row.profile,
      String(row.datasetFiles),
      row.mode,
      formatNumber(row.coldMs, 1),
      formatNumber(row.warmMs, 1),
      String(row.previewCold),
      String(row.previewWarm),
      String(row.fileCount),
    ].join('\t'))
  }
  console.log(lines.join('\n'))
}

function parseEnvInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.floor(parsed))
}

function resolveEffectiveIndexCap(): {
  baseCap: number
  coldEnabled: boolean
  coldCap: number
  startupEnabled: boolean
  startupCap: number
  initialDelayMs: number
  requeueDelayMs: number
  effectiveCap: number
} {
  const baseCap = parseEnvInt(process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN, 256)
  const coldEnabled = process.env.LOCAL_NOTE_INDEX_SYNC_COLD_FULL_ADAPTIVE_ENABLED !== '0'
  const coldCap = parseEnvInt(process.env.LOCAL_NOTE_INDEX_SYNC_COLD_FULL_MAX_INDEX_PER_RUN, 64)
  const startupEnabled = process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_ADAPTIVE_ENABLED !== '0'
  const startupCap = parseEnvInt(process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_MAX_INDEX_PER_RUN, 64)
  const initialDelayMs = parseEnvInt(process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS, 180)
  const requeueDelayMs = parseEnvInt(process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS, 120)

  let effectiveCap = baseCap
  if (coldEnabled && coldCap > 0) {
    effectiveCap = effectiveCap <= 0 ? coldCap : Math.min(effectiveCap, coldCap)
  }
  if (startupEnabled && startupCap > 0) {
    effectiveCap = effectiveCap <= 0 ? startupCap : Math.min(effectiveCap, startupCap)
  }

  return {
    baseCap,
    coldEnabled,
    coldCap,
    startupEnabled,
    startupCap,
    initialDelayMs,
    requeueDelayMs,
    effectiveCap,
  }
}

function buildIndexSchedulingEstimates(fileCounts: number[]): {
  config: ReturnType<typeof resolveEffectiveIndexCap>
  rows: IndexSchedulingEstimate[]
} {
  const config = resolveEffectiveIndexCap()
  const rows: IndexSchedulingEstimate[] = []
  for (const datasetFiles of fileCounts) {
    const rounds = config.effectiveCap <= 0
      ? 1
      : Math.max(1, Math.ceil(datasetFiles / config.effectiveCap))
    const estimatedQueueDelayMs = rounds <= 1
      ? config.initialDelayMs
      : config.initialDelayMs + ((rounds - 1) * config.requeueDelayMs)
    rows.push({
      datasetFiles,
      effectiveMaxIndexPerRun: config.effectiveCap,
      rounds,
      estimatedQueueDelayMs,
    })
  }
  return { config, rows }
}

function printIndexSchedulingEstimate(fileCounts: number[]): void {
  const { config, rows } = buildIndexSchedulingEstimates(fileCounts)
  console.log('\n[bench-local-folder] index_scheduling_estimate')
  console.log(
    [
      `base_cap=${config.baseCap}`,
      `cold_enabled=${config.coldEnabled ? 1 : 0}`,
      `cold_cap=${config.coldCap}`,
      `startup_enabled=${config.startupEnabled ? 1 : 0}`,
      `startup_cap=${config.startupCap}`,
      `effective_cap=${config.effectiveCap}`,
      `initial_delay_ms=${config.initialDelayMs}`,
      `requeue_delay_ms=${config.requeueDelayMs}`,
    ].join(' ')
  )
  console.log('files\teffective_cap\trounds\testimated_queue_delay_ms')
  for (const row of rows) {
    console.log(`${row.datasetFiles}\t${row.effectiveMaxIndexPerRun}\t${row.rounds}\t${row.estimatedQueueDelayMs}`)
  }
}

async function runOrchestratorMode(): Promise<void> {
  const scriptPath = __filename
  const fileCounts = parseFileCounts(process.env.BENCH_LOCAL_FILE_COUNTS)
  const runs = parsePositiveInt(process.env.BENCH_LOCAL_RUNS, 2)
  const bucketSize = parsePositiveInt(process.env.BENCH_LOCAL_BUCKET_SIZE, 100)
  const keepData = process.env.BENCH_LOCAL_KEEP_DATA === '1'

  const profiles: ProfileConfig[] = [
    {
      name: 'default',
      env: {
        LOCAL_FOLDER_SCAN_PROFILE: '0',
        LOCAL_FOLDER_SCAN_SLOW_LOG_MS: '999999',
      },
    },
    {
      name: 'no_preview_throttle',
      env: {
        LOCAL_FOLDER_SCAN_PROFILE: '0',
        LOCAL_FOLDER_SCAN_SLOW_LOG_MS: '999999',
        LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN: '0',
        LOCAL_LIST_PREVIEW_COLD_SCAN_ADAPTIVE_ENABLED: '0',
        LOCAL_LIST_PREVIEW_STARTUP_ADAPTIVE_ENABLED: '0',
      },
    },
    {
      name: 'conservative',
      env: {
        LOCAL_FOLDER_SCAN_PROFILE: '0',
        LOCAL_FOLDER_SCAN_SLOW_LOG_MS: '999999',
        LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN: '512',
        LOCAL_LIST_PREVIEW_COLD_SCAN_MAX_READS_PER_SCAN: '96',
        LOCAL_LIST_PREVIEW_STARTUP_MAX_READS_PER_SCAN: '128',
      },
    },
  ]

  const modes: ScanMode[] = ['tree-sync', 'tree-async', 'tree-async-fast', 'search-async']
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'sanqian-local-bench-'))
  const datasetDirs = new Map<number, string>()
  const generatedAt = new Date().toISOString()
  const rows: BenchmarkSummaryRow[] = []

  try {
    console.log(`[bench-local-folder] generated_at=${generatedAt}`)
    console.log(`[bench-local-folder] temp_root=${tempRoot}`)
    console.log(`[bench-local-folder] file_counts=${fileCounts.join(',')} runs=${runs} bucket_size=${bucketSize}`)

    for (const fileCount of fileCounts) {
      const datasetDir = path.join(tempRoot, `dataset-${fileCount}`)
      mkdirSync(datasetDir, { recursive: true })
      const datasetStartedAt = performance.now()
      generateSyntheticMarkdownDataset(datasetDir, fileCount, bucketSize)
      const datasetMs = performance.now() - datasetStartedAt
      datasetDirs.set(fileCount, datasetDir)
      console.log(`[bench-local-folder] dataset_ready files=${fileCount} path=${datasetDir} generate_ms=${formatNumber(datasetMs, 1)}`)
    }

    for (const profile of profiles) {
      for (const fileCount of fileCounts) {
        const rootPath = datasetDirs.get(fileCount)
        if (!rootPath) continue
        for (const mode of modes) {
          const result = runWorkerProcess({
            scriptPath,
            rootPath,
            runs,
            mode,
            profile,
          })
          const cold = result.metrics[0]
          const warmMs = estimateWarmMs(result.metrics)
          const warmPreview = estimateWarmPreview(result.metrics)
          rows.push({
            profile: profile.name,
            datasetFiles: fileCount,
            mode,
            coldMs: cold?.durationMs || 0,
            warmMs,
            previewCold: cold?.previewNonEmptyCount || 0,
            previewWarm: warmPreview,
            fileCount: cold?.fileCount || 0,
          })
          console.log(
            `[bench-local-folder] profile=${profile.name} files=${fileCount} mode=${mode} cold_ms=${formatNumber(cold?.durationMs || 0, 1)} warm_ms=${formatNumber(warmMs, 1)} preview_cold=${cold?.previewNonEmptyCount || 0} preview_warm=${warmPreview}`
          )
        }
      }
    }

    console.log('\n[bench-local-folder] summary')
    printSummaryTable(rows)
    printIndexSchedulingEstimate(fileCounts)
  } finally {
    if (keepData) {
      console.log(`[bench-local-folder] keep_data=1, temp data retained at ${tempRoot}`)
    } else {
      rmSync(tempRoot, { recursive: true, force: true })
      console.log(`[bench-local-folder] temp data removed`)
    }
  }
}

async function main(): Promise<void> {
  const workerMode = process.argv.includes('--worker')
  if (workerMode) {
    await runWorkerMode()
    return
  }
  await runOrchestratorMode()
}

void main().catch((error) => {
  console.error('[bench-local-folder] failed:', error)
  process.exit(1)
})
