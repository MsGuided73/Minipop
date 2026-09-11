# ContentLoom
Convert Videos into actionable items with the push of a button. Take learning to a new level

## Checking the UI

`npm test` runs in jsdom, which has no layout: it can confirm a label is on the
card while the browser is cutting it in half. `npm run visual` opens the node
cards in real Chromium and fails on the things only layout can answer — a
clipped prompt name, a tag that repeats it or contradicts the border colour, a
tag out of line with the name it hangs under. Screenshots of both themes land
in `.visual/`.

```bash
npx playwright install chromium   # once, ~115MB, lives outside the repo
npm run visual                    # boots Vite on :5199, checks preview/cards.html
npm run visual -- --url=http://localhost:3000/   # or check a real board
```

The default target is `preview/cards.html`: the real card components on a real
React Flow canvas with fixture data, so it needs no sign-in and no backend.

`--url` points it at a running instance instead. One thing to know about
`:3000`, the port the app is usually opened on: it is Express serving `dist/`,
so it shows the **last build** rather than the working tree — run `npm run
build` first, or point at Vite on `:5173` for live source.

A real board is behind the sign-in gate, and the check drives its own browser
with its own empty session. Give it a test account:

```bash
# .env (gitignored)
VISUAL_EMAIL=visual-bot@example.com
VISUAL_PASSWORD=...
```

It signs in, then keeps the session in `.visual/auth.json` so later runs go
straight to the board; delete that file to sign in again. Use an account that
exists only for this — the run drives the real app as whoever signs in, and
`auth.json` is a live token (which is why `.visual/` is gitignored). Without
credentials the check says the page is at the sign-in screen instead of timing
out on a missing card.
