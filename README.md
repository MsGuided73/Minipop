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
npm run visual -- --url=http://localhost:5173/   # or check a signed-in board
```

The default target is `preview/cards.html`: the real card components on a real
React Flow canvas with fixture data, so it needs no sign-in and no backend. To
check a real board instead, run `npm run dev`, sign in, and pass its URL.
