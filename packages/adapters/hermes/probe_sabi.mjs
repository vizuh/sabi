// Synthetic fixture only. Run by probe_client.py inside its isolated network namespace.
import { writeFile } from 'node:fs/promises';
import { createSabiServer } from '@sabi/server';
import { validateConfig } from '@sabi/core';

const [portText, reportFile] = process.argv.slice(2);
const port = Number(portText);
if (!Number.isInteger(port) || port < 1 || port > 65535 || !reportFile) {
  throw new Error('Expected mock port and probe-owned report path');
}
const fixtureModel = (model) => ({
  upstream: 'synthetic', model, contextWindow: 65536, maxOutputTokens: 1024,
  contextAccounting: { textTokensPerByte: 1, requestOverheadTokens: 100, perMessageOverheadTokens: 20 },
  capabilities: {
    tools: true, parallelTools: true, strictTools: true,
    inputModalities: ['text'], outputModalities: ['text'],
    reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high'],
    supportedParameters: ['temperature', 'top_p', 'max_tokens', 'max_completion_tokens', 'stop',
      'tools', 'tool_choice', 'parallel_tool_calls', 'stream_options', 'reasoning_effort', 'reasoning', 'store'],
  },
});
const config = validateConfig({
  compatibility: { mode: 'strict' },
  upstreams: { synthetic: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: false, streamUsage: true } },
  models: { cheap: fixtureModel('mock-cheap'), mid: fixtureModel('mock-mid'), strong: fixtureModel('mock-strong') },
  aliases: { 'sabi-code': 'auto' },
  policy: { failure: 'strong', stuck: 'mid', 'context-pressure': 'mid', transport: 'mid',
    'first-turn': 'mid', verification: 'mid', implementation: 'mid', exploration: 'cheap', unclassified: 'cheap' },
  judge: { enabled: false }, telemetry: { allowlistOnly: true, captureSnippets: false },
});
const inputs = [];
const metadataPaths = [];
const proxy = createSabiServer({ config, logFile: reportFile + '.decisions.jsonl', verbose: false, requestTimeoutMs: 5000 });
proxy.server.on('request', (request) => {
  if (request.method === 'GET') metadataPaths.push(request.url);
  if (request.method === 'POST' && request.url === '/v1/chat/completions') {
    // Read only these opaque fields. Never capture authorization, prompts or tool data.
    inputs.push({ headers: Object.fromEntries(['X-Sabi-Client', 'X-Sabi-Session', 'X-Sabi-Turn']
      .map((name) => [name, request.headers[name.toLowerCase()]])) });
  }
});
console.log(JSON.stringify({ port: await proxy.listen(0, '127.0.0.1') }));
process.stdin.resume();
await new Promise((resolve) => process.stdin.once('end', resolve));
proxy.server.closeAllConnections();
await proxy.close();
const decisions = proxy.recent.map((row) => ({
  alias: row.alias, client: row.client, sessionKnown: row.sessionKnown, sessionId: row.sessionId,
  turnId: row.turnId, requestId: row.requestId, upstreamModel: row.upstreamModel,
  servedModel: row.servedModel, outcome: row.outcome, usage: row.usage,
}));
await writeFile(reportFile, JSON.stringify({ nodeVersion: process.version, strict: true, judgeEnabled: false, inputs, metadataPaths, decisions }, null, 2) + '\n');
