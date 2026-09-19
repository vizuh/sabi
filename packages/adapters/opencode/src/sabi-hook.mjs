const DEFAULT_CONTROLLER_URL = 'http://127.0.0.1:7433'

async function post(controllerURL, pathname, body) {
  try {
    const response = await fetch(`${controllerURL}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
      const plan = await post(controllerURL, '/plan', { request, cwd })
      const action = typeof plan?.action === 'string' ? plan.action : ''
      if (!['DELEGATE', 'SPAWN', 'ORCHESTRATE'].includes(action)) return
      const override = targetOverride(action, plan.target)
      if (action !== 'ORCHESTRATE' && !override) return
      const result = await post(controllerURL, '/route', {
        request,
        cwd,
        orchestrate: action === 'ORCHESTRATE',
        ...(override ? { override } : {}),
      })
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
