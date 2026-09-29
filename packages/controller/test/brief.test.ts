import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { compileBrief, gateFindings, installRoot, parseFindings, prepareBrief, preparerEnv, type BriefInput, type PreparerFindings } from '../src/brief.ts'

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sabi-brief-repo-'))
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), body)
  }
  for (const args of [['init', '-q'], ['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']]) {
    assert.equal(spawnSync('git', args, { cwd: dir }).status, 0)
  }
  return dir
}

const PRICING = 'const CODES = { SAVE10: 0.1 }\n\nexport function applyDiscount(amount, code) {\n  const rate = CODES[code] ?? 0\n  return Math.round(amount) * (1 - rate)\n}\n'

function findings(facts: PreparerFindings['facts'], extra: Partial<PreparerFindings> = {}): PreparerFindings {
  return { facts, relevantSurface: [], constraints: [], hypotheses: [], ruledOut: [], ...extra }
}

test('findings parse with markers, inside a code fence, and without the begin marker', () => {
  const body = '{"facts":[{"claim":"c","ref":{"kind":"command","command":"npm test","exitCode":1}}],"hypotheses":["h"],"testCommand":"npm test"}'
  assert.equal(parseFindings(`intro\nSABI_FINDINGS_BEGIN\n${body}\nSABI_FINDINGS_END\n`)?.testCommand, 'npm test')
  assert.equal(parseFindings(`SABI_FINDINGS_BEGIN\n\`\`\`json\n${body}\n\`\`\`\nSABI_FINDINGS_END`)?.facts.length, 1)
  // pi 0.84.2 dropped the begin marker in a live probe.
  assert.deepEqual(parseFindings(`notes {"not":"this"}\n${body}\nSABI_FINDINGS_END`)?.hypotheses, ['h'])
  assert.equal(parseFindings('no json here'), undefined)
})

test('a quoted file span is verified against the live file, and miscounted lines are corrected', () => {
  const root = repo({ 'src/pricing.js': PRICING })
  const gate = gateFindings(findings([
    { claim: 'rounds before discount', ref: { kind: 'file', path: 'src/pricing.js', lineStart: 4, lineEnd: 7, quote: '  const rate = CODES[code] ?? 0\n  return Math.round(amount) * (1 - rate)' } },
    { claim: 'wrong line number', ref: { kind: 'file', path: 'src/pricing.js', lineStart: 1, quote: 'export function applyDiscount(amount, code) {' } },
  ]), root)
  assert.equal(gate.verified.length, 2)
  assert.deepEqual([gate.verified[0].ref.lineStart, gate.verified[0].ref.lineEnd], [4, 5])
  assert.equal(gate.verified[1].ref.lineStart, 3)
})

test('the gate refuses what it cannot confirm, and never opens secrets or paths outside the repo', () => {
  const outside = mkdtempSync(path.join(os.tmpdir(), 'sabi-outside-'))
  writeFileSync(path.join(outside, 'secret.txt'), 'x\n')
  const root = repo({ 'src/pricing.js': PRICING, '.env': 'TOKEN=abc\n' })
  symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'))
  const gate = gateFindings(findings([
    { claim: 'invented quote', ref: { kind: 'file', path: 'src/pricing.js', lineStart: 1, quote: 'return amount' } },
    { claim: 'missing file', ref: { kind: 'file', path: 'src/nope.js', lineStart: 1, quote: 'x' } },
    { claim: 'escape', ref: { kind: 'file', path: '../etc/passwd', lineStart: 1, quote: 'root' } },
    { claim: 'secret', ref: { kind: 'file', path: '.env', lineStart: 1, quote: 'TOKEN=abc' } },
    { claim: 'symlink escape', ref: { kind: 'file', path: 'link.txt', lineStart: 1, quote: 'x' } },
    { claim: 'no ref' },
  ]), root)
  assert.equal(gate.verified.length, 0)
  assert.equal(gate.uncertain.length, 6)
})

test('command results are kept as reported, never as verified', () => {
  const gate = gateFindings(findings([{ claim: 'tests fail', ref: { kind: 'command', command: 'npm test', exitCode: 1, excerpt: '5 !== 4.98' } }]), repo({ 'a.txt': 'a\n' }))
  assert.equal(gate.verified.length, 0)
  assert.equal(gate.reported.length, 1)
  assert.equal(gate.reported[0].ref.exitCode, 1)
})

