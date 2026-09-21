import { spawnSync } from 'node:child_process'
import * as readline from 'node:readline/promises'

const PROMPT_TIMEOUT_MS = 30_000

/**
 * One bounded interactive question. A TTY can be allocated with no one there to answer it (some
 * CI runners, `docker run -t` without `-i`); this never hangs longer than `timeoutMs`. Returns
 * undefined on timeout so the caller can fall back to a safe default rather than guess an answer.
 */
async function promptTextWithTimeout(question: string, timeoutMs: number): Promise<string | undefined> {
  const TIMED_OUT = Symbol('timed out')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = rl.question(question).catch(() => '')
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    setTimeout(() => resolve(TIMED_OUT), timeoutMs).unref()
  })
  const result = await Promise.race([answer, timeout])
  rl.close()
  return result === TIMED_OUT ? undefined : result.trim()
}

export async function promptWithTimeout(question: string, timeoutMs = PROMPT_TIMEOUT_MS): Promise<string | undefined> {
  const answer = await promptTextWithTimeout(question, timeoutMs)
  return answer?.toLowerCase()
}

/**
 * Read a secret without placing it in terminal output. Unix TTYs use the native `stty` echo
 * switch; non-TTY callers get no prompt so an agent cannot accidentally block or leak a key.
 */
export async function promptSecretWithTimeout(question: string, timeoutMs = PROMPT_TIMEOUT_MS): Promise<string | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined
  if (process.platform === 'win32') {
    // Windows has no portable stdlib echo toggle. Keep the safe contract: use an environment
    // variable or secrets file instead of ever echoing a pasted credential.
    return undefined
  }
  const disabled = spawnSync('stty', ['-echo'], { stdio: 'ignore' }).status === 0
  if (!disabled) return undefined
  try {
    const answer = await promptTextWithTimeout(question, timeoutMs)
    return answer
  } finally {
    spawnSync('stty', ['echo'], { stdio: 'ignore' })
    process.stdout.write('\n')
  }
}
