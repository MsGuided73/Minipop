// Full snapshot of the ContentLoom tables to a timestamped JSON file.
//
// Run before any schema or RLS change:  node scripts/backup-supabase.mjs
// Output lands in backups/ (gitignored — these contain all of your board
// content and are far too large and too personal to commit).
//
// Restores are manual and deliberate: read the file, decide what to put back.
// This is a safety net, not an automated rollback.
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const TABLES = ['pop_boards', 'pop_folders', 'pop_prompts', 'pop_transcripts']
const PAGE = 500

function readEnv() {
  const raw = fs.readFileSync('.env', 'utf8')
  return Object.fromEntries(
    raw.split(/\r?\n/)
      .filter(l => l && !l.startsWith('#') && l.includes('='))
      .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
  )
}

const env = readEnv()
if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
  console.error('SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env')
  process.exit(1)
}
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY)

// Paginate — a single select caps out well below the board count.
async function dumpTable(table) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outDir = 'backups'
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, `contentloom-${stamp}.json`)

const dump = { takenAt: new Date().toISOString(), project: env.SUPABASE_URL, tables: {} }
for (const t of TABLES) {
  dump.tables[t] = await dumpTable(t)
  console.log(`  ${t.padEnd(16)} ${String(dump.tables[t].length).padStart(5)} rows`)
}

fs.writeFileSync(outFile, JSON.stringify(dump, null, 2))
const mb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1)
console.log(`\nWrote ${outFile} (${mb} MB)`)
