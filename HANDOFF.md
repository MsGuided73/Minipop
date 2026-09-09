# ContentLoom — Handoff

Last updated: 2026-09-09 · `main` @ `f9b2e2b` · 18 commits this session

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
| Markdown renderer (XSS-safe, 16 tests) | done, **unused** |
| Node identity (type → hue) | done, **unused** |
| `DocumentReader` drawer | built, **not wired to anything** |
| Node cards + colored edges | **not started** |
| In-canvas YouTube player | **not started — §4** |
| Settings: provider cards, prompt defaults | not started |

---

## 3. Next task, in detail

**Node cards + wire the reader.** These are one job; the card's Read button
needs somewhere to open.

`src/nodes/LensNode.jsx` (533 lines) currently renders a full chat inside the
node. The mockup replaces that with a compact card:

- type dot + uppercase label in the node's hue (`lib/nodeIdentity.js` maps a
  prompt to its hue — already written and tested)
- status chip (`✓ Complete`) in the header, never inside the document
- title, then a 3-line clamped preview
- footer: `1 source · 8 steps` on the left, `Read ⤢` on the right
- 270px wide, `--r-card` radius, hover lifts 2px and warms the border

Read opens `components/reader/DocumentReader` (built, unused) with the last
assistant message as markdown. Keep the thread on the node as the source of
truth — the reader is a *view*, so there is no migration. The reader's
follow-up composer posts back into that same thread.

Then: edges colored by their target node's hue with arrowheads, per the mockup's
`<marker>` defs.

Everything needed exists. Nothing about this requires the previous session.

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

---

## 6. Task list

1. **Node cards + wire the reader** (§3) — biggest remaining visual step
2. **Colored edges with arrowheads**
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
