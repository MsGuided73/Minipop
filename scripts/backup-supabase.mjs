// Full snapshot of the ContentLoom tables to a timestamped JSON file.
//
//   node scripts/backup-supabase.mjs
//
// Output lands in backups/ (gitignored — these hold all of your board content).
//
// WHY THIS USES THE CLI AND NOT supabase-js
// The first version read with the anon key. Once row-level security was
// enabled, every policy became `to authenticated`, so an unauthenticated read
// returns zero rows *without an error*. The script cheerfully wrote a 0-row
// backup and reported success. An empty backup that looks healthy is worse
// than no backup, so reads now go through `supabase db query`, whose
// Management API connection is privileged and sees every row.
//
// The sanity check at the end exists for the same reason: a backup is only
// useful if a silent failure is loud.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const PROJECT_REF = 'dfcppzpppqgphjjxypyw'
const TABLES = ['pop_boards', 'pop_folders', 'pop_prompts', 'pop_transcripts']
const PAGE = 25   // boards carry large node/edge graphs; keep responses modest

// SQL goes through a temp file rather than argv: the CLI is invoked via a shell
// on Windows, which word-splits an inline query and mangles it.
const TMP = path.join(process.env.TEMP || '.', `cl-backup-${process.pid}.sql`)

function query(sql) {
  fs.writeFileSync(TMP, sql)
  let out
  try {
    out = execFileSync(
      'npx',
      ['supabase', 'db', 'query', '--linked', '--project-ref', PROJECT_REF, '-f', TMP],
      { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, shell: true }
    )
  } catch (err) {
    const detail = (err.stdout || err.message || '').slice(0, 300)
    throw new Error(`CLI query failed: ${detail}`)
  }
  const start = out.indexOf('{')
  if (start === -1) throw new Error(`unparseable CLI output:\n${out.slice(0, 300)}`)
  const parsed = JSON.parse(out.slice(start))
  if (parsed._tag === 'Error') throw new Error(`query error: ${JSON.stringify(parsed.error).slice(0, 200)}`)
  return parsed.rows
}

function count(table) {
  return Number(query(`select count(*)::text as n from ${table};`)[0].n)
}

function page(table, limit, offset) {
  const rows = query(
    `select coalesce(jsonb_agg(t), '[]')::text as j
     from (select * from ${table} order by id limit ${limit} offset ${offset}) t;`
  )
  return JSON.parse(rows[0].j)
}

const dump = { takenAt: new Date().toISOString(), project: PROJECT_REF, tables: {} }
const expected = {}

for (const table of TABLES) {
  expected[table] = count(table)
  const rows = []
  for (let off = 0; off < expected[table]; off += PAGE) {
    rows.push(...page(table, PAGE, off))
    process.stdout.write(`\r  ${table.padEnd(17)} ${rows.length}/${expected[table]}`)
  }
  dump.tables[table] = rows
  console.log(`\r  ${table.padEnd(17)} ${rows.length}/${expected[table]} rows`)
}

// ── Sanity checks: refuse to write a backup that is obviously wrong ──────────
const problems = []
for (const table of TABLES) {
  const got = dump.tables[table].length
  if (got !== expected[table]) {
    problems.push(`${table}: captured ${got} but the table holds ${expected[table]}`)
  }
}
const grandTotal = TABLES.reduce((s, t) => s + dump.tables[t].length, 0)
if (grandTotal === 0) {
  problems.push('every table came back empty — the connection is probably not privileged')
}

if (problems.length) {
  console.error('\nBACKUP ABORTED — nothing written:')
  problems.forEach(p => console.error(`  - ${p}`))
  process.exit(1)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
fs.mkdirSync('backups', { recursive: true })
const outFile = path.join('backups', `contentloom-${stamp}.json`)
fs.writeFileSync(outFile, JSON.stringify(dump, null, 2))

const mb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1)
console.log(`\nWrote ${outFile} (${mb} MB)`)
fs.rmSync(TMP, { force: true })
console.log(`Verified: ${grandTotal} rows across ${TABLES.length} tables.`)
