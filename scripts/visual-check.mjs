// Looks at the node cards in a real browser and fails if a header is broken.
//
// Why this exists: the card header was changed, reasoned about from the
// stylesheet, and shipped with the prompt name clipped to "COMPREHENSIVE C…".
// Nothing caught it — jsdom has no layout, so a test can assert the text is
// there while the user sees two thirds of it. This runs Chromium, which does
// have layout, and asks the questions only layout can answer.
//
//   npm run visual              boot Vite, check preview/cards.html
//   npm run visual -- --url=…   check a page that is already running
//
// The default target is preview/cards.html: the real LensNode, SemanticEdge
// and React Flow on fixture data, which needs no sign-in and no backend. To
// check the signed-in app instead, run the app and pass its URL with --url —
// the assertions look for cards, not for fixtures.
//
// A real board is behind the sign-in gate, and this browser has its own empty
// session, so --url signs in when credentials are configured:
//
//   AGENT_EMAIL=…
//   AGENT_PASSWORD=…
//
// in .env (gitignored) or the environment. Those are the owner's own
// credentials, not a bot's: this drives the real app as a real person, on real
// boards, which is the whole reason it is worth doing and the whole reason it
// is read-only. It opens a board and photographs it. Nothing here saves over,
// renames, or deletes anything — keep it that way. A new board is fine to
// create; an existing one is not ours to change.
//
// The session is kept in .visual/auth.json so later runs skip the form; that
// file is a live token, which is why .visual/ is gitignored. Delete it to sign
// in again.
//
// A signed-in browser starts on an empty canvas, since the app rehydrates from
// browser-local storage and this profile has none, so the run opens a board
// from the explorer: the first one, or --board=<name> to choose.
//
// Screenshots land in .visual/ in both themes, so a change can be looked at as
// well as asserted.

import 'dotenv/config'
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, '.visual')

// Its own port, so a dev server already running on 5173 is left alone.
const PORT = 5199
const DEFAULT_PATH = '/preview/cards.html'

const AUTH_STATE = path.join(OUT, 'auth.json')

const args = process.argv.slice(2)
const urlArg = args.find(a => a.startsWith('--url='))?.slice('--url='.length)

// A fresh browser profile has an empty canvas: the app rehydrates from
// browser-local storage, so an account's boards live on the server until one
// is opened. --board picks it by name; without it, the first board wins.
const boardArg = args.find(a => a.startsWith('--board='))?.slice('--board='.length)

const credentials = process.env.AGENT_EMAIL && process.env.AGENT_PASSWORD
  ? { email: process.env.AGENT_EMAIL, password: process.env.AGENT_PASSWORD }
  : null

const run = async () => {
  // Screenshots are regenerated every run; the saved session is not, or every
  // run would sign in again.
  const keptSession = await readIfPresent(AUTH_STATE)
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })
  if (keptSession) await writeFile(AUTH_STATE, keptSession)

  const server = urlArg ? null : await startVite()
  const url = urlArg || `http://localhost:${PORT}${DEFAULT_PATH}`

  const browser = await chromium.launch()
  try {
    const cards = await inspect(browser, url)
    report(cards)
    return cards.every(card => card.problems.length === 0) ? 0 : 1
  } finally {
    await browser.close()
    server?.kill()
  }
}

// ── The browser pass ─────────────────────────────────────────────────────────

async function inspect(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 2,
    storageState: await readIfPresent(AUTH_STATE) ? AUTH_STATE : undefined,
  })
  const page = await context.newPage()

  await page.goto(url, { waitUntil: 'domcontentloaded' })
  // A signed-in board fetches its nodes, so wait for a card rather than a tick.
  try {
    await page.waitForSelector('.cl-card', { timeout: 20_000 })
  } catch (err) {
    if (await atSignIn(page)) {
      await signIn(page, url)
      await context.storageState({ path: AUTH_STATE })
    } else if (!(await page.locator('.cl-shell').count())) {
      throw err
    }
    // Signed in, but on an empty canvas: open a board the way a person would.
    await openBoard(page)
    await page.waitForSelector('.cl-card', { timeout: 20_000 })
  }
  // React Flow settles its transform after mount; screenshotting mid-fit gives
  // half-placed cards and measurements taken against the wrong width.
  await page.waitForTimeout(1200)

  const cards = await page.evaluate(measureCards)

  await page.screenshot({ path: path.join(OUT, 'cards-dark.png'), fullPage: false })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(OUT, 'cards-light.png'), fullPage: false })

  return cards
}

// Runs in the page. Everything here is a question about laid-out pixels —
// anything answerable from the markup alone belongs in a unit test instead.
function measureCards() {
  const isClipped = el => !!el && el.scrollWidth > el.clientWidth + 1

  return [...document.querySelectorAll('.cl-card')].map(card => {
    const nameEl = card.querySelector('.cl-card-type')
    const tagEl = card.querySelector('.cl-card-family')
    const name = nameEl?.textContent?.trim() ?? ''
    const tag = tagEl?.textContent?.trim() ?? null
    const problems = []

    // The whole point of naming a card after its prompt is that the name is
    // readable. A name the header cuts off is the bug this script was born of.
    if (isClipped(nameEl)) problems.push(`name is clipped: "${name}"`)
    if (isClipped(tagEl)) problems.push(`tag is clipped: "${tag}"`)

    // A tag that repeats the name says nothing and costs a line.
    if (tag && tag.toLowerCase() === name.toLowerCase()) {
      problems.push(`tag repeats the name: "${tag}"`)
    }

    // The tag is the border colour written out; a tag on a card with no
    // identity hue means the two have drifted apart.
    const hue = card.style.getPropertyValue('--nc').trim()
    if (tag && (!hue || hue === 'var(--accent)')) {
      problems.push(`tagged "${tag}" but wearing the neutral accent`)
    }

    // The tag hangs off the name, not off the card edge.
    if (nameEl && tagEl) {
      const drift = Math.abs(nameEl.getBoundingClientRect().left - tagEl.getBoundingClientRect().left)
      if (drift > 1.5) problems.push(`tag is ${drift.toFixed(1)}px out of line with the name`)
    }

    return { name, tag, hue, problems }
  })
}

