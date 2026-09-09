# ContentLoom — Build Log

A chronological record of what was built, why, and what it cost. Newest last.

Range: `e7444a5` → `43cbb0a` · 19 commits · 50 files · +4,087 / −112 lines.

Format per entry: what changed, why, and anything that would not be obvious
from the diff. Mistakes are recorded alongside features — several of the most
useful lessons here came from things that went wrong.

---

## 2026-08-25 — Prompt library

### `7c53454` Product/viral prompts, exhaustive defaults, in-flow saving

**Two new seed prompts.**

- *Digital Product Builder* — two-phase. Phase 1 inventories what the source
  actually contains and pitches three deliberately different products (a
  fast-to-ship asset, a flagship, a recurring play), then **stops** and waits.
  Phase 2 builds the one you pick, finished rather than outlined — explicit ban
  on placeholder text.
- *Viral Video Factory* — produces N complete video packages built against 13
  documented virality mechanics (first-second pattern interrupt, open loops,
  1.5–3s retention pacing, mid-video re-hook, Berger's STEPPS share triggers,
  loopability). Each package carries a 1–5 virality scorecard that must name its
  own weakest element, plus a *"what I would not make"* section.

Both carry an anti-fabrication rule: anything the model adds beyond the source
is tagged `[ADDED]` and inventoried, so claims can be verified before anything
is published or sold.

**Library-wide defaults changed.** `depth_level` → `exhaustive`,
`default_run_mode` → `auto`. Applied to all 24 live rows and inverted in the
server so prompts authored in the UI inherit autorun.

**The ceiling that would have undercut it.** Exhaustive output against a
4,000-token cap with auto-continue *off* truncates on every run. Raised the Lens
budget to 16,000 and defaulted auto-continue on — but requesting more output
than a model can emit is a **400, not a graceful truncation**, so `max_tokens`
is clamped per model with a conservative fallback. Google is exempt: that branch
sends no explicit limit and already runs to its own maximum.

**In-flow prompt saving.** The fill modal could only save a prompt *before* the
fields were filled in, so custom wording typed into a field could not be kept.
It now saves the current answers as the new variable defaults, keeping the body
templated. Saving deliberately does not close the modal — saving and spawning
are separate decisions.

> Caught while building: `buildAutofillValues` can set a `select` to a value
> outside its own options list, so saving it as a default would produce a
> control that cannot render its own value. The save widens the options instead
> of dropping the value.

### `3c6d0b1` Vite dev proxy follows the backend port

The `/api` proxy was hardcoded to `localhost:3000`. Reading it from the
environment looked like the fix, but a bare `process.env.PORT` fallback **never
fires**: Vite does not populate `process.env` from `.env`, while `server.js`
reads it through `dotenv`. The config's own comment described behaviour the code
did not have. Switched to Vite's `loadEnv`, with shell variables layered on top
so they still win.

---

## 2026-08-31 — Security

### `3a154ee` Require Supabase auth; scope all data per user

Discovered while auditing: **the API had no working authentication.**
`authMiddleware` only checked a header when `POPPY_API_KEY` was set, and that
variable was empty — so the check was a no-op and all 13 `/api/v1` routes were
open. Combined with RLS disabled on every table and zero policies, anyone who
could reach the server could read, edit or delete all 174 boards, 2 folders, 24
prompts and 124 transcripts.

Also found: **bots were signing up daily.** Of six auth accounts, only one had
ever signed in; the rest were randomised gmail dot-trick addresses arriving
roughly one per day against an open signup endpoint.

- Real JWT verification replaces the dead key gate. Each request builds a client
  carrying the caller's token, so Postgres evaluates `auth.uid()` as that user
  and **scoping is enforced by the database**, not by remembering `.eq()` in 13
  handlers.
- RLS enabled with per-user policies. `pop_transcripts` stays shared between
  signed-in users on purpose: it is a cache keyed by video id, and per-user
  copies would re-buy transcripts from Apify.
- CORS restricted, helmet added, rate limits on the API and a tighter one on the
  transcript route, which spends money per call.
- Client routes every API call through `apiFetch`, which attaches the token and,
  on 401, clears the dead session rather than looping.

---

## 2026-09-09 — Recovery

### The incident

The `bensondc73@gmail.com` account was deleted from `auth.users`. The `user_id`
foreign keys were `ON DELETE CASCADE`, so Postgres silently deleted **174
boards, 2 folders and 24 prompts** along with it. No error, no warning.

`CASCADE` is the conventional choice for per-user rows and was the wrong one
here: it turns a single account row into a delete-everything switch.

