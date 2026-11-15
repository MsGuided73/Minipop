// Is this text a link to a Rumble video page? Used wherever a URL arrives on
// the canvas (drop, paste) to decide which node it becomes.

const RUMBLE_HOSTS = new Set(['rumble.com', 'www.rumble.com'])

export function isRumbleUrl(text) {
  try {
    const url = new URL(String(text || '').trim())
    return RUMBLE_HOSTS.has(url.hostname.toLowerCase()) && url.pathname.length > 1
  } catch {
    return false
  }
}
