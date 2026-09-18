/** Opt-in real-client protocol probe. Synthetic local inference only; never a paid provider. */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createSabiServer } from '@sabi/server'
import { validateConfig } from '@sabi/core'

const MARKER = 'SABI_FIXTURE_OK'
const host = process.argv[2]
const executable = process.argv[3]
if (!['opencode', 'kilo-cli'].includes(host ?? '') || !executable || !path.isAbsolute(executable)) {
  throw new Error('usage: node packages/evals/src/client-smoke.ts opencode|kilo-cli /absolute/client/path')
}
const root = path.resolve('.sabi/compat', `${host}-${randomUUID()}`)
const home = path.join(root, 'home')
const workspace = path.join(root, 'workspace')
await mkdir(workspace, { recursive: true })
await mkdir(home, { recursive: true })
const fixturePath = path.join(workspace, 'fixture.txt')
await writeFile(fixturePath, `${MARKER}\n`)
const calls: Array<{ model: string; tools: boolean; returnedFixture: boolean; lastRole: string; readFields: string[] }> = []
let protocolErrors = 0
const upstream = createServer(async (req, res) => {
  if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
    protocolErrors += 1
    res.writeHead(404).end()
    return
  }
  try {
    const chunks: Buffer[] = []
    let length = 0
    for await (const chunk of req) {
      length += chunk.length
      if (length > 4 * 1024 * 1024) throw new Error('fixture request too large')
      chunks.push(Buffer.from(chunk))
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const tools = Array.isArray(body.tools) ? body.tools : []
    const messages = Array.isArray(body.messages) ? body.messages : []
    const returnedFixture = messages.some((m: { role?: string; content?: unknown }) =>
      m.role === 'tool' && JSON.stringify(m.content).includes(MARKER))
    if (calls.length >= 12) throw new Error('synthetic fixture request limit reached')
    const readTool = tools.find((t: { function?: { name?: string } }) => t.function?.name === 'read')
    const readFields = Object.keys(readTool?.function?.parameters?.properties ?? {})
    calls.push({ model: String(body.model), tools: tools.length > 0, returnedFixture,
      lastRole: String(messages.at(-1)?.role), readFields })
    const wantsTool = tools.length > 0 && !returnedFixture
    if (wantsTool && !readTool) throw new Error('client did not expose supported read tool')
    const completionId = `chatcmpl-${randomUUID()}`
    const base = { id: completionId, object: 'chat.completion.chunk', created: 0, model: body.model }
    const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
    const pathField = ['filePath', 'file_path', 'path'].find(key => readFields.includes(key))
    if (wantsTool && !pathField) throw new Error('read tool path schema is unknown')
    const args = JSON.stringify({ [pathField ?? 'filePath']: fixturePath })
    const cut = Math.floor(args.length / 2)
    const parts = wantsTool ? [
      { ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0,
        id: 'call_fixture_read', type: 'function', function: { name: 'read', arguments: args.slice(0, cut) } }] }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(cut) } }] }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ] : [
      { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: tools.length ? MARKER : 'Fixture title' }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]
    if (body.stream === true) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const part of parts) res.write(`data: ${JSON.stringify(part)}\n\n`)
      res.end(`data: ${JSON.stringify({ ...base, choices: [], usage })}\n\ndata: [DONE]\n\n`)
    } else {
      const message = wantsTool ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_fixture_read',
        type: 'function', function: { name: 'read', arguments: args } }] } : { role: 'assistant', content: MARKER }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...base,
        object: 'chat.completion', choices: [{ index: 0, message, finish_reason: wantsTool ? 'tool_calls' : 'stop' }], usage }))
    }
  } catch {
    protocolErrors += 1
    if (!res.headersSent) res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'synthetic protocol fixture rejected request' } }))
  }
})
await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
const upstreamAddress = upstream.address()
if (!upstreamAddress || typeof upstreamAddress === 'string') throw new Error('mock listen failed')
const config = validateConfig({
  upstreams: { fixture: { baseURL: `http://127.0.0.1:${upstreamAddress.port}/v1`, apiKey: false, streamUsage: true } },
  models: Object.fromEntries(['cheap', 'mid', 'strong'].map(tier => [tier, { upstream: 'fixture', model: `fixture-${tier}`,
    contextWindow: 200000, cost: { input: 0, output: 0 } }])),
  aliases: { 'sabi-code': 'auto', 'sabi-mid': 'mid' },
  policy: { 'first-turn': 'mid', exploration: 'cheap', implementation: 'mid', verification: 'strong', unclassified: 'mid', failure: 'strong' },
  telemetry: { allowlistOnly: true },
})
const sabi = createSabiServer({ config, logFile: path.join(root, 'decisions.jsonl'), verbose: false })
const sabiPort = await sabi.listen(0, '127.0.0.1')
const provider = host === 'kilo-cli' ? 'openai-compatible' : 'sabi'
const clientConfig = {
  model: `${provider}/sabi-code`, small_model: `${provider}/sabi-code`,
  permission: { '*': 'deny', read: { '*': 'deny', 'fixture.txt': 'allow', [fixturePath]: 'allow' } },
  provider: { [provider]: { npm: '@ai-sdk/openai-compatible', name: 'Sabi synthetic fixture',
    options: { baseURL: `http://127.0.0.1:${sabiPort}/v1`, apiKey: 'local-fixture-not-a-secret',
      headers: { 'X-Sabi-Client': host } },
    models: { 'sabi-code': { name: 'Synthetic tools', tool_call: true,
      limit: { context: 200000, output: 4096 }, modalities: { input: ['text'], output: ['text'] } } } } },
}
await writeFile(path.join(workspace, host === 'kilo-cli' ? 'kilo.jsonc' : 'opencode.json'), JSON.stringify(clientConfig, null, 2))
const args = ['run', ...(host === 'opencode' ? ['--pure'] : []), '--model', `${provider}/sabi-code`,
  '--format', 'json', '--title', 'Sabi synthetic compatibility test',
  'Read only fixture.txt using the read tool, then reply with its exact contents. Do not run commands or modify any file.']
