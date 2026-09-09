# ContentLoom — Handoff

Last updated: 2026-09-09 · branch `main` @ `50ab4ab`+

---

## 1. Read this first

**Restart the server to pick up the cache fix.** The running process is on the
old `server.js`. Stop it and run `npm run dev` again. Do one hard refresh
(Ctrl+Shift+R) after that — from then on the browser will always revalidate.

**Port 3000 is contested.** A separate Next.js app (BensonIQ, in
`C:\Users\benso\bensoniq-website`) also wants it. If ContentLoom looks wrong,
confirm which app answers on 3000 before debugging anything. `PORT=3011 npm run
dev` moves ContentLoom; the Vite proxy follows via `API_PORT`.

---

## 2. State of the app

### Auth and data (done, verified)

- Every `/api/v1` route requires a Supabase session. Unauthenticated requests
  get 401, not empty data.
- RLS is enabled on all four tables with per-user policies. `pop_transcripts`
  is deliberately shared between signed-in users — it is a cache keyed by video
  id, and per-user copies would re-buy transcripts from Apify.
- `user_id` on boards/folders/prompts: `NOT NULL`, `DEFAULT auth.uid()`,
  `ON DELETE RESTRICT`.
- Current owner: `620e8d16-1a29-47fa-a002-0e48e21246e4` (bensondc73@gmail.com).
  This is a **new** account; the original was deleted and its uuid cannot come
  back.

### The redesign (phase 1 of 4)

Built from two artifacts — "ContentLoom Design Schema" and "ContentLoom Node
Redesign". The schema is the source of truth for every color, font and scale.

| Piece | State |
|---|---|
| Design tokens, 3 fonts, light/dark/legacy themes | done |
| Topbar, icon rail, workspace explorer | built — **topbar not rendering, see §4** |
| Projects dimension (`pop_projects` + `project_id`) | schema done, no UI to populate it |
| Markdown renderer (XSS-safe, 16 tests) | done |
| Node identity (type → hue) | done |
| Document reader drawer | built, **not yet wired to any node** |
| Node cards + colored edges | not started |
| In-canvas YouTube player | **not started — see §3** |
| Settings: provider cards, prompt defaults | not started |

---

## 3. In-node YouTube playback — NOT functional

**Checked on request. It does not work, because it was never built.** There is
no `<iframe>`, no `youtube-nocookie` embed, and no player component anywhere in
`src/`. The mockup's in-canvas player and theater mode are Phase 4 and have not
been started. `YouTubeNode` currently fetches a transcript and links out.

The mockup's design notes already record how to build it, and the notes claim
the approach was verified on contentloom.fyi:

- Rewrite `youtu.be/{id}` and `watch?v={id}` to `youtube-nocookie.com/embed/{id}`
- Mark the iframe `nodrag` so React Flow does not swallow the clicks
- Thumbnail swaps to the live player on click; `⛶` opens theater mode

Added to the task list below.

---

## 4. Known problems

**~~The new topbar renders at zero height~~ — RESOLVED.** It was never broken.
DevTools showed the header present with every child and a computed height of
51px; the browser had been serving a cached  that pinned the app to
an older bundle. Fixed by sending  for index.html (a9191ed). Three
earlier attempts to fix this as a CSS/layout bug were chasing a ghost — when a
change is verifiably in the served bundle but not on screen, suspect caching
before rewriting the code.

**All 174 boards are unfiled.** The explorer groups by folder, but only 2
folders exist and neither contains anything. The tree is currently a flat list
in nicer clothes. The Projects tab is empty for the same reason.

**`isDirty` is over-eager.** It flips on any change to the nodes/edges arrays,
including React Flow settling positions on load, so Save may show as needing a
save immediately. Should compare against the loaded state instead.

---

## 5. Task list

Ordered by value.

1. **Merge Toolbar into the topbar** — the mockup has one bar, not a floating
   pill plus a header. The topbar works; the pill now duplicates its job.
2. **Node cards + colored edges** — the biggest visual step. `LensNode` (533
   lines) becomes a compact card: type dot in its hue, status chip, 3-line
   preview, footer meta, Read button. Its chat moves into the reader.
3. **Wire the reader** — `DocumentReader` is built and unused. Card's Read
   button opens it; follow-ups post back to the node's thread.
4. **In-canvas YouTube playback + theater mode** (§3).
5. **File the 174 boards** — consider auto-suggesting subjects from titles
   (they cluster clearly: Claude Code, OpenClaw, Spirit Science, News) with a
   bulk accept/adjust step.
6. **Project UI** — create projects, assign boards. The column exists; nothing
   can populate it.
7. **Settings redesign** — provider cards, workspace-level prompt defaults.
8. **Merge Toolbar into the topbar** — the mockup has one bar, not a pill plus
   a header.
9. **Turn off public Supabase signups** — bot accounts were arriving daily
   before the cleanup. Dashboard action, not code.
10. **Dependency upgrades** — 14 vulnerabilities, all with non-breaking fixes
    (`npm audit fix`). React 19 / Vite 8 are separate, larger decisions.

---

## 6. Operational notes

**Backups.** `node scripts/backup-supabase.mjs` writes a verified snapshot to
`backups/` (gitignored, ~44MB). It reads through the Supabase CLI's privileged
connection, **not** the anon key — under RLS the anon key returns zero rows
without an error, and an earlier version silently wrote empty backups. It now
compares captured counts against the live tables and refuses to write if they
disagree.

Still manual. Scheduling it is worth doing: the only reason the September 9
data loss was recoverable is that a backup happened to be taken hours earlier.

**Restore.** `node scripts/restore-supabase.mjs --owner <uuid> [--dry]`.
Note that seeded prompts (`is_seed = true`) **cannot** be restored through the
app's own credentials — the RLS insert policy forbids it. Restores of seed rows
must go through the CLI's privileged connection.

**Migrations.** All in `supabase/`, applied via
`npx supabase db query --linked --project-ref dfcppzpppqgphjjxypyw -f <file>`.
Each is idempotent with a verification query and a commented rollback.

**Verify ownership.** `supabase/verify_ownership.sql` reports orphaned or
misattributed rows. Run after anyone new signs in.

---

## 7. Hard-won lessons

- **`ON DELETE CASCADE` on `user_id` destroyed 174 boards** when the account was
  deleted. Now `RESTRICT`. Never point a cascade at an auth table.
- **RLS makes reads return empty, not error.** Any tool using the anon key
  silently returns nothing. That broke the backup script and would break any
  future script written the same way.
- **Verify against the built artifact, not the source you just edited.** A grep
  for `fetch('/api` missed a call whose URL was in a variable, and a check for
  `handleSaveCanvas` passed on the prop reference while the definition was
  missing. Grep `dist/` for a string the feature must contain.
- **This repo is CRLF.** Node scripts anchoring on `\n` silently fail to match.
  Use `\r?\n`.
