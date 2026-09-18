// Minimal ambient types for the mod surface Sabi uses, transcribed from the bundled mod
// reference (bundled/mod-builder/reference). `@commandcode/harness` is not published to npm,
// so this shim keeps `npm run typecheck` honest about the contract we actually depend on.
// Remove it if that package ever becomes resolvable and the real types take over.

declare module '@commandcode/harness' {
  export interface AgentState {
    readonly modState?: Readonly<Record<string, unknown>>
    readonly messages?: readonly unknown[]
    readonly [key: string]: unknown
  }

  export interface Disposable {
    dispose(): void
  }

  export interface TurnUsage {
    readonly inputTokens?: number
    readonly outputTokens?: number
    readonly cachedInputTokens?: number
    readonly [key: string]: unknown
  }

  export interface ModSessionApi {
    appendCustomEntry(entry: { customType: string; data?: unknown }): void
    getCustomEntries(input: { customType: string }): readonly unknown[]
  }

  export interface ModContext {
    readonly cwd: string
    readonly signal?: AbortSignal
    readonly session?: ModSessionApi
  }

  export interface ModHooks {
    onTurnStart?(
      input: { state: AgentState; turnNumber: number },
      ctx?: ModContext,
    ): AgentState | Promise<AgentState>
    onTurnEnd?(
      input: { state: AgentState; turnNumber: number; hadToolCalls?: boolean; usage?: TurnUsage },
      ctx?: ModContext,
    ): AgentState | Promise<AgentState>
    afterToolCall?(
      input: {
        toolCallId: string
        toolName: string
        input: Record<string, unknown>
        result?: unknown
        isError?: boolean
        state: AgentState
      },
      ctx?: ModContext,
    ): AfterToolCallResult | undefined | Promise<AfterToolCallResult | undefined>
    prepareNextTurn?(
      input: { state: AgentState; turnNumber: number },
      ctx?: ModContext,
    ): NextTurn | undefined | Promise<NextTurn | undefined>
  }

  export interface AfterToolCallResult {
    content?: unknown
    terminate?: boolean
    additionalContext?: string
    isError?: boolean
    modState?: Record<string, unknown>
  }

  export interface NextTurn {
    model?: string
    effort?: string
  }

  export interface ModUi {
    notify(message: string): void
  }

  export interface ModApi {
    readonly name: string
    readonly ui: ModUi
    hooks(hooks: ModHooks): Disposable
    on<T = AgentEventLike>(event: string, handler: (event: T) => void): Disposable
  }

  export interface AgentEventLike {
    readonly type: string
  }

  export interface ModelRequestEvent extends AgentEventLike {
    readonly model?: string
    readonly usage?: TurnUsage
  }
}