function input(gate: BriefInput['gate'], extra: Partial<PreparerFindings> = {}): BriefInput {
  return {
    id: '2026-09-29-abc', task: 'Make npm test pass', repo: '/repo', branch: 'main', baseCommit: 'c0ffee', userTreeDirty: false,
    preparer: 'hermes', findings: findings([], { testCommand: 'npm test', hypotheses: ['remove Math.round'], ...extra }), gate,
  }
}

test('the brief is deterministic, long material first and the request last', () => {
  const gate = { verified: [{ claim: 'c', ref: { kind: 'file' as const, path: 'a.js', lineStart: 1, lineEnd: 1 }, excerpt: 'x' }], reported: [], uncertain: [{ claim: 'u', reason: 'quote not found in a.js' }] }
  const a = compileBrief(input(gate)).markdown
  assert.equal(a, compileBrief(input(gate)).markdown)
  const order = ['<repo_state>', '<verified_facts>', '<reported_results>', '<uncertainties>', '<proposed_path>', '<task>', '<success_criteria>', '<first_action>']
  const positions = order.map((tag) => a.indexOf(`\n${tag}\n`))
  assert.ok(positions.every((p) => p > 0))
  assert.deepEqual([...positions].sort((x, y) => x - y), positions)
  assert.match(a, /They are not facts/)
  assert.match(a, /`npm test` passes/)
})

test('the brief keeps within 20 items and 8 KB, truncates one huge item, and reports what it dropped', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ claim: `fact ${i}`, ref: { kind: 'file' as const, path: 'a.js', lineStart: i + 1, lineEnd: i + 1 }, excerpt: 'y'.repeat(100) }))
  const { bounds } = compileBrief(input({ verified: many, reported: [], uncertain: [] }))
  // 20 fact items (the cap) plus the fixture's one hypothesis; the other 5 facts are dropped.
  assert.equal(bounds.included, 21)
  assert.equal(bounds.dropped, 5)
  assert.ok(bounds.bytesAfter <= 8 * 1024 && bounds.bytesBefore > bounds.bytesAfter)
  const huge = gateFindings(findings([{ claim: 'big', ref: { kind: 'command', command: 'x', exitCode: 0, excerpt: 'z'.repeat(5000) } }]), repo({ 'a.txt': 'a\n' }))
  assert.ok(Buffer.byteLength(huge.reported[0].excerpt) <= 1024)
  assert.match(huge.reported[0].excerpt, /\[truncated\]$/)
})

test('preparation runs in a disposable clone: edits there never reach the user tree', () => {
  const root = repo({ 'src/pricing.js': PRICING })
  const briefsDir = mkdtempSync(path.join(os.tmpdir(), 'sabi-briefs-'))
  const out = JSON.stringify({
    facts: [{ claim: 'rounds first', ref: { kind: 'file', path: 'src/pricing.js', lineStart: 5, quote: '  return Math.round(amount) * (1 - rate)' } }],
    hypotheses: ['drop the rounding'], testCommand: 'npm test', firstAction: 'edit src/pricing.js',
  })
  // A misbehaving preparer: it rewrites a tracked file before reporting.
  const script = `require('fs').writeFileSync('src/pricing.js','broken');console.log('SABI_FINDINGS_BEGIN\\n'+${JSON.stringify(out)}+'\\nSABI_FINDINGS_END')`
  const { receipt, dir } = prepareBrief({
    task: 'Make npm test pass', cwd: root, preparer: { argv: [process.execPath, '-e', script] },
    sandbox: 'none', baseURL: 'http://127.0.0.1:1/v1', alias: 'sabi-code', briefsDir,
  })
  assert.equal(readFileSync(path.join(root, 'src/pricing.js'), 'utf8'), PRICING)
  assert.equal(receipt.userTreeUnchanged, true)
  assert.equal(receipt.verified, 1)
  assert.ok(receipt.briefPath && readFileSync(receipt.briefPath, 'utf8').includes('src/pricing.js:5'))
  assert.deepEqual(readdirSync(dir).sort(), ['brief.md', 'preparer-output.txt', 'preparer-stderr.txt', 'progress.md', 'receipt.json', 'state.json'])
  const worktrees = spawnSync('git', ['worktree', 'list'], { cwd: root, encoding: 'utf8' }).stdout.trim().split('\n')
  assert.equal(worktrees.length, 1)
})

