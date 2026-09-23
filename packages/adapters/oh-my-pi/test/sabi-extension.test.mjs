import assert from "node:assert/strict";
import test from "node:test";
import sabiOhMyPiExtension, {
  borrowedProviderNames,
  createSabiProviderConfig,
  resolveBaseUrl,
} from "../src/sabi-extension.mjs";

test("registers the stable Sabi provider and adaptive model", () => {
  const registrations = [];
  sabiOhMyPiExtension({
    registerProvider(name, config) {
      registrations.push({ name, config });
    },
  });

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].name, "sabi");
  assert.equal(registrations[0].config.baseUrl, "http://127.0.0.1:8787/v1");
  assert.equal(registrations[0].config.api, "openai-completions");
  assert.equal(registrations[0].config.authHeader, true);
  assert.deepEqual(registrations[0].config.models[0], {
    id: "sabi-code",
    name: "Sabi adaptive",
    api: "openai-completions",
    reasoning: true,
    thinking: { mode: "effort", efforts: ["minimal", "low", "medium", "high", "xhigh", "max"] },
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  });
});

test("accepts a loopback endpoint and metadata overrides", () => {
  const env = {
    SABI_OMP_BASE_URL: "http://localhost:9887/v1/",
    SABI_OMP_CONTEXT_WINDOW: "65536",
    SABI_OMP_MAX_TOKENS: "8192",
  };

  assert.equal(resolveBaseUrl(env), "http://localhost:9887/v1");
  const config = createSabiProviderConfig(env);
  assert.equal(config.models[0].contextWindow, 65_536);
  assert.equal(config.models[0].maxTokens, 8_192);
});

test("uses the shared Sabi base URL only when the OMP override is absent", () => {
  assert.equal(
    resolveBaseUrl({ SABI_BASE_URL: "http://127.0.0.1:7777/v1", SABI_OMP_BASE_URL: "" }),
    "http://127.0.0.1:7777/v1",
  );
  assert.equal(
    resolveBaseUrl({ SABI_BASE_URL: "http://127.0.0.1:7777/v1", SABI_OMP_BASE_URL: "http://localhost:8888/v1" }),
    "http://localhost:8888/v1",
  );
});

test("rejects unsafe endpoints and invalid metadata", () => {
  for (const value of [
    "https://127.0.0.1:8787/v1",
    "http://192.0.2.10:8787/v1",
    "http://127.0.0.1:8787/v2",
    "http://user:pass@127.0.0.1:8787/v1",
    "http://127.0.0.1:8787/v1?token=secret",
  ]) {
    assert.throws(() => resolveBaseUrl({ SABI_OMP_BASE_URL: value }), /Sabi OMP base URL/);
  }

  assert.throws(
    () => createSabiProviderConfig({ SABI_OMP_CONTEXT_WINDOW: "0" }),
    /SABI_OMP_CONTEXT_WINDOW must be a positive safe integer/,
  );
  assert.throws(
    () => createSabiProviderConfig({ SABI_OMP_MAX_TOKENS: "not-a-number" }),
    /SABI_OMP_MAX_TOKENS must be a positive safe integer/,
  );
});

test("borrowed providers are pointed at Sabi without copying a credential", () => {
  const registered = [];
  const pi = { registerProvider: (name, config) => registered.push({ name, config }) };

  sabiOhMyPiExtension(pi);
  assert.deepEqual(registered.map((entry) => entry.name), ["sabi"], "the Sabi provider is unchanged by default");

  registered.length = 0;
  process.env.SABI_OMP_BORROW_PROVIDERS = " anthropic , opencode-go ,";
  try {
    sabiOhMyPiExtension(pi);
  } finally {
    delete process.env.SABI_OMP_BORROW_PROVIDERS;
  }

  // A built-in provider override carries a base URL and nothing else: OMP keeps its own credential
  // and keeps sending it, and Sabi forwards it. Any key here would be a second credential.
  assert.deepEqual(registered.map((entry) => entry.name), ["sabi", "anthropic", "opencode-go"]);
  for (const entry of registered.slice(1)) {
    assert.deepEqual(entry.config, { baseUrl: "http://127.0.0.1:8787/v1" });
    assert.equal("apiKey" in entry.config, false);
  }
  assert.deepEqual(borrowedProviderNames({ SABI_OMP_BORROW_PROVIDERS: "" }), []);
});
