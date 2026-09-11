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
//   npm run visual -- --open    leave the screenshots' directory path printed
//
// The default target is preview/cards.html: the real LensNode, SemanticEdge
// and React Flow on fixture data, which needs no sign-in and no backend. To
// check the signed-in app instead, run `npm run dev`, sign in, and pass the
// board's URL with --url — the assertions look for cards, not for fixtures.
//
// Screenshots land in .visual/ (gitignored) in both themes, so a change can be
// looked at as well as asserted.

import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, '.visual')

// Its own port, so a dev server already running on 5173 is left alone.
const PORT = 5199
const DEFAULT_PATH = '/preview/cards.html'

const args = process.argv.slice(2)
const urlArg = args.find(a => a.startsWith('--url='))?.slice('--url='.length)

const run = async () => {
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

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
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 2,
  })

  await page.goto(url, { waitUntil: 'domcontentloaded' })
  // A signed-in board fetches its nodes, so wait for a card rather than a tick.
  try {
    await page.waitForSelector('.cl-card', { timeout: 20_000 })
  } catch (err) {
    // The likeliest reason a real board shows no cards is the sign-in screen,
    // and "waiting for selector timed out" does not say that.
    const gate = await page.locator('text=Sign in to your boards').count()
    if (gate) throw new Error(`${url} is showing the sign-in screen — sign in in a browser first, or drop --url to use the fixture canvas`)
    throw err
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

process.exitCode = await run()
