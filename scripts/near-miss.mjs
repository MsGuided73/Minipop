// Finding the name someone probably meant, for a missing environment variable.
//
// This exists because of a real deploy failure. The build required
// VITE_SUPABASE_ANON_KEY; the host held VITE_SUPABASE_ANON_PUBLIC_KEY. The
// value was correct, non-blank, and correctly marked build-time — under a name
// nothing read. The build's entire output was "VITE_SUPABASE_ANON_KEY is
// missing", which is true, and is also what you see when the variable was
// never set, set blank, or set runtime-only. One message, four causes, and the
// right value already in scope.
//
// Plain edit distance does NOT catch that case: inserting "PUBLIC_" is seven
// character edits, far outside any typo threshold that would stay quiet on
// unrelated names. But environment variable names are not free text — they are
// underscore-delimited word lists, and the mistake was a whole extra word:
//
//     VITE SUPABASE ANON KEY   required
//     VITE SUPABASE ANON PUBLIC KEY   present
//
// So the comparison is over tokens, not characters. An inserted or dropped word
// costs one token regardless of its length, which is what makes the real case
// score well. Character bigrams are kept, but only to decide whether two
// individual tokens are the same word (SUPBASE ~ SUPABASE), so ordinary
// misspellings are caught too.
//
// Scoring is weighted by token length so that agreeing on SUPABASE counts for
// more than agreeing on KEY, and normalised as matched / union so that a long
// unmatched token is a real penalty. That is what keeps VITE_SUPABASE_URL from
// being offered as a suggestion for VITE_SUPABASE_ANON_KEY: they share
// VITE and SUPABASE, but ANON, KEY and URL all go unmatched.

const SEPARATORS = /[^A-Za-z0-9]+/

// Dice score at which two tokens are treated as the same word. High enough
// that KEY and URL stay distinct, low enough to absorb a dropped letter.
const SAME_WORD = 0.7

/** Split an env var name into upper-case words. Case and separators are noise. */
export function tokenize(name) {
  return String(name ?? '')
    .split(SEPARATORS)
    .filter(Boolean)
    .map(word => word.toUpperCase())
}

function bigrams(text) {
  const grams = []
  for (let i = 0; i + 1 < text.length; i += 1) grams.push(text.slice(i, i + 2))
  return grams
}

/** Sørensen–Dice coefficient over character bigrams, 0..1. */
function dice(a, b) {
  if (a === b) return 1
  const left = bigrams(a)
  const right = bigrams(b)
  if (left.length === 0 || right.length === 0) return 0

  const pool = new Map()
  for (const gram of right) pool.set(gram, (pool.get(gram) ?? 0) + 1)

  let shared = 0
  for (const gram of left) {
    const remaining = pool.get(gram) ?? 0
    if (remaining > 0) {
      shared += 1
      pool.set(gram, remaining - 1)
    }
  }
  return (2 * shared) / (left.length + right.length)
}

/**
 * Greedily pair up words between two names. Greedy rather than optimal because
 * env var names are short and the words are rarely ambiguous; an exact match
 * always scores 1 and so always wins its slot.
 */
function pairWords(left, right) {
  const taken = new Array(right.length).fill(false)
  const pairs = []
  const unmatchedLeft = []

  for (const word of left) {
    let bestIndex = -1
    let bestScore = 0
    for (let i = 0; i < right.length; i += 1) {
      if (taken[i]) continue
      const score = dice(word, right[i])
      if (score > bestScore) {
        bestScore = score
        bestIndex = i
      }
    }
    if (bestIndex >= 0 && bestScore >= SAME_WORD) {
      taken[bestIndex] = true
      pairs.push([word, right[bestIndex]])
    } else {
      unmatchedLeft.push(word)
    }
  }

  const unmatchedRight = right.filter((_, i) => !taken[i])
  return { pairs, unmatchedLeft, unmatchedRight }
}

/**
 * How much two environment variable names look like the same intent, 0..1.
 * 1 means identical once case and separators are ignored.
 */
export function similarity(a, b) {
  const left = tokenize(a)
  const right = tokenize(b)
  if (left.length === 0 || right.length === 0) return 0

  const { pairs, unmatchedLeft, unmatchedRight } = pairWords(left, right)

  const length = words => words.reduce((total, word) => total + word.length, 0)

  // A pair contributes its shorter word to the numerator and its longer word to
  // the denominator, so a near-miss word scores slightly below an exact one.
  let matched = 0
  let union = length(unmatchedLeft) + length(unmatchedRight)
  for (const [x, y] of pairs) {
    matched += Math.min(x.length, y.length)
    union += Math.max(x.length, y.length)
  }

  return union === 0 ? 0 : matched / union
}

/**
 * Names from `candidates` that plausibly hold what `target` was meant to hold,
 * best first.
 *
 * `exclude` should list the other names the build already reads. Without it, a
 * required-and-present sibling can be offered as the answer to a different
 * required-and-missing name, which sends the reader off to rename a variable
 * that was correct.
 */
export function nearMisses(target, candidates, options = {}) {
  const { threshold = 0.6, limit = 3, exclude = [] } = options
  const skip = new Set([target, ...exclude])

  return [...new Set(candidates)]
    .filter(name => !skip.has(name))
    .map(name => ({ name, score: similarity(target, name) }))
    .filter(entry => entry.score >= threshold)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(entry => entry.name)
}
