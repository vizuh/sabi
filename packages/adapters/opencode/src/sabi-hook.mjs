import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_CONTROLLER_URL = 'http://127.0.0.1:7433'

function controllerToken() {
  if (process.env.SABI_CONTROLLER_TOKEN) return process.env.SABI_CONTROLLER_TOKEN
  const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state')
  const stateDir = process.env.SABI_CONTROLLER_HOME || (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'sabi')
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
  return status === 'started' || status === 'completed' || status === 'rerouted'
}

export async function SabiOpenCodePlugin(context) {
  const controllerURL = process.env.SABI_CONTROLLER_URL || DEFAULT_CONTROLLER_URL
  const cwd = context.directory || context.worktree || process.cwd()
  return {
    'chat.message': async (input, output) => {
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
      const plan = await post(controllerURL, '/plan', { request, cwd, currentSession: sessionId, currentHarness: 'opencode' })
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
        ...(override ? { override } : {}),
      })
      if (sessionId && result?.execution?.status) {
        const status = result.execution.status === 'failed' ? 'failed' : accepted(result) ? 'completed' : 'unverifiable'
        await post(controllerURL, '/v1/sessions/outcome', {
          sessionId,
          adapter: 'opencode',
          harness: 'opencode',
          worktree: cwd,
          outcome: status,
        })
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
