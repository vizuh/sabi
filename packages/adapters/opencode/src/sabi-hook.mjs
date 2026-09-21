import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_CONTROLLER_URL = 'http://127.0.0.1:7433'

/**
 * Reads a real environment string. OpenCode 1.18.31's plugin sandbox returns the
 * plugin context object for `process.env.<key>` reads (verified live 2026-09-21
 * with an instrumented probe plugin: even a genuinely exported string arrives as
 * an object, so `.trim()` crashed every load). Every env read is therefore
 * type-guarded and prefers `Bun.env`, which still exposes real strings there.
 */
export function envString(key) {
  try {
    const bunEnv = globalThis.Bun?.env
    const viaBun = bunEnv ? bunEnv[key] : undefined
    if (typeof viaBun === 'string') return viaBun
  } catch {
    // A sandboxed or absent Bun global must never break the plugin.
  }
  try {
    const viaProcess = process?.env ? process.env[key] : undefined
    return typeof viaProcess === 'string' ? viaProcess : undefined
  } catch {
    return undefined
  }
}

export function trustedControllerURL(value = envString('SABI_CONTROLLER_URL')) {
  const candidate = (typeof value === 'string' && value ? value : DEFAULT_CONTROLLER_URL).trim()
  try {
    const parsed = new URL(candidate)
    const host = parsed.hostname.toLowerCase()
    if (parsed.protocol !== 'http:' || parsed.username || parsed.password) return undefined
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]' && host !== '::1') return undefined
    return candidate.replace(/\/+$/, '')
  } catch {
    return undefined
  }
}

function controllerToken() {
  const explicitToken = envString('SABI_CONTROLLER_TOKEN')
  if (explicitToken) return explicitToken
  const stateHome = envString('XDG_STATE_HOME') || path.join(os.homedir(), '.local', 'state')
  const stateDir = envString('SABI_CONTROLLER_HOME') || (process.platform === 'win32'
    ? path.join(envString('LOCALAPPDATA') || path.join(os.homedir(), 'AppData', 'Local'), 'sabi')
    : path.join(stateHome, 'sabi'))
  try {
    const value = JSON.parse(readFileSync(path.join(stateDir, 'daemon.json'), 'utf8'))
    return typeof value?.token === 'string' ? value.token : undefined
  } catch {
    return undefined
  }
}

async function post(controllerURL, pathname, body) {
  try {
    const token = controllerToken()
    const response = await fetch(`${controllerURL}${pathname}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return undefined
    const value = await response.json()
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

function textFromParts(parts) {
  return (Array.isArray(parts) ? parts : [])
    .map((part) => part && typeof part === 'object' && typeof part.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .trim()
}

function targetOverride(action, target) {
  if (!target || typeof target !== 'object') return undefined
  if (action === 'DELEGATE' && typeof target.id === 'string') return { sessionId: target.id }
  if (action === 'SPAWN' && typeof target.agent === 'string') return { harness: target.agent }
  return undefined
}

function accepted(record) {
  const status = record?.execution?.status
  const phase = record?.execution?.receipt?.phase
  return (status === 'started' || status === 'completed' || status === 'rerouted') &&
    (phase === 'accepted' || phase === 'started' || phase === 'completed')
}

function targetHarness(...records) {
  for (const record of records) {
    const target = record && typeof record === 'object' && record.target && typeof record.target === 'object'
      ? record.target
      : undefined
    for (const key of ['harness', 'agent']) {
      if (typeof target?.[key] === 'string' && target[key].trim()) return target[key].trim()
    }
  }
  return undefined
}

export async function SabiOpenCodePlugin(context) {
  const controllerURL = trustedControllerURL()
  const cwd = context.directory || context.worktree || process.cwd()
  return {
    'chat.message': async (input, output) => {
      if (!controllerURL) return
      const request = textFromParts(output?.parts)
      if (!request) return
      const sessionId = typeof input?.sessionID === 'string'
        ? input.sessionID
        : typeof input?.sessionId === 'string'
          ? input.sessionId
          : typeof context.sessionID === 'string'
            ? context.sessionID
            : typeof context.sessionId === 'string'
              ? context.sessionId
              : undefined
      if (sessionId) {
        await post(controllerURL, '/v1/sessions/register', {
          sessionId,
          adapter: 'opencode',
          harness: 'opencode',
          worktree: cwd,
          lifecycle: 'active',
        })
      }
      const idempotencyKey = randomUUID()
      const plan = await post(controllerURL, '/plan', { request, cwd, currentSession: sessionId, currentHarness: 'opencode', idempotencyKey })
      const action = typeof plan?.action === 'string' ? plan.action : ''
      if (!['DELEGATE', 'SPAWN', 'ORCHESTRATE'].includes(action)) return
      const override = targetOverride(action, plan.target)
      if (action !== 'ORCHESTRATE' && !override) return
      const result = await post(controllerURL, '/route', {
        request,
        cwd,
        currentSession: sessionId,
        currentHarness: 'opencode',
        orchestrate: action === 'ORCHESTRATE',
        idempotencyKey,
        ...(override ? { override } : {}),
      })
      // Record the receipt against the session that actually received the work, preserving
      // the execution status: a started or rerouted target is never reported as completed, and
      // the source session is never credited for work it did not execute. Spawned and
      // orchestrated targets have no addressable session yet, so no outcome is recorded for them.
      if (sessionId && result?.execution?.status) {
        const executionStatus = result.execution.status
        const outcome = executionStatus === 'failed' ? 'failed'
          : executionStatus === 'completed' ? 'completed'
          : executionStatus === 'started' || executionStatus === 'rerouted' ? 'started'
          : 'unverifiable'
        const targetId = typeof result.execution.targetId === 'string' ? result.execution.targetId : undefined
        const outcomeSessionId = action === 'DELEGATE' && targetId?.startsWith('session:') ? targetId : undefined
        const executionHarness = targetHarness(result, plan)
        if (outcomeSessionId && executionHarness) {
          await post(controllerURL, '/v1/sessions/outcome', {
            sessionId: outcomeSessionId,
            adapter: executionHarness,
            harness: executionHarness,
            worktree: cwd,
            outcome,
            idempotencyKey,
            ...(result.execution.receipt ? { receipt: result.execution.receipt } : {}),
          })
        }
      }
      if (!accepted(result)) return
      // chat.message exposes the mutable parts list, so the current session does not execute the
      // same request after the controller has dispatched it elsewhere.
      output.parts.splice(0, output.parts.length, {
        type: 'text',
        text: `Sabi ${action === 'DELEGATE' ? 'delegated' : action === 'SPAWN' ? 'started' : action.toLowerCase()} this request to ${result.target?.agent || 'the selected agent'}.`,
      })
    },
  }
}

export default SabiOpenCodePlugin