test('a preparer with no readable findings fails open with a reason', () => {
  const root = repo({ 'a.txt': 'a\n' })
  const { receipt } = prepareBrief({
    task: 't', cwd: root, preparer: { argv: [process.execPath, '-e', 'console.log("nothing useful")'] },
    sandbox: 'none', baseURL: 'http://127.0.0.1:1/v1', alias: 'sabi-code', briefsDir: mkdtempSync(path.join(os.tmpdir(), 'sabi-briefs-')),
  })
  assert.equal(receipt.briefPath, undefined)
  assert.equal(receipt.fallbackReason, 'the preparer returned no readable findings')
})

test('the parser handles a string ending in a backslash, and huge JSON-free output stays fast', () => {
  const body = JSON.stringify({ facts: [{ claim: 'continuation', ref: { kind: 'file', path: 'a.sh', lineStart: 1, quote: 'echo hi \\' } }], hypotheses: [] })
  assert.equal(parseFindings(`SABI_FINDINGS_BEGIN\n${body}\nSABI_FINDINGS_END`)?.facts[0].ref?.quote, 'echo hi \\')
  const started = Date.now()
  assert.equal(parseFindings('x}'.repeat(100_000)), undefined)
  assert.ok(Date.now() - started < 1000, 'unbalanced output must not be scanned quadratically')
})

test('preparer lists and strings are bounded', () => {
  const hypotheses = Array.from({ length: 100 }, (_, i) => `h${i} ${'w'.repeat(1000)}`)
  const parsed = parseFindings(`SABI_FINDINGS_BEGIN\n${JSON.stringify({ facts: [], hypotheses })}\nSABI_FINDINGS_END`)!
  assert.equal(parsed.hypotheses.length, 12)
  assert.ok(parsed.hypotheses.every((h) => h.length <= 400))
})

function prepareWith(root: string, script: string) {
  return prepareBrief({
    task: 'Make npm test pass', cwd: root, preparer: { argv: [process.execPath, '-e', script] },
    sandbox: 'none', baseURL: 'http://127.0.0.1:1/v1', alias: 'sabi-code', briefsDir: mkdtempSync(path.join(os.tmpdir(), 'sabi-briefs-')),
  })
}

const REPORT = `console.log('SABI_FINDINGS_BEGIN\\n'+JSON.stringify({facts:[{claim:'c',ref:{kind:'file',path:'src/pricing.js',lineStart:5,quote:'  return Math.round(amount) * (1 - rate)'}}]})+'\\nSABI_FINDINGS_END')`

test('git changes a preparer makes stay in its clone: refs, stash and config of the user repo are untouched', () => {
  const root = repo({ 'src/pricing.js': PRICING })
  const refs = spawnSync('git', ['show-ref'], { cwd: root, encoding: 'utf8' }).stdout
  const script = `const {execSync}=require('child_process');execSync('git branch evil && git -c user.name=x -c user.email=x@x tag -a v9 -m x && git config user.name evil');require('fs').writeFileSync('src/pricing.js','x');execSync('git stash');${REPORT}`
  const { receipt } = prepareWith(root, script)
  assert.equal(receipt.userTreeUnchanged, true)
  assert.equal(receipt.verified, 1)
  assert.equal(spawnSync('git', ['show-ref'], { cwd: root, encoding: 'utf8' }).stdout, refs)
  assert.equal(spawnSync('git', ['stash', 'list'], { cwd: root, encoding: 'utf8' }).stdout, '')
  assert.notEqual(spawnSync('git', ['config', '--local', 'user.name'], { cwd: root, encoding: 'utf8' }).stdout.trim(), 'evil')
})

test('a write through an absolute path, even to an already-dirty file, fails the brief', () => {
  const root = repo({ 'src/pricing.js': PRICING })
  writeFileSync(path.join(root, 'src/pricing.js'), `${PRICING}// user edit\n`)
  const script = `require('fs').appendFileSync(${JSON.stringify(path.join(root, 'src/pricing.js'))},'// preparer edit\\n');${REPORT}`
  const { receipt } = prepareWith(root, script)
  assert.equal(receipt.userTreeUnchanged, false)
  assert.equal(receipt.briefPath, undefined)
  assert.equal(receipt.fallbackReason, 'the repository changed during preparation')
})

test('a preparer that cannot start fails open with a receipt', () => {
  const root = repo({ 'a.txt': 'a\n' })
  const { receipt, dir } = prepareBrief({
    task: 't', cwd: root, preparer: { argv: ['sabi-no-such-preparer-binary'] },
    sandbox: 'none', baseURL: 'http://127.0.0.1:1/v1', alias: 'sabi-code', briefsDir: mkdtempSync(path.join(os.tmpdir(), 'sabi-briefs-')),
  })
  assert.match(receipt.fallbackReason ?? '', /could not run/)
  assert.ok(readdirSync(dir).includes('receipt.json'))
})

