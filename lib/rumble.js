// Rumble ingestion, server-side.
//
// Rumble pages rarely carry captions, so unlike YouTube there is nothing to
// fetch: the audio is pulled down with yt-dlp, split into short parts with
// ffmpeg, and transcribed with the caller's own OpenAI or Google key. The key
// is passed in per call and never stored here.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const execFileAsync = promisify(execFile)

// Past this the transcription bill and the disk use stop being reasonable for
// one click. The message says so rather than failing midway.
export const MAX_DURATION_SECONDS = 4 * 60 * 60
// Parts stay far under every provider's upload limit (25 MB for Whisper;
// 20 MB inline for Gemini): 20 minutes of 32 kbps mono is under 5 MB.
const SEGMENT_SECONDS = 20 * 60
const METADATA_TIMEOUT_MS = 60 * 1000
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000
const ENCODE_TIMEOUT_MS = 10 * 60 * 1000
const TRANSCRIBE_TIMEOUT_MS = 5 * 60 * 1000

/**
 * What went wrong, in words a person can act on. yt-dlp's stderr ends with a
 * line like "ERROR: [Rumble] …: HTTP Error 403"; that line is the useful part,
 * not the command that was run.
 */
export function explainToolFailure(tool, err) {
  const stderr = String(err?.stderr || '')
  const line = stderr.split('\n').reverse().find(l => l.startsWith('ERROR:'))
  const reason = (line ? line.replace(/^ERROR:\s*/, '') : '').trim()

  if (/403|Forbidden|Cloudflare|anti-bot/i.test(reason)) {
    return 'Rumble refused the request from this server (HTTP 403 — it is blocking automated access).'
  }
  if (err?.killed || err?.signal === 'SIGTERM') return `${tool} took too long and was stopped.`
  if (err?.code === 'ENOENT') return `${tool} is not installed on the server.`
  return reason ? `${tool}: ${reason}` : `${tool} failed.`
}

async function run(tool, args, options) {
  try {
    return await execFileAsync(tool, args, options)
  } catch (err) {
    throw new Error(explainToolFailure(tool, err))
  }
}

const RUMBLE_HOSTS = new Set(['rumble.com', 'www.rumble.com'])

/**
 * The one URL shape this feature will hand to yt-dlp, or null. Anything that
 * is not a page on rumble.com is refused so the server is not a way to make it
 * fetch arbitrary addresses.
 */
