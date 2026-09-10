# ContentLoom — Build Log

A chronological record of what was built, why, and what it cost. Newest last.

Range: `e7444a5` → `3eb9459` · 23 commits · 59 files · +6,216 / −664 lines.

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

## 2026-09-09 → 09-10 — Redesign, phase 2: node cards, edges, the reader

Four build-outs in one evening session. The order below is the order they were
built, which is not the order they were committed — the edge work was split out
in front so that each commit resolves its own imports.

Range: `f1023c3` → `3eb9459` · 4 commits · 17 files · +2,129 / −552 lines.
Tests 65 → 152.

### 1 — `9eae793` Node cards and the document reader

The task the session was opened to do. `LensNode` rendered a full chat inside
the canvas node, so reading a long document meant fighting a 280px box.

**The card.** 270px fixed width, sizing to its own content: type dot and
uppercase label in the node's hue, status chip in the header, title, a
three-line clamped preview, footer of `1 source · 3 sections` and `Read ⤢`.
Fixed width is the point — legibility of the graph beats legibility of any one
document, which is what the reader is for.

**The reader had to be a portal.** React Flow transforms its viewport, and
`position: fixed` inside a transformed ancestor resolves against that ancestor
rather than the window. It mounts on `document.body`, and only once opened —
then is held for the exit transition so the slide-in is not skipped.

**The thread stays on the node.** The reader is a view over `data.messages`,
and its follow-up composer posts back into the same thread — so there was no
migration to do. With no follow-ups the document shown is exactly the
assistant's answer; once a conversation exists the exchanges are appended
*below* the document rather than replacing it. Replacing it would mean that
asking "shorten section 3" makes the whole document vanish behind a three-line
reply.

**Supporting derivation.** `lib/docSummary.js` works out a card's title,
preview and section count from the markdown, because nothing else knows what
the document turned out to be. Fences are paired rather than toggled: one
unclosed fence from a truncated response would otherwise blank the preview and
report zero sections for a document the reader shows in full.

**A document names its own node** on the first run, unless someone has renamed
it by hand — `autoLabel` clears for good on a manual rename. Prompt tags now
reach the node as well, because `identityFor` reads tags before titles; nodes
saved earlier have no tags and fall back to title matching, which is why some
older cards take the accent rather than a type hue.

**Inventory before replacing.** The lesson from `cf12fdc` applied directly:
everything the old node header carried survives behind a `⋯` menu — rename,
view/edit prompt, copy transcript, save `.md`, re-run, clear, delete. Two things
have no direct replacement and are recorded rather than quietly dropped:
per-message copy, and find-in-conversation. The reader renders real DOM, so
browser Ctrl+F now works on the document, and it carries its own A− / A+.

> Caught in review: a failed follow-up was invisible. The error rendered only on
> the card, which the reader's own backdrop covers, and the composer cleared the
> typed question regardless of outcome — so a rate-limited follow-up lost the
> question and said nothing. The error now shows inside the drawer and the text
> survives.

> Also caught: reopening the drawer inside the 260ms exit window let the stale
> unmount timer tear down the drawer the user had just reopened; and the
> outside-click that closes the `⋯` menu was a bubble-phase listener, which every
> control on every card defeats by calling `stopPropagation` to keep clicks away
> from React Flow. Capture phase now, and the timer is cancelled on open.

**Old geometry is rewritten on load.** Nodes carrying the old
`{width: 380, height: 460}` chat size are normalised to the card width on mount.
This is a silent rewrite of saved data that discards any manual resize —
accepted because `NodeResizer` is gone and the alternative is a card floating in
a 460px invisible hit area, but it is the kind of change this project has been
burned by before, so it is written down.

`nodeIdentity` had been described in the handoff as "already written and
tested". It had no test file. It does now.

### 2 — `6ae92b0` Edges coloured by the node they feed

An edge takes the hue of its **target's** identity, so reading down a canvas the
arrow into a Video Script is rose the whole way and the graph's shape is legible
at a zoom where no label is. Arrowheads come from one shared set of SVG
`<marker>` defs, since marker references resolve by id across the document.
`SemanticEdge` reads the target through a `useStore` selector returning just the
identity key, so an edge re-renders only when the resolved identity changes, not
on every node move.

**The trap.** `src/index.css` styled `.react-flow__edge-path` with
`stroke: var(--accent-primary) !important`, which silently beat the per-edge
inline colour. Every edge rendered accent-orange while its arrowhead was
correctly hued — and 129 passing tests said nothing about it. Paint is now the
component's job; the stylesheet keeps only hover geometry, which still needs
`!important` to beat the inline `stroke-width`.

The same all-`!important` pattern is still on `.react-flow__handle`, so the card
overrides it under `.cl-card`. Expect this whenever a redesigned component's
colour "doesn't take".

