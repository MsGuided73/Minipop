// Runs after `vite build` (npm's postbuild hook).
//
// The prebuild check proves the variables were readable; this proves they
// actually reached the bundle. Those are different failures — a build cache
// can serve a stale artifact compiled before the values existed, which looks
// exactly like a successful deploy and is what made this hard to see the
// first time.
//
// Verifying the built artifact rather than the source it came from is a
// standing lesson in this repo; see BUILDLOG.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ASSETS = join('dist', 'assets')

// Supabase anon keys are JWTs (eyJ…); newer projects issue sb_publishable_…
const KEY_SHAPE = /eyJ[A-Za-z0-9_-]{10,}|sb_publishable_[A-Za-z0-9_-]{10,}/

let bundles
try {
  bundles = readdirSync(ASSETS).filter(f => f.endsWith('.js'))
} catch {
  console.error(`\n  Build verification failed: ${ASSETS} does not exist.\n`)
  process.exit(1)
}

if (bundles.length === 0) {
  console.error(`\n  Build verification failed: no JavaScript emitted into ${ASSETS}.\n`)
  process.exit(1)
}

const carrier = bundles.find(f => KEY_SHAPE.test(readFileSync(join(ASSETS, f), 'utf8')))

if (!carrier) {
  console.error('')
  console.error('  Build verification failed: no Supabase key found in the bundle.')
  console.error('')
  console.error(`  Searched: ${bundles.map(b => join(ASSETS, b)).join(', ')}`)
  console.error('')
  console.error('  The build env check passed, so the values were readable but did')
  console.error('  not get inlined. The usual cause is a cached build step reusing')
  console.error('  an artifact compiled before the variables existed — clear the')
  console.error('  build cache and deploy again.')
  console.error('')
  process.exit(1)
}

console.log(`✓ bundle carries the Supabase key (${join(ASSETS, carrier)})`)
