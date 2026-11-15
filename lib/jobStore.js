// In-memory store for long-running jobs a page polls for.
//
// One container serves the app, so memory is enough: a restart drops running
// jobs, and the node simply asks again. Jobs belong to the user who started
// them; nobody else can read one, and an unknown id and someone else's id look
// the same.

import { randomUUID } from 'node:crypto'

/**
 * @param {{ttlMs: number, maxRunning: number}} options
 */
export function createJobStore({ ttlMs, maxRunning }) {
  const jobs = new Map()

  function sweep() {
    const now = Date.now()
    for (const [id, job] of jobs) {
      if (job.status !== 'running' && now - job.finishedAt > ttlMs) jobs.delete(id)
    }
  }

  function runningCount() {
    let n = 0
    for (const job of jobs.values()) if (job.status === 'running') n++
    return n
  }

  return {
    /**
     * @param {string} userId
     * @param {(setStage: (s: string) => void) => Promise<object>} work
     * @returns {{id: string} | null} null when every slot is busy
     */
    start(userId, work) {
      sweep()
      if (runningCount() >= maxRunning) return null

      const id = randomUUID()
      const job = { userId, status: 'running', stage: 'Starting…', result: null, error: null, finishedAt: 0 }
      jobs.set(id, job)

      work(stage => { job.stage = stage })
        .then(result => { job.status = 'done'; job.result = result })
        .catch(err => { job.status = 'failed'; job.error = err?.message || 'The job failed' })
        .finally(() => { job.finishedAt = Date.now() })

      return { id }
    },

    /** What a poll sees, or null for an unknown job or one that is not theirs. */
    get(userId, id) {
      const job = jobs.get(id)
      if (!job || job.userId !== userId) return null
      if (job.status === 'running') return { status: 'running', stage: job.stage }
      if (job.status === 'failed') return { status: 'failed', error: job.error }
      return { status: 'done', ...job.result }
    },
  }
}
