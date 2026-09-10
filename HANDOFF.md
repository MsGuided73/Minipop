# ContentLoom — Handoff

Last updated: 2026-09-09 · `main` @ `f1023c3` · node cards + reader landed

---

## 1. Read this first

**Restart the server.** The running process predates the cache fix. Stop it,
`npm run dev`, then one hard refresh. After that, browsers always revalidate
`index.html` and new work appears immediately.

**Port 3000 is contested.** A separate Next.js app (BensonIQ, in
`C:\Users\benso\bensoniq-website`) also binds it. If ContentLoom looks wrong,
confirm which app answers on 3000 *before* debugging. `PORT=3011 npm run dev`
moves ContentLoom; the Vite proxy follows via `API_PORT`.

**Design sources.** Two artifacts define the redesign — read both before
touching UI:
- `ContentLoom Design Schema` — https://claude.ai/code/artifact/e96b0053-6581-4981-9f25-980dc009d5dd
- `ContentLoom Node Redesign` — https://claude.ai/code/artifact/5a6b837f-addf-48d3-9199-fe19a96f32e9
  (full 1186-line HTML saved at
  `~/.claude/projects/c--dev-minipop-Minipop/b5e904c5-.../tool-results/artifact-5a6b837f-1788256305-a321.html`)

The schema is the source of truth for every colour, font and scale. It is
already ported to `src/styles/tokens.css`.

---

## 2. Where things stand

### Auth and data — done, verified

- Every `/api/v1` route requires a Supabase session; unauthenticated requests
  get 401, not empty data.
- RLS on all four tables with per-user policies. `pop_transcripts` is
  deliberately shared between signed-in users: it is a cache keyed by video id,
  and per-user copies would re-buy transcripts from Apify.
- `user_id` on boards/folders/prompts: `NOT NULL`, `DEFAULT auth.uid()`,
  `ON DELETE RESTRICT`.
- Owner: `620e8d16-1a29-47fa-a002-0e48e21246e4`. This is a **new** account; the
  original was deleted and its uuid cannot be reissued.
- 174 boards, 9 folders, 24 prompts, 127 transcripts.

### Redesign

| Piece | State |
|---|---|
| Tokens, 3 fonts, light/dark/legacy themes | done |
| Topbar, icon rail, workspace explorer | done |
| Save dialog: suggested name, subject, project | done |
| Projects (`pop_projects`, `project_id`, GET/POST API) | done — no UI to manage projects outside the save dialog |
| Board filing — 171/174 into 7 subjects | done |
| Markdown renderer (XSS-safe, 39 tests) | done — headings, links, images, nested/task lists, tables, fenced code |
| Node identity (type → hue) | done — sets card and edge colour (17 tests) |
| `DocumentReader` drawer | done — opened by a Lens card's Read button |
| Node cards + colored edges | done — §3 |
| In-canvas YouTube player | **not started — §4** |
| Settings: provider cards, prompt defaults | not started |

---

## 3. Node cards + the reader — done

`LensNode` is a 270px card: type dot and uppercase label in the node's hue,
status chip in the header, title, a 3-line clamped preview, and a footer of
`1 source · 3 sections` plus `Read ⤢`. Read opens `DocumentReader` in a portal
on `document.body` — React Flow transforms its viewport, and `position: fixed`
inside a transformed ancestor resolves against that ancestor, not the window.

The thread stays on the node. The reader is a view over it, and its follow-up
composer posts back into the same thread.

**Decisions worth knowing:**

- **The reader shows the thread, not just the last message.** With no
  follow-ups that is identical to "the last assistant message". Once a
  conversation has happened, the exchanges are appended under the document
  rather than replacing it — otherwise asking "shorten section 3" makes the
  whole document disappear behind a three-line reply.
- **A document names its own node.** On the first run, if the document opens
  with a heading and nobody has renamed the node, the heading becomes the
  label (`data.autoLabel`). Renaming by hand clears the flag for good.
- **Prompt tags now reach the node** (`data.promptTags`), because
  `identityFor` reads tags before titles. Nodes saved earlier have no tags and
  fall back to title matching, which is why some older cards take the accent
  rather than a type hue.