// ── Signing in ──────────────────────────────────────────────────────────

const atSignIn = page => page.locator('text=Sign in to your boards').count().then(Boolean)

async function signIn(page, url) {
  if (!credentials) {
    throw new Error(
      `${url} is showing the sign-in screen, and no credentials are configured. ` +
      'Set AGENT_EMAIL and AGENT_PASSWORD in .env, or drop --url to use the fixture canvas.'
    )
  }

  console.log(`  signing in as ${credentials.email}…`)
  await page.fill('input[type="email"]', credentials.email)
  await page.fill('input[type="password"]', credentials.password)
  await page.click('button[type="submit"]')

  // Supabase reports a bad password on the form rather than throwing, so watch
  // for the app and the error together and let whichever lands first speak.
  // Whatever Supabase said, verbatim: "Invalid login credentials", "Email not
  // confirmed" for an account whose link has not been clicked, a rate-limit
  // notice. The form renders all of them the same way, so match the shape of
  // an error rather than a list of wordings that will drift.
  const failed = page.locator('form p', {
    hasText: /invalid|incorrect|failed|not found|credentials|not confirmed|too many|disabled|rate/i,
  })
  const outcome = await Promise.race([
    page.waitForSelector('.cl-shell', { timeout: 30_000 }).then(() => 'in'),
    failed.first().waitFor({ timeout: 30_000 }).then(() => 'rejected'),
  ]).catch(() => 'stuck')

  if (outcome === 'rejected') {
    throw new Error(`sign-in was rejected: ${(await failed.first().textContent())?.trim()}`)
  }
  if (outcome === 'stuck') {
    throw new Error('signed in, but the app never appeared')
  }
}

/**
 * Opens a board from the workspace explorer. Folders start collapsed, so the
 * boards inside them are not clickable — or even present — until they are
 * opened.
 */
async function openBoard(page) {
  // Re-query each time: expanding one folder re-renders the list, so a single
  // snapshot of "collapsed folders" goes stale on the first click.
  const collapsed = page.locator('.cl-folder-row[aria-expanded="false"]')
  for (let guard = 0; guard < 40 && await collapsed.count(); guard++) {
    await collapsed.first().click()
    await page.waitForTimeout(120)
  }

  const boards = page.locator('.cl-file-row')
  await boards.first().waitFor({ timeout: 10_000 }).catch(() => {})

  const names = await boards.allTextContents()
  if (names.length === 0) {
    throw new Error(
      'signed in, but this account has no saved boards — build one with a card on it, ' +
      'or drop --url to use the fixture canvas'
    )
  }

  const wanted = boardArg
    ? names.findIndex(n => n.trim().toLowerCase().includes(boardArg.toLowerCase()))
    : 0
  if (wanted === -1) {
    throw new Error(`no board matching "${boardArg}" — this account has: ${names.map(n => n.trim()).join(', ')}`)
  }

  console.log(`  opening board "${names[wanted].trim()}"…`)
  await boards.nth(wanted).click()
}

async function readIfPresent(file) {
  try {
    return await readFile(file)
  } catch {
    return null
  }
}

// ── Reporting ────────────────────────────────────────────────────────────────

function report(cards) {
  if (cards.length === 0) {
    console.error('✗ no cards on the page — wrong URL, or the board is empty')
    process.exitCode = 1
    return
  }

  for (const card of cards) {
    const tag = card.tag ? ` [${card.tag}]` : ''
    if (card.problems.length === 0) {
      console.log(`✓ ${card.name}${tag}`)
    } else {
      console.log(`✗ ${card.name}${tag}`)
      for (const problem of card.problems) console.log(`    ${problem}`)
    }
  }

  const broken = cards.filter(c => c.problems.length > 0).length
  console.log(
    broken === 0
      ? `\n✓ ${cards.length} card${cards.length === 1 ? '' : 's'} check out — screenshots in ${path.relative(ROOT, OUT)}/`
      : `\n✗ ${broken} of ${cards.length} cards have a layout problem — see ${path.relative(ROOT, OUT)}/`
  )
}

// ── Vite ─────────────────────────────────────────────────────────────────────

async function startVite() {
  // Vite's own bin under this node, rather than npx through a shell: npx adds
  // a resolution step and a shell layer that swallow the exit code when the
  // port is taken, which reads as a hang instead of "port 5199 is in use".
  const bin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  const server = spawn(process.execPath, [bin, '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Vite did not start within 30s')), 30_000)
    const done = fn => (...a) => { clearTimeout(timer); fn(...a) }

    server.stdout.on('data', chunk => {
      const text = String(chunk)
      process.stdout.write(text.includes('ready in') ? '' : text)
      if (/ready in|Local:/.test(text)) done(resolve)()
    })
    server.stderr.on('data', chunk => process.stderr.write(chunk))
    // strictPort makes a taken port an exit, not a fallback — say so plainly
    // rather than timing out thirty seconds later.
    server.on('exit', code => done(reject)(
      new Error(`Vite exited with ${code} — is something already on port ${PORT}?`)
    ))
  })

  await ready
  return server
}

// A stack trace is noise for every failure this script has: they are all
// "the page did not show what it should have", and the message says it.
process.exitCode = await run().catch(err => {
  console.error(`✗ ${err.message}`)
  if (args.includes('--debug')) console.error(err)
  return 1
})
