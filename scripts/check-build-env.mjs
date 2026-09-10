// Runs before `vite build` (npm's prebuild hook), so it fires under Nixpacks,
// Docker, a PaaS, or a laptop — anywhere `npm run build` runs.
//
// Vite inlines VITE_* into the bundle at build time. A missing one does not
// fail the build: it compiles to `undefined`, the site loads, and every
// visitor gets the "auth is not configured" screen. That shipped once, so the
// build now refuses instead.
//
// The check goes through Vite's own loadEnv so it sees exactly what the build
// will: .env files in the project root plus the real environment. Reading
// process.env alone would report a false failure on a machine that keeps its
// values in .env.
//
// When a value is missing, the environment usually still contains it under a
// name nothing reads — a build-time variable named for Supabase's dashboard
// label rather than for this repo, say. "X is missing" is identical whether the
// variable was never set, set blank, set runtime-only, or set beside itself
// under the wrong name, so the message now names the near miss when it can.
// See scripts/near-miss.mjs.

import { loadEnv } from 'vite'
import { nearMisses } from './near-miss.mjs'

const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']

const mode = process.env.NODE_ENV === 'development' ? 'development' : 'production'
const env = loadEnv(mode, process.cwd(), '')

const valueOf = name => String(env[name] ?? process.env[name] ?? '').trim()

const missing = REQUIRED.filter(name => valueOf(name) === '')

if (missing.length === 0) {
  console.log(`✓ build env present: ${REQUIRED.join(', ')}`)
  process.exit(0)
}

// Only names that actually carry a value are worth pointing at. A blank
// variable would not have helped even under the right name.
const populated = [...new Set([...Object.keys(env), ...Object.keys(process.env)])]
  .filter(name => valueOf(name) !== '')

console.error('')
console.error('  Build stopped: required build-time variables are missing.')
console.error('')

for (const name of missing) {
  console.error(`    - ${name}`)

  const suggestions = nearMisses(name, populated, { exclude: REQUIRED })
  if (suggestions.length === 0) continue

  const label = suggestions.length === 1 ? 'A similar name is set' : 'Similar names are set'
  console.error(`        ${label}: ${suggestions.join(', ')}`)
  console.error('        Names are matched exactly — nothing resolves an')
  console.error(`        approximate one. If that holds the value, rename it to ${name}.`)
}

console.error('')
console.error('  These are baked into the bundle by Vite while this build runs.')
console.error('  Setting them on the running server has no effect — the values')
console.error('  are already absent from the compiled JavaScript.')
console.error('')
console.error('  Nixpacks / PaaS : mark them as BUILD-time variables, not runtime.')
console.error('                    Coolify calls this "Available at Buildtime".')
console.error('                    Leave "Use Docker Build Secrets" off: a secret')
console.error('                    is mounted as a file, and Vite reads env vars.')
console.error('  Docker          : pass them with --build-arg (see Dockerfile).')
console.error('  Locally         : put them in .env (see .env.example).')
console.error('')
process.exit(1)