- **Old lens nodes are resized on load.** They carry `{width: 380, height: 460}`
  from the old chat layout; the card normalises that to `{width: 270}` on
  mount. This is a silent rewrite of saved geometry, and it discards any manual
  resize — accepted because `NodeResizer` is gone and the alternative is a card
  floating in a 460px invisible hit area.
- **Two things from the old chat node have no replacement:** per-message copy
  (whole-document copy and `Copy transcript` remain) and find-in-conversation
  (the reader renders real DOM, so browser Ctrl+F now works, and it has A−/A+).

**The reader is styled as a Google Doc, on purpose.** This is a deliberate
departure from the Design Schema, at the owner's request: markdown should look
the way it looks pasted into Google Docs. So the document is Arial, not
Fraunces/Source Serif — 11pt body, 20/16/14/12pt bold headings, 1.38 leading,
dash bullets with hanging indents, ruled tables. The drawer's *chrome* (type
label, dot, controls) still carries the node's identity hue; only the document
body is neutral, which is what makes it read as a document rather than as part
of the app.

The page follows the app theme rather than forcing white — Google Docs does the
same in dark mode. Everything reads from `--reader-ink` / `--reader-bg`, so
"always a white page" is a change to those two tokens, not to the rules.

`src/lib/markdown.js` was rewritten for this: it now covers links (scheme-checked
against `javascript:`), images, arbitrarily nested lists, task lists, tables with
alignment, fenced code and strikethrough. It still escapes **before** formatting,
so it emits only its own tags and needs no sanitizer — that property is worth
more than any library, so keep it if you extend the file. The old renderer also
emitted nested `<ul>` as a *sibling* of `<li>`, which was invalid; a test had
codified that, and the test was wrong.

**The trap that cost the most time here:** `src/index.css` styled
`.react-flow__edge-path` with `stroke: var(--accent-primary) !important`, which
silently beat the per-edge inline colour — every edge rendered accent-orange
while its arrowhead was correctly hued. The same all-`!important` pattern is
still on `.react-flow__handle`; the card overrides it under `.cl-card`. Expect
this whenever a redesigned component's colour "doesn't take".

Note also that `src/index.css` re-declares `--accent-primary`, `--bg-*` and
friends in its own `:root` **after** importing `tokens.css`, so the legacy
teal-and-copper values still win for those bridge names. Worth untangling
before the next component is redesigned.

---

## 4. In-node YouTube playback — NOT functional

Checked directly: there is no `<iframe>`, no `youtube-nocookie` embed, and no
player component anywhere in `src/`. It was never built. `YouTubeNode` fetches
a transcript and links out.

The mockup's design notes carry the approach, and claim it was verified on
contentloom.fyi:

- rewrite `youtu.be/{id}` and `watch?v={id}` to `youtube-nocookie.com/embed/{id}`
- mark the iframe `nodrag` so React Flow does not swallow the clicks
- thumbnail swaps to the live player on click; `⛶` opens theater mode

---

## 5. Known problems

**`isDirty` is over-eager.** It flips on any change to the nodes/edges arrays,
including React Flow settling positions on load, so Save can look dirty
immediately. Should diff against the loaded state.

**Three boards left unfiled** — *Buzz - Comprehensive Analysis*, *Make
AVailable*, *Quantum Confusion - Brian Cox*. Titles too vague to place; a wrong
guess costs more than an empty field.

**No project management UI.** Projects can be created from the save dialog only.
There is no rename, delete, or reassign.

**14 dependency vulnerabilities**, all with non-breaking fixes (`npm audit fix`).
React 19 / Vite 8 are separate, larger decisions.

**Public Supabase signups are open.** Bot accounts were arriving roughly daily
before the cleanup. Dashboard action, not code.

**No ESLint in the repo.** There is no config and no lint script, so
`react-hooks/exhaustive-deps` is unenforced and the two disable comments in
`LensNode` are unverifiable by tooling.

---

## 6. Task list

