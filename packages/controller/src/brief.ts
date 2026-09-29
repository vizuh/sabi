import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { EvidenceRef } from './types.ts'

export type { EvidenceRef }

/**
 * Task brief (spec 018): a preparer harness explores a task on free inference in a
 * disposable worktree; Sabi checks its findings by reading, compiles a bounded brief,
 * and a fresh Claude Code session executes from it. Sabi never runs the task's
 * commands itself: it only creates and removes the isolated worktree.
 */

export interface PreparerFindings {
  facts: Array<{ claim: string; ref?: EvidenceRef }>
  relevantSurface: string[]
  constraints: Array<{ rule: string; source?: string }>
  hypotheses: string[]
  ruledOut: string[]
  testCommand?: string
  firstAction?: string
}

export interface GatedItem { claim: string; ref: EvidenceRef; excerpt: string }

export interface GateResult {
  verified: GatedItem[]
  /** Command results the preparer reported; Sabi did not re-run them. */
  reported: GatedItem[]
  /** Claims Sabi could not confirm, with the reason. */
  uncertain: Array<{ claim: string; reason: string }>
}

export const BRIEF_BOUNDS = { maxItems: 20, maxBytes: 8 * 1024, maxItemBytes: 1024 } as const

/** Paths the gate never opens, whatever a finding cites. */
const SECRET_PATH = /(^|\/)(\.env(\..*)?|secrets?(\/|$)|.*\.pem$|.*\.key$|id_rsa.*|\.npmrc$|credentials?(\.json)?$)/i

export function preparerPrompt(task: string): string {
  return `<context>
You are preparing a task for another engineer, Claude Code, who will do the actual work in a fresh session. What you report becomes that engineer's starting brief. Accuracy matters more than coverage: a wrong "fact" costs them more time than a missing one, because they will build on it.

You are working in a disposable clone of the repository with no remote. Nothing you do here reaches the engineer's copy.
</context>

<task>
The task to prepare is: ${JSON.stringify(task)}

Investigate it. Find the files involved, run the checks that show the current state (for example the test command), and work out the likely cause or approach. Do not do the task itself: your job ends at understanding.
</task>

<rules>
- Do not edit, create or delete files. This is an investigation, and the engineer needs to find the repository exactly as it is.
- Read the repository's own instruction files (AGENTS.md, CLAUDE.md, README) if present, and report any constraint that applies to this task.
- A fact must point at evidence you observed yourself in this session: a file path with the line numbers you read, or a command you ran with its exit code. Anything you believe but did not directly observe is a hypothesis, however likely it seems.
</rules>

<output>
Finish your reply with exactly one JSON object between a line containing only SABI_FINDINGS_BEGIN and a line containing only SABI_FINDINGS_END. Use this shape:

{
  "facts": [
    { "claim": "one sentence", "ref": { "kind": "file", "path": "relative/path", "lineStart": 4, "lineEnd": 6, "quote": "the exact text of those lines" } },
    { "claim": "one sentence", "ref": { "kind": "command", "command": "npm test", "exitCode": 1, "excerpt": "at most 5 relevant output lines" } }
  ],
  "relevantSurface": ["relative/path"],
  "constraints": [ { "rule": "text", "source": "AGENTS.md" } ],
  "hypotheses": ["what you believe but did not directly observe"],
  "ruledOut": ["what you checked and eliminated, with the reason"],
  "testCommand": "the command that verifies the task",
  "firstAction": "the single best next step for the engineer"
}

The "quote" must be copied exactly from the file, because it will be checked mechanically against the file.
</output>
`
}

const MAX_LIST = 12
const MAX_TEXT = 400

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').slice(0, MAX_LIST).map((v) => clip(v.trim()))
    : []
}

function looksLikeFindings(raw: string): boolean {
  const value = JSON.parse(raw) as unknown
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    ['facts', 'hypotheses', 'relevantSurface'].some((key) => key in value)
}

