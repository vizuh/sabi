import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyRound, extractTrajectoryState } from '../src/state.ts'

test('OpenCode/Kilo built-in tool names classify without rewriting wire data', () => {
  for (const name of ['read', 'glob', 'grep', 'webfetch', 'websearch']) assert.equal(classifyRound([{ name }]), 'exploration')
  for (const name of ['edit', 'write', 'apply_patch']) assert.equal(classifyRound([{ name }]), 'implementation')
  assert.equal(classifyRound([{ name: 'bash', args: '{"command":"npm test"}' }]), 'verification')
  assert.equal(classifyRound([{ name: 'bash', args: '{"command":"git status"}' }]), 'exploration')
  const body = { messages: [{ role: 'assistant', tool_calls: [{ id: 'original-id', function: { name: 'read', arguments: '{"filePath":"fixture.txt"}' } }] }, { role: 'tool', tool_call_id: 'original-id', content: 'fixture' }] }
  const before = structuredClone(body)
  assert.equal(extractTrajectoryState(body).roundKind, 'exploration')
  assert.deepEqual(body, before)
})
test('unknown/MCP/mixed actions remain unclassified rather than proven read-only', () => {
  for (const name of ['mcp__server__read', 'mcp.read', 'ipython', 'unknown_action']) {
    assert.equal(classifyRound([{ name }]), 'unclassified')
    assert.equal(classifyRound([{ name: 'read' }, { name }]), 'unclassified')
  }
  assert.equal(classifyRound([{ name: 'read' }, { name: 'edit' }]), 'implementation')
})