### 3 — `f98515f` A headless canvas preview

A direct consequence of the above: the suite was green while the canvas was
visibly wrong, and the app sits behind Supabase auth, so there was no quick way
to look at it. `preview/cards.html` mounts the real `LensNode`, `SemanticEdge`
and `EdgeMarkers` on a React Flow canvas with fixture data, outside `AuthGate`,
and Chrome screenshots it headlessly. `?reader=1` opens the drawer, `?scroll=N`
scrolls it, flipping `data-theme` checks light. Vite only builds `index.html`,
so none of it ships.

Throwaway scaffolding. Delete it when the redesign settles.

### Interlude — the save failure that was not a bug

Saving a canvas with a new project failed with "Could not create the project".
No code was changed to fix it.

The server answering on `:3000` had been running since **4:24 AM**; the projects
API was committed at **10:55 AM** in `2653fea`. So `POST /api/v1/projects`
genuinely did not exist in that process, and it returned express's HTML 404 —
which `createProject` cannot parse as JSON, so it fell back to a generic message
carrying no detail. A `GET` of the same path returned **200 HTML**, having fallen
through to the SPA catch-all.

What made it confusing: `express.static` reads `dist/` from disk per request, so
that morning's process happily served the **new** frontend — the node cards were
on screen — while answering with the **old** API. New dialog, old backend.

Six orphaned `server.js` processes were holding ports 3000 and 3011–3015. That is
also why an earlier `PORT=3011 npm run dev` had silently failed to bind its API
port. All six were stopped and one clean server restarted.

> Diagnosis worth keeping: the route *was* registered — dumping the express
> router stack proved `POST /api/v1/projects` present, in the right order, and
> matching the request path. Which meant the code was fine and the *process* was
> stale. A fresh server on another port returned 401 where the old one returned
> 404, and that single comparison localised it.

### 4 — `3eb9459` The reader renders like Google Docs

Requested directly, with a screenshot: a document should look the way markdown
looks pasted into Google Docs. Two things were in the way, not one.

**The renderer could not produce most of it.** Links, tables, fenced code,
strikethrough, task items and nested numbering all fell through as raw text — a
table collapsed into a single paragraph of pipes, a code block lost its newlines
and kept its backticks. Nested lists were emitted as a `<ul>` *sibling* of
`<li>`, which is invalid. `markdown.js` now covers links, images, lists nested to
any depth, task lists, tables with column alignment, fenced code with a language
class, strikethrough, and headings to `h6`.

**It stays hand-rolled**, against its own earlier note to swap in a parser plus a
sanitizer. The file escapes *before* formatting, so it can only ever emit its own
tags with its own attributes — a stronger guarantee than parse-then-sanitize, and
it needs no sanitizer at all. That property is worth more than a library; keep it
if you extend the file. URLs are the one place input reaches an attribute, so
they go through `safeUrl`: `javascript:`, `data:` and `vbscript:` drop to plain
text, including the tab-separated `java<TAB>script:` form that browsers still
execute, because they ignore control characters when resolving a scheme.

**Then the styling.** Arial, 11pt body, 20/16/14/12pt bold headings, 1.38
leading, a 6.5in column (an 8.5in page less its margins), dash bullets with
hanging indents, ruled tables with a bold header row, blue underlined links. This
is a deliberate departure from the Design Schema, which specifies Fraunces and
Source Serif for the reader — recorded here so it does not read as drift later.

The page follows the app theme rather than forcing white, which is what Google
Docs does in dark mode; everything reads from `--reader-ink` / `--reader-bg`, so
"always white" is a two-token change. The drawer's chrome keeps the node's
identity hue and only the document body is neutral — that contrast is what makes
it read as a document rather than as app furniture.

> One of the 16 existing markdown tests asserted the invalid sibling-`<ul>`
> markup. The test was codifying the bug, so it was corrected rather than
> preserved. Markdown tests 16 → 39.

---

## Where it ended

| | |
|---|---|
| Tests | 152 across 10 files |
| Live data | 174 boards · 9 folders · 24 prompts · 127 transcripts |
| Security | JWT auth, RLS on 4 tables, RESTRICT on ownership FKs |
| Redesign | phases 1-2 of 4 complete |
| Open | YouTube playback, toolbar merge, `isDirty`, project UI, settings |

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
8. **A green test suite says nothing about how it looks.** 129 tests passed
   while every edge on the canvas was the wrong colour; the override that broke
   it was `!important` in a stylesheet no test renders.
9. **`position: fixed` does not escape a transformed ancestor.** Anything fixed
   inside a React Flow node positions against the canvas. Portal it to the body.
10. **Suspect the running process, not only the cache.** A server from six hours
   earlier served the new frontend from disk while answering with its own stale
   routes — so the UI was current and the API was not.