/**
 * The last findings object in `text` that starts at the beginning of a line. JSON.parse does
 * the string and escape handling; a candidate must look like findings, because pretty-printed
 * output also has indented lines that open a single fact. Candidates are bounded so a huge,
 * JSON-free output stays cheap.
 */
function lastJsonObject(text: string): string | undefined {
  const tail = text.slice(-256 * 1024).replace(/```(?:json)?/g, '')
  const starts: number[] = []
  for (const match of tail.matchAll(/(^|\n)[ \t]*\{/g)) starts.push(match.index + match[0].length - 1)
  for (const start of starts.reverse().slice(0, 64)) {
    const rest = tail.slice(start)
    try {
      if (looksLikeFindings(rest)) return rest
      continue
    } catch (error) {
      // Text after a complete object ("Unexpected non-whitespace character after JSON at
      // position N"): the object is the first N characters.
      const at = /after JSON at position (\d+)/.exec((error as Error).message)
      if (!at) continue
      const candidate = rest.slice(0, Number(at[1]))
      try {
        if (looksLikeFindings(candidate)) return candidate
      } catch {
        // not an object from this line; try an earlier one
      }
    }
  }
  return undefined
}

/**
 * Findings from a preparer's final message. Tolerant by design: harnesses and models drop
 * the begin marker or wrap the object in a code fence (observed: pi 0.84.2 on 2026-09-29).
 */
export function parseFindings(output: string): PreparerFindings | undefined {
  const end = output.lastIndexOf('SABI_FINDINGS_END')
  const begin = output.lastIndexOf('SABI_FINDINGS_BEGIN', end >= 0 ? end : undefined)
  const region = begin >= 0 && end > begin ? output.slice(begin + 'SABI_FINDINGS_BEGIN'.length, end)
    : end >= 0 ? output.slice(0, end) : output
  const raw = lastJsonObject(region)
  if (!raw) return undefined
  const data = JSON.parse(raw) as Record<string, unknown>
  const facts = Array.isArray(data.facts) ? data.facts.flatMap((fact) => {
    if (!fact || typeof fact !== 'object') return []
    const { claim, ref } = fact as { claim?: unknown; ref?: unknown }
    if (typeof claim !== 'string' || !claim.trim()) return []
    return [{ claim: clip(claim.trim()), ref: ref && typeof ref === 'object' ? ref as EvidenceRef : undefined }]
  }).slice(0, 4 * MAX_LIST) : []
  const constraints = Array.isArray(data.constraints) ? data.constraints.flatMap((c) =>
    c && typeof c === 'object' && typeof (c as { rule?: unknown }).rule === 'string'
      ? [{ rule: clip((c as { rule: string }).rule.trim()), source: typeof (c as { source?: unknown }).source === 'string' ? clip((c as { source: string }).source) : undefined }]
      : typeof c === 'string' ? [{ rule: clip(c.trim()) }] : []).slice(0, MAX_LIST) : []
  return {
    facts,
    relevantSurface: stringList(data.relevantSurface),
    constraints,
    hypotheses: stringList(data.hypotheses),
    ruledOut: stringList(data.ruledOut),
    testCommand: typeof data.testCommand === 'string' ? clip(data.testCommand.trim()) : undefined,
    firstAction: typeof data.firstAction === 'string' ? clip(data.firstAction.trim()) : undefined,
  }
}

function bounded(text: string, max: number = BRIEF_BOUNDS.maxItemBytes): string {
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.length <= max) return text
  return `${buffer.subarray(0, max - 20).toString('utf8').replace(/�$/, '')}\n… [truncated]`
}

/** A repository-relative path that stays inside `root` after symlinks, or undefined. */
function safeFile(root: string, relative: string): string | undefined {
  if (!relative || path.isAbsolute(relative) || SECRET_PATH.test(relative)) return undefined
  const resolved = path.resolve(root, relative)
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return undefined
  const real = realpathSync(resolved)
  const realRoot = realpathSync(root)
  return real.startsWith(realRoot + path.sep) && !SECRET_PATH.test(path.relative(realRoot, real)) ? real : undefined
}

/**
 * Check each finding against the user's live worktree. A file fact is verified when its
 * quote occurs in the file; line numbers are corrected to where it actually is (preparers
 * miscount lineEnd). Command facts are the preparer's report: kept, never marked verified.
 */
export function gateFindings(findings: PreparerFindings, root: string, context: { baseCommit?: string; preparer?: string } = {}): GateResult {
  const result: GateResult = { verified: [], reported: [], uncertain: [] }
  for (const fact of findings.facts) {
    const ref = fact.ref
    if (!ref || (ref.kind !== 'file' && ref.kind !== 'command')) {
      result.uncertain.push({ claim: fact.claim, reason: 'no evidence reference' })
      continue
    }
    if (ref.kind === 'command') {
      if (typeof ref.command !== 'string' || !ref.command.trim()) {
        result.uncertain.push({ claim: fact.claim, reason: 'command reference without a command' })
        continue
      }
      result.reported.push({
        claim: fact.claim,
        ref: { kind: 'command', command: ref.command, exitCode: Number.isInteger(ref.exitCode) ? ref.exitCode : undefined, baseCommit: context.baseCommit, preparer: context.preparer },
        excerpt: bounded(typeof ref.excerpt === 'string' ? ref.excerpt : ''),
      })
      continue
    }
    const file = typeof ref.path === 'string' ? safeFile(root, ref.path) : undefined
    const quote = typeof ref.quote === 'string' ? ref.quote.replace(/\r\n/g, '\n').replace(/\n+$/, '') : ''
    if (!file || !quote.trim()) {
      result.uncertain.push({ claim: fact.claim, reason: file ? 'no quote to check' : `cited file not readable in the worktree: ${String(ref.path)}` })
      continue
    }
    const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')
    const quoted = quote.split('\n').map((line) => line.trimEnd())
    const starts: number[] = []
    for (let i = 0; i + quoted.length <= lines.length; i++) {
      if (quoted.every((line, k) => lines[i + k].trimEnd() === line)) starts.push(i + 1)
    }
    if (starts.length === 0) {
      result.uncertain.push({ claim: fact.claim, reason: `quote not found in ${ref.path}` })
      continue
    }
    const claimed = Number.isInteger(ref.lineStart) ? ref.lineStart! : starts[0]
    const lineStart = starts.reduce((best, s) => Math.abs(s - claimed) < Math.abs(best - claimed) ? s : best)
    result.verified.push({
      claim: fact.claim,
      ref: { kind: 'file', path: ref.path, lineStart, lineEnd: lineStart + quoted.length - 1, baseCommit: context.baseCommit, preparer: context.preparer },
      excerpt: bounded(quoted.join('\n')),
    })
  }
  return result
}

export interface BriefInput {
  id: string
  task: string
  repo: string
  branch?: string
  baseCommit: string
  userTreeDirty: boolean
  preparer: string
  findings: PreparerFindings
  gate: GateResult
}

export interface BriefBounds { included: number; dropped: number; bytesBefore: number; bytesAfter: number }

function sourceOf(ref: EvidenceRef): string {
  if (ref.kind === 'file') return ref.lineEnd && ref.lineEnd !== ref.lineStart ? `${ref.path}:${ref.lineStart}-${ref.lineEnd}` : `${ref.path}:${ref.lineStart}`
  return `\`${ref.command}\`${ref.exitCode !== undefined ? ` → exit ${ref.exitCode}` : ''}`
}

function renderItem(item: GatedItem): string {
  const fence = item.excerpt.includes('```') ? '````' : '```'
  return `- ${item.claim}\n  Source: ${sourceOf(item.ref)}${item.excerpt ? `\n  ${fence}\n${item.excerpt.split('\n').map((l) => `  ${l}`).join('\n')}\n  ${fence}` : ''}`
}

/**
 * Deterministic brief (same input, same bytes). Long material first, the request last;
 * one XML-tagged section per kind of content (Anthropic prompting guidance, spec 018).
 */
export function compileBrief(input: BriefInput): { markdown: string; bounds: BriefBounds } {
  const f = input.findings
  // One byte budget over everything the preparer contributed, in priority order: verified
  // facts, reported results, then the lists. Fact items also keep their 20-item cap.
  type Group = 'verified' | 'reported' | 'uncertain' | 'hypotheses' | 'ruledOut' | 'surface' | 'constraints'
  const entries: Array<{ group: Group; text: string }> = [
    ...input.gate.verified.map((item) => ({ group: 'verified' as const, text: renderItem(item) })),
    ...input.gate.reported.map((item) => ({ group: 'reported' as const, text: renderItem(item) })),
    ...input.gate.uncertain.slice(0, MAX_LIST).map((u) => ({ group: 'uncertain' as const, text: `- ${u.claim} (${u.reason})` })),
    ...f.hypotheses.map((h) => ({ group: 'hypotheses' as const, text: `- ${h}` })),
    ...f.ruledOut.map((r) => ({ group: 'ruledOut' as const, text: `- ${r}` })),
    ...f.relevantSurface.map((r) => ({ group: 'surface' as const, text: `- ${r}` })),
    ...f.constraints.map((c) => ({ group: 'constraints' as const, text: `- ${c.source ? `${c.rule} (${c.source})` : c.rule}` })),
  ]
  const bytesBefore = entries.reduce((sum, e) => sum + Buffer.byteLength(e.text), 0)
  const kept: typeof entries = []
  let bytes = 0
  let factItems = 0
  for (const entry of entries) {
    const size = Buffer.byteLength(entry.text)
    const isFact = entry.group === 'verified' || entry.group === 'reported'
    if ((isFact && factItems >= BRIEF_BOUNDS.maxItems) || bytes + size > BRIEF_BOUNDS.maxBytes) continue
    kept.push(entry)
    bytes += size
    if (isFact) factItems++
  }
  const of = (group: Group) => kept.filter((e) => e.group === group).map((e) => e.text)
  const verified = of('verified')
  const reported = of('reported')
  const section = (group: Group, empty: string) => of(group).join('\n') || empty
  const markdown = `# Task brief ${input.id}

This brief was prepared by a cheaper model (${input.preparer}) exploring a disposable copy of the repository, so you can start with the useful context instead of rediscovering it. Sabi checked every fact under <verified_facts> against the files in your working tree; everything else is labelled with how far it can be trusted. Verify the facts your plan depends on before building on them.

<repo_state>
- Repository: ${input.repo}
- Branch: ${input.branch ?? 'detached'}
- Commit the preparer saw: ${input.baseCommit}
- Working tree: ${input.userTreeDirty ? 'has uncommitted changes the preparer did not see; re-check anything they touch' : 'clean when the brief was prepared'}
</repo_state>

<verified_facts>
${verified.length ? verified.join('\n') : 'None could be confirmed by reading the files.'}
</verified_facts>

<reported_results>
Command results the preparer reported from its copy. Sabi did not re-run them; run them yourself before relying on the output.
${reported.length ? reported.join('\n') : 'None reported.'}
</reported_results>

<relevant_surface>
${section('surface', 'Not established.')}
</relevant_surface>

<ruled_out>
${section('ruledOut', 'Nothing ruled out yet.')}
</ruled_out>

<uncertainties>
${section('uncertain', 'None recorded.')}
</uncertainties>

<proposed_path>
The preparer's hypotheses. They are not facts: confirm before acting on them.
${section('hypotheses', 'None offered.')}
</proposed_path>

<constraints>
${section('constraints', 'None specific to this task beyond the repository instruction files you already load.')}
</constraints>

<task>
${clip(input.task)}
</task>

<success_criteria>
${f.testCommand ? `- \`${f.testCommand}\` passes, and the change does what the task asks.` : '- No verification command was established; establish one before changing code.'}
</success_criteria>

If the work will span more than one session, keep short notes in progress.md and the check status in state.json, both next to this brief; for a single-session task, skip them.

<first_action>
${f.firstAction ?? 'Read the relevant surface above, then run the verification command to see the current state.'}
</first_action>
`
  return {
    markdown,
    bounds: { included: kept.length, dropped: entries.length - kept.length, bytesBefore, bytesAfter: bytes },
  }
}

/** Built-in preparer presets, as probed on 2026-09-29 against the installed versions. */
export type PreparerId = 'hermes' | 'omp' | 'pi' | 'prime'
export const PREPARERS: readonly PreparerId[] = ['hermes', 'omp', 'pi', 'prime']

function piStyleModels(baseURL: string, alias: string, client?: string): string {
  return JSON.stringify({
    providers: {
      sabi: {
        baseUrl: baseURL, api: 'openai-completions', apiKey: 'sabi-local-placeholder',
        // Sabi accepts only known client ids here (pi is not one), so pi sends none.
        ...(client ? { headers: { 'X-Sabi-Client': client } } : {}),
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
        models: [{ id: alias, contextWindow: 131072, maxTokens: 8192 }],
      },
    },
  }, null, 2)
}

function hermesProfile(baseURL: string, alias: string): string {
  return `model:
  provider: custom:sabi
  default: ${alias}
  base_url: ${baseURL}
  api_mode: chat_completions
  context_length: 131072
providers:
  sabi:
    api: ${baseURL}
    api_key: sabi-local-placeholder
    transport: chat_completions
    discover_models: false
    models:
      ${alias}:
        context_length: 131072
        prompt_caching: false
model_overrides:
  custom:sabi:
    ${alias}:
      context_window: 131072
      supports_tools: true
fallback_providers: []
fallback_model: null
auxiliary:
  title_generation:
    model_upgrade_enabled: false
telemetry:
  shared_metrics:
    enabled: false
    send: false
`
}

/** The argv and environment for one preparer run. Config dirs are generated, never the user's. */
export function preparerCommand(id: PreparerId, promptFile: string, scratch: string, baseURL: string, alias: string): { argv: string[]; env: Record<string, string> } {
  const prompt = readFileSync(promptFile, 'utf8')
  if (id === 'hermes') {
    const home = path.join(scratch, 'hermes-home')
    mkdirSync(home, { recursive: true })
    writeFileSync(path.join(home, 'config.yaml'), hermesProfile(baseURL, alias))
    return { argv: ['hermes', 'chat', '--query-file', promptFile, '--oneshot', '-Q', '--max-turns', '30', '--yolo'], env: { HERMES_HOME: home } }
  }
  if (id === 'omp') {
    // Its own agent dir (OMP keeps a SQLite state there), loading the Sabi extension that
    // `sabi setup` installed for OMP.
    const agentDir = path.join(scratch, 'omp-agent')
    mkdirSync(agentDir, { recursive: true })
    const extension = path.join(os.homedir(), '.omp', 'agent', 'extensions', 'sabi.ts')
    return {
      // The extension registers only `sabi-code`, so OMP always uses the adaptive alias.
      argv: ['omp', '-e', extension, '--model', 'sabi/sabi-code', '-p', '--no-session', prompt],
      env: { SABI_OMP_BASE_URL: baseURL, PI_CODING_AGENT_DIR: agentDir },
    }
  }
  const dir = path.join(scratch, `${id}-agent`)
  mkdirSync(dir, { recursive: true })
  mkdirSync(path.join(scratch, 'run'), { recursive: true, mode: 0o700 })
  writeFileSync(path.join(dir, 'models.json'), piStyleModels(baseURL, alias, id === 'pi' ? undefined : 'prime-agent'))
  if (id === 'pi') {
    return { argv: ['pi', '--offline', '--provider', 'sabi', '--model', alias, '-p', '--no-session', prompt], env: { PI_CODING_AGENT_DIR: dir } }
  }
  return {
    argv: ['prime-agent', '--provider', 'sabi', '--model', alias, '--thinking', 'off', '-p', '--no-session', prompt],
    env: {
      PRIME_AGENT_CODING_AGENT_DIR: dir, PRIME_AGENT_SESSION_DIR: path.join(scratch, 'prime-sessions'),
      // Its daemon needs a writable runtime dir for its socket.
      XDG_RUNTIME_DIR: path.join(scratch, 'run'), PRIME_AGENT_TELEMETRY: '0', DO_NOT_TRACK: '1',
    },
  }
}

/**
 * The environment a preparer gets: what a CLI needs to start and find its own files, and
 * nothing else. Provider keys, tokens and cloud credentials in the caller's shell stay out;
 * preparers reach models through Sabi with a placeholder key.
 */
export function preparerEnv(extra: Record<string, string>, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const allowed = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LANGUAGE', 'TERM', 'TMPDIR', 'TZ', 'NODE_OPTIONS'])
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && (allowed.has(key) || key.startsWith('LC_') || key.startsWith('XDG_'))) out[key] = value
  }
  return { ...out, ...extra }
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

export interface BriefReceipt {
  id: string
  preparer: string
  baseCommit: string
  userTreeUnchanged: boolean
  preparerExitCode: number | null
  seconds: number
  findings: boolean
  verified: number
  reported: number
  uncertain: number
  bounds: BriefBounds
  briefPath?: string
  fallbackReason?: string
}

export interface PrepareOptions {
  task: string
  cwd: string
  preparer: PreparerId | { argv: string[]; env?: Record<string, string> }
  baseURL: string
  alias: string
  briefsDir: string
  timeoutMs?: number
  /**
   * `bwrap` (default): the preparer sees the whole filesystem read-only except its clone
   * and scratch directory, with HOME and TMPDIR inside scratch. `none` runs it as the
   * current user with no filesystem restriction, and must be chosen explicitly.
   */
  sandbox?: 'bwrap' | 'none'
  /** The bubblewrap executable; overridable for tests. */
  bwrapCommand?: string
}

/** Home-relative locations that commonly hold credentials; masked inside the sandbox. */
const CREDENTIAL_DIRS = ['.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.config', '.claude', '.codex',
  '.hermes', '.pi', '.prime', '.password-store', '.local/share/keyrings']
const CREDENTIAL_FILES = ['.netrc', '.npmrc', '.pypirc', '.git-credentials', '.claude.json']

/**
 * Wrap a preparer in bubblewrap. Read-only root; only scratch (clone, generated config, HOME,
 * TMPDIR, runtime dir) is writable. /run is masked, so the user's D-Bus and systemd sockets
 * are unreachable (a reachable user bus let a preparer write anywhere via systemd-run), and a
 * new PID namespace and session stop it signalling or typing into host processes. Common
 * credential locations and the original repository are masked. Other readable files stay
 * readable, and the network is shared so the preparer can reach Sabi: this contains writes,
 * it does not make the rest of the disk secret.
 */
export function sandboxed(
  argv: string[], env: Record<string, string>, scratch: string, clone: string,
  options: { bwrap?: string; home?: string; hide?: string[] } = {},
): { argv: string[]; env: Record<string, string> } {
  const home = path.join(scratch, 'home')
  const tmp = path.join(scratch, 'tmp')
  const run = path.join(scratch, 'run')
  for (const dir of [home, tmp, run]) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const realHome = options.home ?? os.homedir()
  const masks: string[] = []
  for (const dir of CREDENTIAL_DIRS) {
    const target = path.join(realHome, dir)
    if (existsSync(target) && statSync(target).isDirectory()) masks.push('--tmpfs', target)
  }
  for (const file of CREDENTIAL_FILES) {
    const target = path.join(realHome, file)
    if (existsSync(target)) masks.push('--ro-bind', '/dev/null', target)
  }
  for (const dir of options.hide ?? []) masks.push('--tmpfs', dir)
  return {
    argv: [options.bwrap ?? 'bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc',
      '--tmpfs', '/tmp', '--tmpfs', '/run', '--ro-bind-try', '/run/systemd/resolve', '/run/systemd/resolve',
      ...masks, '--bind', scratch, scratch,
      '--unshare-pid', '--new-session', '--die-with-parent', '--chdir', clone, '--', ...argv],
    env: { ...env, HOME: home, TMPDIR: tmp, XDG_RUNTIME_DIR: run },
  }
}

/** True when bubblewrap can actually create its namespaces here, not merely that it exists. */
export function sandboxAvailable(bwrap = 'bwrap'): boolean {
  return spawnSync(bwrap, ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--unshare-pid', 'true'], { stdio: 'ignore', timeout: 10_000 }).status === 0
}

/**
 * A fingerprint of everything preparation must not change in the user's repository: the
 * working tree (status plus the full diff, so edits to an already-dirty file show), refs,
 * stash and local config.
 */
function repoFingerprint(root: string): string {
  const hash = createHash('sha256')
  for (const args of [['status', '--porcelain=v1', '-uall'], ['diff', 'HEAD', '--binary'], ['show-ref'], ['stash', 'list'], ['config', '--local', '--list']]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 })
    // show-ref exits 1 when there are no refs; anything else unexpected means the snapshot is
    // incomplete, and an incomplete snapshot must not be able to report "unchanged".
    if (result.error || (result.status !== 0 && !(args[0] === 'show-ref' && result.status === 1))) {
      throw new Error(`git ${args.join(' ')} failed while fingerprinting the repository`)
    }
    hash.update(args.join(' ')).update(result.stdout)
  }
  return hash.digest('hex')
}

function writeReceipt(dir: string, receipt: BriefReceipt): void {
  writeFileSync(path.join(dir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
}

/**
 * Prepare in a disposable clone, gate, compile, write the brief. The clone has its own
 * .git (refs, stash, config, hooks) and no remote, so nothing the preparer runs there can
 * reach the user's repository through git. Fail-open: any failure still writes a receipt
 * with the reason, so the caller can hand Claude the plain task (spec 018 FR-006).
 */
export function prepareBrief(options: PrepareOptions): { receipt: BriefReceipt; dir: string } {
  const id = `${new Date().toISOString().slice(0, 10)}-${createHash('sha256').update(randomUUID()).digest('hex').slice(0, 8)}`
  const dir = path.join(options.briefsDir, id)
  // The one step that cannot fail open: without a directory there is nowhere to put a receipt.
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const preparerName = typeof options.preparer === 'string' ? options.preparer : 'custom'
  const started = Date.now()
  let root = ''
  let baseCommit = ''
  let branch: string | undefined
  let userTreeDirty = false
  let before = ''
  const empty = { verified: 0, reported: 0, uncertain: 0, bounds: { included: 0, dropped: 0, bytesBefore: 0, bytesAfter: 0 } }
  const fail = (reason: string, exitCode: number | null = null, unchanged = true, gated?: GateResult): { receipt: BriefReceipt; dir: string } => {
    const receipt: BriefReceipt = {
      id, preparer: preparerName, baseCommit, userTreeUnchanged: unchanged, preparerExitCode: exitCode,
      seconds: Math.round((Date.now() - started) / 1000), findings: gated !== undefined, ...empty,
      ...(gated ? { verified: gated.verified.length, reported: gated.reported.length, uncertain: gated.uncertain.length } : {}),
      fallbackReason: reason,
    }
    writeReceipt(dir, receipt)
    return { receipt, dir }
  }
  try {
    root = git(options.cwd, ['rev-parse', '--show-toplevel'])
    baseCommit = git(root, ['rev-parse', 'HEAD'])
    branch = spawnSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim() || undefined
    userTreeDirty = git(root, ['status', '--porcelain=v1']) !== ''
    before = repoFingerprint(root)
  } catch (error) {
    return fail(`the repository could not be read: ${(error as Error).message}`)
  }

  let exitCode: number | null = null
  let output = ''
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'sabi-brief-'))
  try {
    const clone = path.join(scratch, 'repo')
    git(scratch, ['clone', '--quiet', '--no-checkout', root, clone])
    git(clone, ['checkout', '--quiet', '--detach', baseCommit])
    git(clone, ['remote', 'remove', 'origin'])
    const promptFile = path.join(scratch, 'prompt.md')
    writeFileSync(promptFile, preparerPrompt(options.task))
    const planned = typeof options.preparer === 'string'
      ? preparerCommand(options.preparer, promptFile, scratch, options.baseURL, options.alias)
      : { argv: options.preparer.argv.map((arg) => arg.replaceAll('{prompt_file}', promptFile)), env: options.preparer.env ?? {} }
    const bwrap = options.bwrapCommand ?? 'bwrap'
    if (options.sandbox !== 'none' && !sandboxAvailable(bwrap)) {
      return fail('no sandbox available: bubblewrap is missing or cannot create namespaces here; install or enable it, or pass --sandbox=none to run the preparer unsandboxed')
    }
    const command = options.sandbox === 'none'
      ? { argv: planned.argv, env: preparerEnv(planned.env) }
      : sandboxed(planned.argv, preparerEnv(planned.env), scratch, clone, { bwrap, hide: [root] })
    const run = spawnSync(command.argv[0], command.argv.slice(1), {
      cwd: clone, encoding: 'utf8', env: command.env,
      timeout: options.timeoutMs ?? 15 * 60_000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    })
    exitCode = run.status
    output = `${run.stdout ?? ''}`
    writeFileSync(path.join(dir, 'preparer-output.txt'), bounded(output, 256 * 1024))
    if (run.error && (run.error as NodeJS.ErrnoException).code !== 'ETIMEDOUT') return fail(`the preparer could not run: ${run.error.message}`, exitCode)
    if (run.signal || run.status !== 0) {
      return fail(run.signal ? `the preparer was stopped by ${run.signal}${run.error ? ' (timed out)' : ''}` : `the preparer exited with code ${run.status}`, exitCode)
    }
  } catch (error) {
    return fail(`preparation failed: ${(error as Error).message}`, exitCode)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  let unchanged = false
  try { unchanged = repoFingerprint(root) === before } catch { unchanged = false }
  if (!unchanged) return fail('the repository changed during preparation', exitCode, false)
  let findings: PreparerFindings | undefined
  try { findings = parseFindings(output) } catch { findings = undefined }
  if (!findings) return fail('the preparer returned no readable findings', exitCode)

  const gate = gateFindings(findings, root, { baseCommit, preparer: preparerName })
  // Nothing confirmed means nothing better than the plain task to hand over.
  if (gate.verified.length === 0) return fail('no finding could be verified against the files', exitCode, true, gate)
  const { markdown, bounds } = compileBrief({
    id, task: options.task, repo: root, branch, baseCommit, userTreeDirty, preparer: preparerName, findings, gate,
  })
  const briefPath = path.join(dir, 'brief.md')
  writeFileSync(briefPath, markdown)
  writeFileSync(path.join(dir, 'state.json'), `${JSON.stringify({
    brief: id,
    checks: [
      ...(findings.testCommand ? [{ id: 'verify', check: `${findings.testCommand} passes`, status: 'not_started' }] : []),
      { id: 'task', check: 'the change does what the task asks', status: 'not_started' },
    ],
  }, null, 2)}\n`)
  writeFileSync(path.join(dir, 'progress.md'), `# Progress on brief ${id}\n\nAppend short notes as you work: what you did, what you verified, what is next.\n`)
  const receipt: BriefReceipt = {
    id, preparer: preparerName, baseCommit, userTreeUnchanged: true, preparerExitCode: exitCode,
    seconds: Math.round((Date.now() - started) / 1000), findings: true,
    verified: gate.verified.length, reported: gate.reported.length, uncertain: gate.uncertain.length, bounds, briefPath,
  }
  writeReceipt(dir, receipt)
  return { receipt, dir }
}

/** The one-line prompt a fresh Claude Code session starts with. */
export function claudePointer(briefPath: string): string {
  return `Read the task brief at ${briefPath} and do the task it describes. It was prepared by a cheaper model and checked by Sabi; verify the facts your plan depends on before building on them.`
}