export function normalizeRumbleUrl(input) {
  let url
  try {
    url = new URL(String(input || '').trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!RUMBLE_HOSTS.has(url.hostname.toLowerCase())) return null
  if (url.pathname.length < 2) return null
  return `https://rumble.com${url.pathname}`
}

/** "/v6abc12-some-title.html" or "/embed/v6abc12/" → "v6abc12". */
export function rumbleVideoId(url) {
  const match = String(url).match(/\/(?:embed\/)?(v[a-z0-9]+)(?:[-./]|$)/i)
  return match ? match[1].toLowerCase() : null
}

/** The fields the canvas shows, in the same shape the YouTube node uses. */
export function parseMetadata(info = {}) {
  return {
    title: info.title || 'Rumble video',
    uploader: info.uploader || info.channel || '',
    viewCount: info.view_count || 0,
    likeCount: info.like_count || 0,
    duration: info.duration || 0,
    uploadDate: info.upload_date || null,
    description: info.description || '',
    thumbnail: info.thumbnail || '',
    comments: [],
  }
}

/** Throws a message fit to show the user when the video is too long to take on. */
export function assertDurationAllowed(seconds) {
  if (seconds > MAX_DURATION_SECONDS) {
    const hours = Math.round(MAX_DURATION_SECONDS / 3600)
    throw new Error(`This video is longer than ${hours} hours, which is more than one click should transcribe.`)
  }
}

export function joinParts(parts) {
  return parts.map(p => p.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

async function fetchMetadata(url) {
  const { stdout } = await run(
    'yt-dlp',
    ['--no-warnings', '--dump-json', '--no-playlist', '--skip-download', '--', url],
    { timeout: METADATA_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 },
  )
  return parseMetadata(JSON.parse(stdout))
}

async function downloadAudioParts(url, dir) {
  await run(
    'yt-dlp',
    ['--no-warnings', '--no-playlist', '-f', 'ba/b', '-o', path.join(dir, 'source.%(ext)s'), '--', url],
    { timeout: DOWNLOAD_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 },
  )
  const source = (await fs.readdir(dir)).find(name => name.startsWith('source.'))
  if (!source) throw new Error('The download finished but no audio file was produced.')

  await run(
    'ffmpeg',
    [
      '-y', '-i', path.join(dir, source),
      '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k',
      '-f', 'segment', '-segment_time', String(SEGMENT_SECONDS), '-reset_timestamps', '1',
      path.join(dir, 'part_%03d.mp3'),
    ],
    { timeout: ENCODE_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 },
  )
  await fs.rm(path.join(dir, source), { force: true })

  const parts = (await fs.readdir(dir)).filter(n => n.startsWith('part_')).sort()
  if (parts.length === 0) throw new Error('The audio could not be split for transcription.')
  return parts.map(n => path.join(dir, n))
}

async function providerError(response, label) {
  const body = await response.json().catch(() => ({}))
  return new Error(body.error?.message || `${label} transcription failed (HTTP ${response.status})`)
}

async function transcribeWithOpenAI(apiKey, file) {
  const form = new FormData()
  form.append('model', 'whisper-1')
  form.append('response_format', 'text')
  form.append('file', new Blob([await fs.readFile(file)], { type: 'audio/mpeg' }), path.basename(file))

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
  })
  if (!response.ok) throw await providerError(response, 'OpenAI')
  return response.text()
}

const GOOGLE_TRANSCRIBE_MODEL = 'gemini-2.5-flash'
const GOOGLE_PROMPT =
  'Transcribe this audio word for word. Output only the spoken words as plain text — ' +
  'no timestamps, no speaker labels, no commentary.'

async function transcribeWithGoogle(apiKey, file) {
  const audio = (await fs.readFile(file)).toString('base64')
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_TRANSCRIBE_MODEL}:generateContent`,
    {
      method: 'POST',
      // The key goes in a header, not the URL, so it cannot end up in a log.
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: GOOGLE_PROMPT }, { inline_data: { mime_type: 'audio/mp3', data: audio } }] }],
      }),
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    },
  )
  if (!response.ok) throw await providerError(response, 'Google AI')
  const data = await response.json()
  return (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('')
}

const TRANSCRIBERS = { openai: transcribeWithOpenAI, google: transcribeWithGoogle }
export const TRANSCRIBE_VIA = { openai: 'rumble-whisper', google: 'rumble-gemini' }

/**
 * Metadata, audio, transcript — in that order, reporting each stage as it
 * starts. Always removes its scratch directory, including on failure.
 *
 * @param {{url: string, provider: 'openai'|'google', apiKey: string, onStage?: (s: string) => void}} input
 * @returns {Promise<{transcript: string, metadata: object, via: string}>}
 */
export async function transcribeRumble({ url, provider, apiKey, onStage = () => {} }) {
  const transcribe = TRANSCRIBERS[provider]
  if (!transcribe) throw new Error(`No transcriber for provider "${provider}"`)

  onStage('Reading video details…')
  const metadata = await fetchMetadata(url)
  assertDurationAllowed(metadata.duration)

  const root = path.resolve(process.cwd(), '.tmp')
  await fs.mkdir(root, { recursive: true })
  const dir = await fs.mkdtemp(path.join(root, 'rumble-'))

  try {
    onStage('Downloading audio…')
    const parts = await downloadAudioParts(url, dir)

    const texts = []
    for (let i = 0; i < parts.length; i++) {
      onStage(parts.length > 1 ? `Transcribing part ${i + 1} of ${parts.length}…` : 'Transcribing…')
      texts.push(await transcribe(apiKey, parts[i]))
    }

    const transcript = joinParts(texts)
    if (!transcript) throw new Error('The audio was transcribed but no speech was found.')
    return { transcript, metadata, via: TRANSCRIBE_VIA[provider] }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
