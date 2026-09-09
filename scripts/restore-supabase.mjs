// Restore ContentLoom tables from a backup produced by backup-supabase.mjs.
//
//   node scripts/restore-supabase.mjs --owner <uuid> [--file backups/<name>.json] [--dry]
//
// --owner is REQUIRED and is the auth.users id every restored row will be
// attributed to. Board/folder/prompt rows are re-owned to that account rather
// than restored with their original user_id, because a deleted account's uuid
// can never come back and its foreign key would reject the insert.
//
// pop_transcripts is restored as-is: it has no owner column.
//
// Idempotent per row: upserts on primary key, so re-running is safe and a
// partial restore can simply be re-run.
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? null : args[i + 1]
}
const DRY = args.includes('--dry')
const owner = flag('owner')

if (!owner || !/^[0-9a-f-]{36}$/i.test(owner)) {
  console.error('Missing or malformed --owner <uuid>.')
  console.error('Find it with: select id from auth.users where email = \'you@example.com\';')
  process.exit(1)
}

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY)

const file = flag('file') || path.join('backups',
  fs.readdirSync('backups').filter(f => f.endsWith('.json')).sort().pop())

const dump = JSON.parse(fs.readFileSync(file, 'utf8'))
console.log(`Restoring from ${file} (taken ${dump.takenAt})`)
console.log(`Owner for restored rows: ${owner}\n`)

// Owned tables get their user_id rewritten; the cache table does not.
const OWNED = ['pop_boards', 'pop_folders', 'pop_prompts']
const UNOWNED = ['pop_transcripts']
const CHUNK = 50

async function restore(table, rows, reown) {
  if (!rows?.length) { console.log(`  ${table.padEnd(17)} nothing in backup, skipped`); return }
  const prepared = reown ? rows.map(r => ({ ...r, user_id: owner })) : rows

  if (DRY) { console.log(`  ${table.padEnd(17)} [dry] would upsert ${prepared.length} rows`); return }

  let done = 0
  for (let i = 0; i < prepared.length; i += CHUNK) {
    const batch = prepared.slice(i, i + CHUNK)
    const { error } = await supabase.from(table).upsert(batch)
    if (error) throw new Error(`${table} rows ${i}-${i + batch.length - 1}: ${error.message}`)
    done += batch.length
    process.stdout.write(`\r  ${table.padEnd(17)} ${done}/${prepared.length}`)
  }
  console.log('')
}

for (const t of OWNED) await restore(t, dump.tables[t], true)
for (const t of UNOWNED) await restore(t, dump.tables[t], false)

console.log(`\n${DRY ? 'Dry run complete — nothing written.' : 'Restore complete.'}`)
console.log('Verify with: npx supabase db query --linked --project-ref dfcppzpppqgphjjxypyw -f supabase/verify_ownership.sql')
console.log('(update the expected owner uuid in that file first)')
