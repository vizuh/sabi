const DEFAULT_BASE_URL = "http://127.0.0.1:8787/v1";
const DEFAULT_CONTEXT_WINDOW = 1_000_000;
const DEFAULT_MAX_TOKENS = 128_000;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"];

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

export function resolveBaseUrl(env = process.env) {
  const raw = env.SABI_OMP_BASE_URL || env.SABI_BASE_URL || DEFAULT_BASE_URL;
  let parsed;

  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Sabi OMP base URL is invalid: ${raw}`);
  }

  if (parsed.protocol !== "http:") {
    throw new Error("Sabi OMP base URL must use http://");
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error("Sabi OMP base URL must target the local Sabi server");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Sabi OMP base URL must not contain credentials, query parameters, or fragments");
  }

  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname !== "/v1") {
    throw new Error("Sabi OMP base URL must end in /v1");
  }

  return `${parsed.origin}${pathname}`;
}

export function createSabiProviderConfig(env = process.env) {
  return {
    baseUrl: resolveBaseUrl(env),
    apiKey: "sabi-local-placeholder",
    api: "openai-completions",
    authHeader: true,
    models: [
      {
        id: "sabi-code",
        name: "Sabi adaptive",
        api: "openai-completions",
        reasoning: true,
        thinking: { mode: "effort", efforts: EFFORTS },
        input: ["text", "image"],
        // OMP requires numeric catalog costs; Sabi owns upstream cost accounting.
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: positiveInteger(
          env.SABI_OMP_CONTEXT_WINDOW,
          DEFAULT_CONTEXT_WINDOW,
          "SABI_OMP_CONTEXT_WINDOW",
        ),
        maxTokens: positiveInteger(env.SABI_OMP_MAX_TOKENS, DEFAULT_MAX_TOKENS, "SABI_OMP_MAX_TOKENS"),
      },
    ],
  };
}

/**
 * Point a built-in OMP provider at Sabi so its rounds are routed. OMP keeps its own credential and
 * keeps sending it; Sabi forwards that credential to the provider it belongs to and rewrites only
 * the model. Nothing is copied into this extension, and no key is read from disk.
 *
 * `pi.registerProvider(name, { baseUrl })` is documented by OMP as an override for an existing
 * provider, and OMP resolves the credential through its own auth storage independently of the base
 * URL — which is what makes the borrow work.
 */
export function createBorrowedProviderOverride(env = process.env) {
  return { baseUrl: resolveBaseUrl(env) };
}

/** Providers named in `SABI_OMP_BORROW_PROVIDERS` (comma-separated) are routed through Sabi. */
export function borrowedProviderNames(env = process.env) {
  return String(env.SABI_OMP_BORROW_PROVIDERS ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

export default function sabiOhMyPiExtension(pi) {
  pi.registerProvider("sabi", createSabiProviderConfig());
  for (const provider of borrowedProviderNames()) {
    pi.registerProvider(provider, createBorrowedProviderOverride());
  }
}
