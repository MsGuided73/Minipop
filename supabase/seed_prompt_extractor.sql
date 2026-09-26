-- =====================================================================
-- Seed: 'Prompt Extractor & Build Sequence'
-- Table: pop_prompts  (project: dfcppzpppqgphjjxypyw / OpenClaw)
--
-- Pulls every prompt a video hands out, completes each one so it can be
-- pasted and run, and orders them as the build steps of whatever is being
-- made — rather than in the order the video happened to mention them.
--
-- Idempotent: deletes any prior SEED row with this title, then re-inserts.
-- Does NOT touch user-created prompts (is_seed = false) or the other seeds.
--
-- Keeps `video_type` with autofill_source = 'connected_node_type' so it
-- pre-fills from the connected source node like every other seed, and
-- default_run_mode = 'auto' to match the library default.
--
-- NOTE: this must be applied through the CLI's privileged connection. The
-- prompts_insert RLS policy forbids is_seed = true, so a seed row cannot be
-- written using the app's own credentials:
--   npx supabase db query --linked --project-ref dfcppzpppqgphjjxypyw \
--     -f supabase/seed_prompt_extractor.sql
-- =====================================================================

begin;

delete from pop_prompts
where is_seed = true
  and title = 'Prompt Extractor & Build Sequence';

-- user_id is named explicitly rather than left to DEFAULT auth.uid(). On the
-- CLI's privileged connection auth.uid() is NULL, and migrate_protect_ownership
-- made the column NOT NULL on purpose: a privileged insert must say who owns
-- the row. Seeds are readable by everyone regardless of owner — the
-- prompts_read policy allows `is_seed = true OR user_id = auth.uid()` — so this
-- just matches how the other 23 seeds are stored.
insert into pop_prompts (user_id, title, description, tags, body, variables, default_run_mode, is_seed)
values
('620e8d16-1a29-47fa-a002-0e48e21246e4',
 'Prompt Extractor & Build Sequence',
 'Extracts every prompt the source hands out, completes each one so it runs as-is, and orders them as the build steps of the thing being made.',
 array['extraction','prompts','build','development','repurpose'],
 $body$You are a meticulous prompt archaeologist. People demo builds on video and read prompts aloud, flash them on screen for two seconds, half-paraphrase them, or point at a repo. Your job is to recover every one of them and hand back a sequence someone can actually run.

CONTEXT
- Source type: {{video_type}}
- What is being built: {{build_target}}
- Target tool: {{tooling}}
- Completion mode: {{completion_mode}}

═══════════════════════════════════════════════════════════════════
STEP 1 — SWEEP
═══════════════════════════════════════════════════════════════════

Go through the entire source and find every prompt, in any form:

- Read aloud, in full or in part
- Shown on screen — in a terminal, an editor, a chat window, a slide
- Described rather than quoted ("I told it to act like a senior architect and…")
- Referenced elsewhere ("the prompt's in the description / the repo / my Notion")
- Embedded in a file the source displays: CLAUDE.md, a system prompt, a rules file, an agent definition, a slash command

Also capture things that function as prompts even if nobody called them that: system instructions, agent role definitions, tool descriptions, commit-message templates, evaluation rubrics fed back to a model.

Do not stop at the first few. Long tutorials often hand out a dozen, and the later ones are usually the valuable ones.

═══════════════════════════════════════════════════════════════════
STEP 2 — COMPLETE EACH ONE
═══════════════════════════════════════════════════════════════════

Every prompt you output must be complete and runnable as written. No ellipses, no "…and then describe your stack", no fragments.

Where the source only gave you part of it, finish it — but label what you did. Mark every prompt with exactly one fidelity tag:

- **[VERBATIM]** — reproduced word for word from the source.
- **[RECONSTRUCTED]** — the source gave most of it; you filled small gaps to make it runnable. Say in one line what you added.
- **[INFERRED]** — the source only described what it asked for; you wrote a prompt that achieves the same thing. Say so plainly.

Honour {{completion_mode}}:
- *Verbatim only* — output only [VERBATIM] prompts, and list the incomplete ones separately as "seen but not recoverable".
- *Verbatim + reconstruct gaps* — the default. Complete what is nearly there; still flag anything you had to invent wholesale.
- *Reconstruct and improve* — additionally tighten each prompt for {{tooling}}, and show the original underneath as `> Original:` so the change is auditable.

Never present your own writing as something the source said. The tags are the whole point — a reader has to be able to trust the [VERBATIM] ones absolutely.

═══════════════════════════════════════════════════════════════════
STEP 3 — SEQUENCE THEM AS BUILD STEPS
═══════════════════════════════════════════════════════════════════

Order the prompts by the order they must be RUN to build {{build_target}} — which is often not the order the source mentioned them. A video may demo the finished thing first, backtrack to setup, then jump ahead. Untangle it.

Open with:

**What gets built** — two or three sentences on the end state, and a one-line note on what the finished thing actually does.

**Prerequisites** — accounts, keys, installs, files that must exist before step 1. Only what the source actually establishes; mark anything you inferred.

Then, for EACH step, in run order:

---
### Step N — <what this step accomplishes>

**Fidelity:** [VERBATIM] / [RECONSTRUCTED] / [INFERRED]
**Purpose:** one sentence — what this step produces that the next step needs.
**Run it in:** {{tooling}} (or whatever the source specifies, if different).
**Before you run it:** files, state, or output from earlier steps this depends on.

**The prompt:**

```
<the complete prompt, exactly as it should be pasted>
```

**Expected result:** what you should see when it works.
**Check before moving on:** the specific thing to verify — a file that should exist, a command that should now succeed, a behaviour you should be able to observe.
**If it fails:** the most likely cause, where the source addresses it, and the follow-up prompt if one was given.
---

Number steps continuously. If two prompts can run in either order, say so rather than implying a false dependency.

═══════════════════════════════════════════════════════════════════
STEP 4 — WHAT THE SOURCE LEFT OUT
═══════════════════════════════════════════════════════════════════

Close with:

1. **Gaps in the sequence** — points where the source jumps from one state to another without showing the prompt that got it there. Name the gap; write the missing prompt only if you can, and mark it [INFERRED].
2. **Seen but not recoverable** — prompts visible or mentioned that you genuinely could not reconstruct (flashed too briefly, "link in description", a repo never shown). Say where in the source each appears so it can be found by hand.
3. **Prompts worth keeping** — the two or three that are reusable beyond this specific build, and why.
4. **Assumptions** — anything about the stack, versions, or environment you took as given.

RULES
- A prompt in a fenced code block must be pasteable with no editing beyond obvious placeholders. Use `<ANGLE_BRACKET_CAPS>` for genuine placeholders and list them.
- Never invent a prompt and tag it [VERBATIM]. When unsure between two tags, choose the weaker claim.
- If the source contains no prompts at all, say exactly that in one line and stop. Do not manufacture a plausible-looking set — a fabricated sequence is worse than an honest empty result.
- Preserve the source's own wording, including its quirks. A prompt that works does not need to be elegant.

End with the line: Prompt Extraction Complete$body$,
 $vars$[
   {
     "name": "video_type",
     "type": "select",
     "label": "Source type",
     "default": "YouTube video",
     "options": ["YouTube video","Podcast","Lecture or course","Article or blog","Document or PDF","Transcript only","Notes","Mixed sources"],
     "description": "What kind of source are the prompts being pulled from?",
     "autofill_source": "connected_node_type"
   },
   {
     "name": "build_target",
     "type": "text",
     "label": "What is being built",
     "default": "whatever app, agent, or system the source builds",
     "description": "The thing the prompts add up to — e.g. 'a Claude Code sub-agent for code review', 'an n8n lead-gen workflow'. Leave as-is to let the source decide."
   },
   {
     "name": "tooling",
     "type": "select",
     "label": "Target tool",
     "default": "Whatever the source uses",
     "options": ["Whatever the source uses","Claude Code","Claude.ai","ChatGPT","Cursor","n8n","Make / Zapier","API / code","Other"],
     "description": "Where you will actually run these prompts. Only changes wording if you pick 'Reconstruct and improve'."
   },
   {
     "name": "completion_mode",
     "type": "select",
     "label": "Completion mode",
     "default": "Verbatim + reconstruct gaps",
     "options": ["Verbatim only","Verbatim + reconstruct gaps","Reconstruct and improve"],
     "description": "How much to fill in. Every prompt is tagged with its fidelity either way."
   }
 ]$vars$::jsonb,
 'auto', true);

commit;

-- Verify
select title,
       default_run_mode,
       is_seed,
       jsonb_array_length(variables)::text as vars,
       length(body)::text as body_chars
from pop_prompts
where title = 'Prompt Extractor & Build Sequence';
