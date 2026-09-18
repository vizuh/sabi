import * as readline from 'node:readline/promises'

const PROMPT_TIMEOUT_MS = 30_000

/**
 * One bounded interactive question. A TTY can be allocated with no one there to answer it (some
 * CI runners, `docker run -t` without `-i`); this never hangs longer than `timeoutMs`. Returns
 * undefined on timeout so the caller can fall back to a safe default rather than guess an answer.
 */
export async function promptWithTimeout(question: string, timeoutMs = PROMPT_TIMEOUT_MS): Promise<string | undefined> {
  const TIMED_OUT = Symbol('timed out')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = rl.question(question).catch(() => '')
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    setTimeout(() => resolve(TIMED_OUT), timeoutMs).unref()
  })
  const result = await Promise.race([answer, timeout])
  rl.close()
  return result === TIMED_OUT ? undefined : result.trim().toLowerCase()
}