test('findings followed by more text containing braces still parse', () => {
  const body = JSON.stringify({ facts: [], hypotheses: ['h'] })
  assert.deepEqual(parseFindings(`${body}\ntrailing log {ok} and a template {{x}}`)?.hypotheses, ['h'])
})

test('a directory that is not a git repository, or has no commits, fails open with a receipt', () => {
  const plain = mkdtempSync(path.join(os.tmpdir(), 'sabi-not-git-'))
  const empty = mkdtempSync(path.join(os.tmpdir(), 'sabi-no-commits-'))
  spawnSync('git', ['init', '-q'], { cwd: empty })
  for (const cwd of [plain, empty]) {
    const { receipt, dir } = prepareBrief({
      task: 't', cwd, preparer: { argv: [process.execPath, '-e', ''] },
      sandbox: 'none', baseURL: 'http://127.0.0.1:1/v1', alias: 'sabi-code', briefsDir: mkdtempSync(path.join(os.tmpdir(), 'sabi-briefs-')),
    })
    assert.match(receipt.fallbackReason ?? '', /could not be read/)
    assert.ok(readdirSync(dir).includes('receipt.json'))
  }
})

test('the byte budget covers every section, not only the fact items', () => {
  const long = (n: number) => Array.from({ length: 12 }, (_, i) => `${n}-${i} ${'q'.repeat(380)}`)
  const gate = { verified: [{ claim: 'c', ref: { kind: 'file' as const, path: 'a.js', lineStart: 1, lineEnd: 1 }, excerpt: 'x' }], reported: [], uncertain: [] }
  const { markdown, bounds } = compileBrief(input(gate, { hypotheses: long(1), ruledOut: long(2), relevantSurface: long(3) }))
  assert.ok(bounds.bytesAfter <= 8 * 1024)
  assert.ok(bounds.dropped > 0)
  assert.ok(Buffer.byteLength(markdown) < 12 * 1024, `brief is ${Buffer.byteLength(markdown)} bytes`)
})

test('a preparer that exits non-zero, or verifies nothing, gets no brief', () => {
  const root = repo({ 'src/pricing.js': PRICING })
  const failed = prepareWith(root, `${REPORT};process.exit(1)`)
  assert.equal(failed.receipt.briefPath, undefined)
  assert.equal(failed.receipt.fallbackReason, 'the preparer exited with code 1')
  const unverified = prepareWith(root, `console.log('SABI_FINDINGS_BEGIN\\n'+JSON.stringify({facts:[{claim:'guess',ref:{kind:'file',path:'src/pricing.js',lineStart:1,quote:'not in the file'}}],hypotheses:['h']})+'\\nSABI_FINDINGS_END')`)
  assert.equal(unverified.receipt.briefPath, undefined)
  assert.equal(unverified.receipt.fallbackReason, 'no finding could be verified against the files')
  assert.equal(unverified.receipt.findings, true)
  assert.equal(unverified.receipt.uncertain, 1)
})

test('preparers get an allowlisted environment: no provider keys or tokens', () => {
  const env = preparerEnv({ HERMES_HOME: '/x' }, { PATH: '/bin', HOME: '/h', LC_ALL: 'C', OPENROUTER_API_KEY: 'k', GITHUB_TOKEN: 't', AWS_SECRET_ACCESS_KEY: 's' })
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h', LC_ALL: 'C', HERMES_HOME: '/x' })
})

test('pretty-printed findings parse as a whole, not as their last indented fact', () => {
  const pretty = JSON.stringify({
    facts: [
      { claim: 'a', ref: { kind: 'file', path: 'a.js', lineStart: 1, quote: 'x' } },
      { claim: 'b', ref: { kind: 'command', command: 'npm test', exitCode: 1, excerpt: 'x' } },
    ],
    constraints: [{ rule: 'r', source: 'AGENTS.md' }],
    hypotheses: ['h'],
  }, null, 2)
  const parsed = parseFindings(`SABI_FINDINGS_BEGIN\n${pretty}\nSABI_FINDINGS_END`)
  assert.equal(parsed?.facts.length, 2)
  assert.deepEqual(parsed?.hypotheses, ['h'])
  // Same without the begin marker, as pi emits it.
  assert.equal(parseFindings(`prose\n${pretty}\nSABI_FINDINGS_END`)?.facts.length, 2)
})

