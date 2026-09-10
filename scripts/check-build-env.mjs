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

import { loadEnv } from 'vite'

const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']

const mode = process.env.NODE_ENV === 'development' ? 'development' : 'production'
const env = loadEnv(mode, process.cwd(), '')

const missing = REQUIRED.filter(name => !String(env[name] ?? process.env[name] ?? '').trim())

if (missing.length > 0) {
  console.error('')
  console.error('  Build stopped: required build-time variables are missing.')
  console.error('')
  for (const name of missing) console.error(`    - ${name}`)
  console.error('')
  console.error('  These are baked into the bundle by Vite while this build runs.')
  console.error('  Setting them on the running server has no effect — the values')
  console.error('  are already absent from the compiled JavaScript.')
  console.error('')
  console.error('  Nixpacks / PaaS : mark them as BUILD-time variables, not runtime.')
  console.error('  Docker          : pass them with --build-arg (see Dockerfile).')
  console.error('  Locally         : put them in .env (see .env.example).')
  console.error('')
  process.exit(1)
}

console.log(`✓ build env present: ${REQUIRED.join(', ')}`)
