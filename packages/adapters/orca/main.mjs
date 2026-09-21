const COMMAND_ID = 'sabi.dispatch'
const EVENT_NAMES = ['worktree.created', 'worktree.removed', 'agent.status.changed']

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

export function normalizeDispatchArgs(args) {
  if (typeof args === 'string') return { request: args.trim() }
  if (Array.isArray(args)) return { request: args.filter((value) => typeof value === 'string').join(' ').trim() }
  const object = record(args)
  return {
    request: typeof object?.request === 'string'
      ? object.request.trim()
      : typeof object?.text === 'string'
        ? object.text.trim()
        : typeof object?.prompt === 'string'
          ? object.prompt.trim()
          : '',
    terminalId: typeof object?.terminalId === 'string' ? object.terminalId.trim() : undefined,
  }
}

export function selectTerminal(context, requestedTerminalId) {
  const terminals = Array.isArray(context?.terminals)
    ? context.terminals.filter((terminal) => typeof terminal?.id === 'string' && terminal.id.trim())
    : []
  if (requestedTerminalId && !terminals.some((terminal) => terminal.id === requestedTerminalId)) {
    throw new Error(`terminal '${requestedTerminalId}' is outside the focused worktree`)
  }
  const terminalId = requestedTerminalId || terminals[0]?.id
  if (!terminalId) throw new Error('focused worktree has no terminal to receive the request')
  return terminalId
}

// C0 controls + DEL + the C1 range (U+0080-U+009F, e.g. NEL/U+0085, CSI/U+009B) — a terminal
// configured for 8-bit C1 interpretation treats several of those as a line break or escape
// introducer too, not just \n/\r.
// eslint-disable-next-line no-control-regex -- the whole point is detecting control characters
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f-\x9f]/

export async function dispatchToTerminal(orca, args) {
  const input = normalizeDispatchArgs(args)
  if (!input.request) throw new Error('Sabi dispatch requires a non-empty request')
  // terminal.sendText fires one Enter keypress; an embedded newline/carriage-return would submit
  // each line as its own shell command, turning "one dispatched request" into arbitrary multi-command
  // execution. Reject outright rather than silently stripping — a caller with a legitimate multi-line
  // need should send multiple dispatches, not have this adapter guess how to collapse one for them.
  if (CONTROL_CHARACTERS.test(input.request)) {
    throw new Error('Sabi dispatch request must not contain control characters (e.g. newlines)')
  }
  const context = await orca.host.call('workspace.readContext', {})
  if (!context) throw new Error('no focused Orca worktree is available')
  const terminalId = selectTerminal(context, input.terminalId)
  const sent = await orca.host.call('terminal.sendText', { terminalId, text: input.request, enter: true })
  if (sent?.accepted !== true) throw new Error(`Orca did not accept input for terminal '${terminalId}'`)
  orca.log(`[Sabi] dispatched to ${terminalId} in ${context.displayName || 'focused worktree'}`)
  return {
    ok: true,
    action: 'DISPATCH',
    terminalId,
    branch: context.branch,
    displayName: context.displayName,
  }
}

export default function activate(orca) {
  orca.commands.register(COMMAND_ID, (args) => dispatchToTerminal(orca, args))
  for (const eventName of EVENT_NAMES) {
    orca.events.on(eventName, (payload) => {
      const event = record(payload)
      orca.log(`[Sabi] ${eventName}${event?.worktreeId ? ` in ${event.worktreeId}` : ''}`)
    })
  }
}