**Everything was recovered** from a backup taken hours earlier — 174 boards, 553
nodes, 371 edges, 2 folders, 24 prompts. Transcripts were untouched, having no
owner column.

Two things made the restore harder than it should have been, both worth
remembering:

- **RLS blocked the obvious path.** The anon key can insert nothing, and even
  signed in as the owner, the `prompts_insert` policy forbids `is_seed = true`
  rows — the seeded library was literally un-restorable through the app's own
  credentials. It went through the CLI's privileged connection instead, shipping
  rows as dollar-quoted JSON through `jsonb_populate_recordset` so the
  `nodes`/`edges` graphs round-tripped byte-exact.
- **Two batches hit a 413.** Eight boards per request exceeded the Management
  API's size limit. The 16 stragglers were found by diffing ids against the
  backup and reapplied one per request; the largest is 2.46 MB alone.

The account's uuid could not be reissued, so all rows were re-owned to a new
account.

### `3357460` Send the session token when fetching transcripts

Transcript fetching broke when `/api` began requiring auth. `YouTubeNode` built
its URL into a variable first —

```js
const localProxyUrl = `/api/transcript?...`
const localRes = await fetch(localProxyUrl)
```

— so the rewrite that moved API calls onto `apiFetch` (which matched inline
`'/api'` literals) skipped it. It 401'd, and the `catch` treated that as "proxy
unavailable" and fell through to the edge function, which has no `yt-dlp`. A
**silent downgrade**, not an error.

The verification had used the same grep pattern as the rewrite, so it could not
possibly find what the rewrite missed. Added a guard test that checks a
different property — any module *mentioning* `/api/` must import `apiFetch` —
and confirmed it fails when the fix is reverted.

### `e0e867e` Stop account deletion destroying data; repair the backup script

- `user_id` FKs → `ON DELETE RESTRICT`. The same deletion now raises a foreign
  key violation and changes nothing. Deleting an account is a deliberate
  two-step, documented in the migration.
- `DEFAULT auth.uid()` and `NOT NULL` on `user_id`: attribution is automatic and
  an unattributed row — invisible to everyone under RLS, so effectively lost
  while still occupying the table — is rejected.

**The backup script was silently writing empty backups.** It read with the anon
key; once RLS was enabled every policy became `to authenticated`, so an
unauthenticated read returns **zero rows without an error**. It reported success
and wrote a 0-row file — and it ran immediately before a schema migration.

A backup that looks healthy but holds nothing is worse than no backup. Reads now
go through the CLI's privileged connection, paginated, and the run **aborts
without writing** if captured counts disagree with the live tables.

---

## 2026-09-09 — Redesign, phase 1

Built from two artifacts authored on Sept 1: *ContentLoom Design Schema* (the
token system) and *ContentLoom Node Redesign* (1,186 lines of real layout HTML).
The schema is the source of truth for every colour, font and scale.

### `367f33f` Design system and app shell

- **Tokens** ported verbatim: dark-first, light as a sibling set of the same
  roles rather than an inversion, plus legacy themes so the new look can be
  judged against what it replaces. Node identity hues and semantic ok/warn/err
  are separate tokens despite sharing values, because one means identity and the
  other means state.
- The existing `--bg-*`/`--text-*` names are **aliased onto** the new tokens, so
  3,100 lines of current CSS adopt the palette immediately instead of needing a
  big-bang rewrite.
- **Shell**: topbar, 52px icon rail, and a workspace explorer replacing a flat
  list that was unusable at 174 boards. Unimplemented rail buttons are visibly
  disabled rather than fake.
- **Projects**: new `pop_projects` table + `pop_boards.project_id`, giving boards
  a second, independent grouping dimension. `project_id` is `ON DELETE SET NULL`
  on purpose — deleting a project unfiles its boards, never deletes them.

### `8ca529b` Prompt library back on the right

The shell passed `PromptPanel` through as a *child*, and children render inside
`.cl-canvas-region`, which is `flex-direction: column` — so the library stacked
underneath the canvas. Added an explicit `rightPanel` slot rendered as a sibling
of the canvas inside the flex row.

### `b738d8d` Markdown renderer, node identity, document reader

- **Markdown renderer.** Renders untrusted model output, so everything is
  HTML-escaped *before* formatting is applied; the only tags in the result are
  ones the renderer emits. 16 tests pin that ordering explicitly, including bold
  wrapping an injected tag, because a refactor that escaped afterwards would
  silently reintroduce XSS and still look correct.
- **Node identity.** Tags are consulted before the title, so renaming a prompt
  does not silently change what kind of thing it makes. Unclassified takes the
  neutral accent — a wrong identity is worse than none.