test('without bubblewrap the preparer does not run unless unsandboxed is chosen explicitly', () => {
  const root = repo({ 'src/pricing.js': PRICING })
  const { receipt } = prepareBrief({
    task: 't', cwd: root, preparer: { argv: [process.execPath, '-e', REPORT] }, bwrapCommand: 'sabi-no-such-bwrap',
    baseURL: 'http://127.0.0.1:1/v1', alias: 'sabi-code', briefsDir: mkdtempSync(path.join(os.tmpdir(), 'sabi-briefs-')),
  })
  assert.match(receipt.fallbackReason ?? '', /no sandbox available/)
})

const bwrapWorks = spawnSync('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', 'true']).status === 0

test('inside the sandbox an absolute-path write to the user repo fails, and the brief still builds', { skip: !bwrapWorks && 'bubblewrap unavailable here' }, () => {
  const root = repo({ 'src/pricing.js': PRICING })
  const target = path.join(root, 'src/pricing.js')
  const script = `try{require('fs').appendFileSync(${JSON.stringify(target)},'// escaped\\n')}catch(e){};try{require('fs').writeFileSync(require('os').homedir()+'/probe.txt','x')}catch(e){console.error('home',e.code)};${REPORT}`
  const { receipt } = prepareBrief({
    task: 't', cwd: root, preparer: { argv: [process.execPath, '-e', script] },
    baseURL: 'http://127.0.0.1:18765/v1', alias: 'sabi-code', briefsDir: mkdtempSync(path.join(os.tmpdir(), 'sabi-briefs-')),
  })
  assert.equal(readFileSync(target, 'utf8'), PRICING)
  assert.equal(receipt.userTreeUnchanged, true)
  assert.equal(receipt.verified, 1)
})

test('the sandbox blocks the known escapes: user bus, systemd-run, the original repo, credential dirs', { skip: !bwrapWorks && 'bubblewrap unavailable here' }, () => {
  const root = repo({ 'src/pricing.js': PRICING, '.env': 'TOKEN=abc\n' })
  const outside = mkdtempSync(path.join(os.tmpdir(), 'sabi-outside-'))
  const escaped = path.join(outside, 'escaped.txt')
  const uid = process.getuid?.() ?? 1000
  const realConfig = path.join(os.homedir(), '.config')
  const script = `
    const fs = require('fs'), cp = require('child_process')
    const r = {}
    r.userBus = fs.existsSync('/run/user/${uid}/bus')
    r.run = fs.existsSync('/run')
    r.cache = fs.existsSync(${JSON.stringify(path.join(os.homedir(), '.cache'))})
    try { cp.execFileSync('systemd-run', ['--user', '--wait', '/usr/bin/touch', ${JSON.stringify(escaped)}], { stdio: 'ignore', timeout: 5000 }); r.systemdRun = 'ran' } catch { r.systemdRun = 'failed' }
    try { fs.readFileSync(${JSON.stringify(path.join(root, '.env'))}); r.repoEnv = 'read' } catch { r.repoEnv = 'blocked' }
    try { r.configEntries = fs.readdirSync(${JSON.stringify(realConfig)}).length } catch { r.configEntries = 0 }
    console.log('PROBE ' + JSON.stringify(r))
    ${REPORT}`
  const { receipt, dir } = prepareBrief({
    task: 't', cwd: root, preparer: { argv: [process.execPath, '-e', script] },
    baseURL: 'http://127.0.0.1:18765/v1', alias: 'sabi-code', briefsDir: mkdtempSync(path.join(os.tmpdir(), 'sabi-briefs-')),
  })
  const probe = JSON.parse(/PROBE (.*)/.exec(readFileSync(path.join(dir, 'preparer-output.txt'), 'utf8'))![1])
  assert.equal(probe.userBus, false)
  assert.equal(probe.run, false, '/run must not exist inside the sandbox')
  assert.equal(probe.cache, false, 'only install roots of HOME are mounted')
  assert.equal(probe.repoEnv, 'blocked')
  assert.equal(probe.configEntries, 0)
  assert.equal(existsSync(escaped), false, `systemd-run ${probe.systemdRun}`)
  assert.equal(receipt.verified, 1)
})