1. ~~Node cards + wire the reader~~ — done (§3)
2. ~~Colored edges with arrowheads~~ — done. `SemanticEdge` reads the target
   node's identity through a `useStore` selector and picks one of the shared
   `<marker>` defs in `components/canvas/EdgeMarkers`
3. **In-canvas YouTube playback + theater mode** (§4)
4. **Merge the floating Toolbar into the topbar** — the mockup has one bar, not
   a pill plus a header; they currently duplicate node counts and branding
5. **Fix `isDirty`** (§5)
6. **Project management UI**
7. **Settings redesign** — provider cards, workspace-level prompt defaults
8. **Turn off public signups**
9. **`npm audit fix`**

---

## 7. Operational notes

**Backups.** `node scripts/backup-supabase.mjs` → `backups/` (gitignored, ~44MB).
Reads through the Supabase CLI's privileged connection, **not** the anon key:
under RLS the anon key returns zero rows *without an error*, and an earlier
version silently wrote empty backups. It now compares captured counts against
the live tables and refuses to write if they disagree.

Still manual. Worth scheduling — the only reason the September 9 data loss was
recoverable is that a backup happened to exist from hours earlier.

**Restore.** `node scripts/restore-supabase.mjs --owner <uuid> [--dry]`.
Seeded prompts (`is_seed = true`) **cannot** be restored through the app's own
credentials — the RLS insert policy forbids it. Seed restores must go through
the CLI's privileged connection.

**Migrations.** All in `supabase/`, applied with
`npx supabase db query --linked --project-ref dfcppzpppqgphjjxypyw -f <file>`.
Each is idempotent, ends with a verification query, and documents its rollback.

**Ownership audit.** `supabase/verify_ownership.sql` reports orphaned or
misattributed rows. Run after anyone new signs in.

**Looking at the canvas without signing in.** `preview/cards.html` mounts the
real `LensNode`, `SemanticEdge` and `EdgeMarkers` on a React Flow canvas with
fixture data, outside `AuthGate`. Throwaway scaffolding — delete it when the
redesign settles.

```
npm run dev
chrome --headless=new --disable-gpu --window-size=1400,900 \
  --screenshot=out.png http://localhost:5173/preview/cards.html
```

Add `?reader=1` to open the reader drawer, or flip `data-theme` on the `<html>`
tag to check light. This is how the edge-colour bug in §3 was found; a passing
test suite said nothing about it.

---

## 8. Lessons that cost real time

- **`ON DELETE CASCADE` on `user_id` destroyed 174 boards** when the account was
  deleted. Now `RESTRICT`. Never point a cascade at an auth table.
- **RLS makes reads return empty, not error.** Any tool using the anon key
  silently returns nothing. This broke the backup script and will break any
  future script written the same way.
- **Verify against the built artifact, not the source you just edited.** A grep
  for `fetch('/api` missed a call whose URL was in a variable; a check for
  `handleSaveCanvas` passed on a prop reference while the definition was
  missing. Grep `dist/` for a string the feature must contain.
- **Suspect the cache before rewriting code.** Three commits chased a CSS bug in
  a topbar that was rendering correctly at 51px the whole time; the browser was
  serving a stale `index.html`. Fixed at the source in `a9191ed`.
- **This repo is CRLF.** Node scripts anchoring on `\n` fail silently. Use `\r?\n`.
- **Replacing a container drops what it contained.** Swapping `Sidebar` for
  `AppShell` silently removed New Canvas and Save. Inventory a component's
  functions before replacing it.
- **A plain wrapper div breaks a flex height chain.** The workspace tree could
  not scroll because an unstyled div sat between it and the flex row.
- **A green test suite says nothing about how it looks.** 129 tests passed
  while every edge on the canvas was the wrong colour, because the override
  that broke it was `!important` in a stylesheet no test renders. Screenshot
  the thing (§7).
- **`position: fixed` does not escape a transformed ancestor.** React Flow
  transforms its viewport, so anything fixed inside a node — a drawer, a modal,
  a tooltip — positions against the canvas instead of the window. Portal it to
  `document.body`.