- **Document reader.** The drawer from the mockup, built as a *view* over the
  node's existing thread rather than a new store, so there is no migration.

### `cf12fdc` Restore New Canvas and Save

Wrapping the app in `AppShell` removed `Sidebar` — which is where "New Canvas"
and "Save Current" lived. There was no way to start a canvas or write one to the
account. **A container was replaced without inventorying what it contained.**

Nearly shipped broken: the wiring check passed on a *prop reference* while the
handler **definition** was missing, because a `\n` anchor did not match this
repo's CRLF line endings. Verification switched to grepping the built bundle for
strings the feature must contain.

### `4c53f92`, `50ab4ab`, `a9191ed`, `9ef0ba2` — the cache hunt

Three commits chased a Save button that was "not visible", on a theory that it
was being pushed off-screen or collapsed by CSS. It was none of those.

Proof, eventually: the process on :3000 was ContentLoom, the served
`index.html` referenced the current bundle, and **that bundle contained the
button**. The browser was rendering a cached page. DevTools later confirmed the
topbar had been rendering at `height: 51px` the entire time.

Fixed at the source: `index.html` is served `no-cache, must-revalidate` from
both the static handler and the SPA fallback, while fingerprinted assets get
`immutable`. Vite fingerprints every asset, so `index.html` is the only file
pointing at the current build — caching it pins the whole app to a previous
version and makes new work appear to have vanished.

> **Cost: three commits and a workaround, all unnecessary.** When a change is
> verifiably in the served bundle but absent on screen, suspect caching before
> rewriting code.

### `2653fea` Save dialog

Saving was a `window.prompt` offering only a name, pre-filled "New Canvas" —
a large part of why 174 boards were unfiled and unhelpfully named. The one
moment the user is thinking about what a canvas *is* asked for the least useful
thing.

Now: a name **suggested from the canvas itself** (most specific source node
wins; a YouTube title beats a document name beats a URL), with creator noise
stripped — but a trailing dash clause that reads as content is kept, so
*"The $15K Myth - a documentary"* survives while *"Sacred Geometry - Spirit
Science TV"* loses its channel. Plus Subject, and Project either existing or
created inline. The project is created **before** the board is written, so a
failure there aborts rather than saving into a project that does not exist.

Supporting work: `pop_projects` had a table but no API. Added `GET`/`POST
/api/v1/projects` and taught the boards routes to persist `project_id`.

### `bd50d3c` File 171 of 174 boards

The explorer grouped by folder but everything was unfiled, so the redesigned
tree was a flat 174-item list in new clothes.

A regex pass reached **52%** and mis-filed in ways that showed why it was the
wrong tool: *"Gregg Braden God code"* → Dev (contains "code"), the *"2nd Brain"*
note-taking boards → Health (contains "brain"). Reading all 174 titles and
writing an explicit lookup reached **98%**.

```
 49  AI & Claude          39  Spirit & Esoteric     27  Business & Money
 24  News & Politics      17  Marketing & SEO        8  Dev & Tools
  7  Second Brain & Learning                         3  left unfiled
```

The three left out have titles too vague to place; a wrong guess costs more than
an empty field.

### `f9b2e2b` Workspace tree scrolls

Filing made the list long enough to overflow — and it could not be scrolled. The
explorer sat inside a plain unstyled wrapper `div` that **broke the flex height
chain**: it sized to its content rather than the row, so `overflow-y: auto` had
nothing to act on. The wrapper also carried a class that was never defined in
any stylesheet. Removed it, hardened the chain, and added an always-visible
scrollbar since there was no other cue the list continued.

---

## Where it ended

| | |
|---|---|
| Tests | 65 across 7 files |
| Live data | 174 boards · 9 folders · 24 prompts · 127 transcripts |
| Security | JWT auth, RLS on 4 tables, RESTRICT on ownership FKs |
| Redesign | phase 1 of 4 complete |
| Open | node cards, reader wiring, colored edges, YouTube playback |

See `HANDOFF.md` for current state and the task list.

---

## Recurring lessons

1. **Never point a cascade at an auth table.** One deleted account destroyed
   everything.
2. **RLS makes reads return empty, not error.** Silent-empty is the failure mode
   to design against; it broke the backup script.
3. **Verify against the built artifact.** Two bugs shipped because a check ran
   against the source that was just edited, using the same pattern as the edit.
4. **Suspect the cache before rewriting code.**
5. **Replacing a container drops what it contained.** Inventory before swapping.
6. **This repo is CRLF.** `\n` anchors fail silently.
7. **A silent downgrade is worse than an error.** The transcript fallback and the
   empty backup both "succeeded" while doing nothing useful.