const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '', HOME: home, LANG: 'C.UTF-8', TERM: 'dumb',
  XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'),
  XDG_CACHE_HOME: path.join(home, '.cache'), XDG_STATE_HOME: path.join(home, '.local/state') }
let stdout = ''; let stderr = ''; let timedOut = false
const child = spawn(executable, args, { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
child.stdout.on('data', chunk => { if (stdout.length < 2_000_000) stdout += chunk.toString() })
child.stderr.on('data', chunk => { if (stderr.length < 2_000_000) stderr += chunk.toString() })
const stop = () => {
  if (child.pid) {
    try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM') } catch { /* already exited */ }
  }
}
const timer = setTimeout(() => { timedOut = true; stop() }, 60_000)
const hardTimer = setTimeout(() => {
  if (child.pid) {
    try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL') } catch { /* already exited */ }
  }
}, 65_000)
let exitCode: number | null = null
try {
  exitCode = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve(code)) })
} finally {
  clearTimeout(timer)
  clearTimeout(hardTimer)
  stop()
  await sabi.close()
  upstream.closeAllConnections()
  await new Promise<void>(resolve => upstream.close(() => resolve()))
}
const mainCalls = calls.filter(c => c.tools)
const readSucceeded = mainCalls.some(c => c.returnedFixture)
const routedAcrossModels = new Set(mainCalls.map(c => c.model)).size >= 2
const fixtureUnchanged = await readFile(fixturePath, 'utf8') === `${MARKER}\n`
const passed = exitCode === 0 && !timedOut && protocolErrors === 0 && readSucceeded && routedAcrossModels && stdout.includes(MARKER) && fixtureUnchanged
const summary = { host, test: 'real-client-local-mock', passed, exitCode, timedOut,
  protocolErrors, calls, readSucceeded, routedAcrossModels, outputMarker: stdout.includes(MARKER),
  fixtureUnchanged,
  paidInference: false, profileIsolated: true }
await writeFile(path.join(root, 'result.json'), JSON.stringify(summary, null, 2))
// Failure diagnostics remain inside the isolated synthetic fixture; never copy user profiles/logs here.
if (!passed) await writeFile(path.join(root, 'client-error.log'), stderr.slice(-12000))
console.log(JSON.stringify({ ...summary, artifact: path.relative(process.cwd(), root) }, null, 2))
if (!passed) process.exitCode = 1