test('the sandbox reaches Sabi and nothing else on the host network', { skip: !bwrapWorks && 'bubblewrap unavailable here' }, async () => {
  const { createServer } = await import('node:http')
  const listen = (body: string) => new Promise<{ port: number; close: () => void }>((resolve) => {
    const server = createServer((_req, res) => res.end(body))
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as { port: number }).port, close: () => server.close() }))
  })
  const sabi = await listen('sabi-ok')
  const daemon = await listen('daemon-reached')
  const root = repo({ 'src/pricing.js': PRICING })
  const script = `
    const get = (port) => new Promise((ok) => require('http').get('http://127.0.0.1:' + port + '/', (r) => { let b=''; r.on('data', (c) => b += c); r.on('end', () => ok(b)) }).on('error', (e) => ok('error ' + e.code)))
    Promise.all([get(${sabi.port}), get(${daemon.port})]).then(([s, d]) => { console.log('PROBE ' + JSON.stringify({ sabi: s, daemon: d })); ${REPORT} })`
  // prepareBrief blocks the event loop while the preparer runs, so serve from a child process.
  sabi.close(); daemon.close()
  const { spawn } = await import('node:child_process')
  const servers = spawn(process.execPath, ['-e', `const h=require('http');h.createServer((q,r)=>r.end('sabi-ok')).listen(${sabi.port},'127.0.0.1');h.createServer((q,r)=>r.end('daemon-reached')).listen(${daemon.port},'127.0.0.1');setTimeout(()=>{},60000)`], { stdio: 'ignore' })
  await new Promise((resolve) => setTimeout(resolve, 300))
  try {
    const { receipt, dir } = prepareBrief({
      task: 't', cwd: root, preparer: { argv: [process.execPath, '-e', script] },
      baseURL: `http://127.0.0.1:${sabi.port}/v1`, alias: 'sabi-code', briefsDir: mkdtempSync(path.join(os.tmpdir(), 'sabi-briefs-')),
    })
    const probe = JSON.parse(/PROBE (.*)/.exec(readFileSync(path.join(dir, 'preparer-output.txt'), 'utf8'))![1])
    assert.equal(probe.sabi, 'sabi-ok')
    assert.match(probe.daemon, /^error/)
    assert.equal(receipt.verified, 1)
  } finally {
    servers.kill()
  }
})

test('the sandbox refuses a non-local Sabi URL, since the network is isolated', () => {
  const { receipt } = prepareBrief({
    task: 't', cwd: repo({ 'a.txt': 'a\n' }), preparer: { argv: [process.execPath, '-e', ''] },
    baseURL: 'https://sabi.example.com/v1', alias: 'sabi-code', briefsDir: mkdtempSync(path.join(os.tmpdir(), 'sabi-briefs-')),
  })
  assert.match(receipt.fallbackReason ?? '', /loopback URL|no sandbox available/)
})

test('from a linked worktree, the main checkout is hidden too', { skip: !bwrapWorks && 'bubblewrap unavailable here' }, () => {
  const main = repo({ 'src/pricing.js': PRICING })
  writeFileSync(path.join(main, '.env'), 'TOKEN=abc\n')
  const linked = path.join(mkdtempSync(path.join(os.tmpdir(), 'sabi-linked-')), 'wt')
  assert.equal(spawnSync('git', ['worktree', 'add', '-q', linked], { cwd: main }).status, 0)
  const script = `let r='blocked';try{require('fs').readFileSync(${JSON.stringify(path.join(main, '.env'))});r='read'}catch{};console.log('PROBE '+r);${REPORT}`
  const { dir } = prepareBrief({
    task: 't', cwd: linked, preparer: { argv: [process.execPath, '-e', script] },
    baseURL: 'http://127.0.0.1:18765/v1', alias: 'sabi-code', briefsDir: mkdtempSync(path.join(os.tmpdir(), 'sabi-briefs-')),
  })
  assert.match(readFileSync(path.join(dir, 'preparer-output.txt'), 'utf8'), /PROBE blocked/)
})

test('install roots mount only the tool, not the whole home', () => {
  const home = '/home/u'
  assert.equal(installRoot('/home/u/.nvm/versions/node/v24/bin/node', home), '/home/u/.nvm')
  assert.equal(installRoot('/home/u/.bun/install/global/x/cli.js', home), '/home/u/.bun')
  assert.equal(installRoot('/home/u/.local/bin/hermes', home), '/home/u/.local/bin')
  assert.equal(installRoot('/home/u/.local/share/prime-agent/releases/x/prime-agent', home), '/home/u/.local/share/prime-agent')
  assert.equal(installRoot('/usr/bin/git', home), undefined)
})
