import { defaultConfigPath, loadConfig, JUDGE_QUESTIONS, type JudgeQuestions } from '@sabi/core'
import { createTypesafeClient } from '../../server/src/typesafe.ts'
import type { ControllerAction, JevDecisionTelemetry } from './types.ts'

export interface JevChoiceInput {
  cwd: string
  request: string
  validActions: ControllerAction[]
  state: Record<string, unknown>
  fallback: ControllerAction
}

export interface JevChoiceResult {
  action: ControllerAction
  telemetry: JevDecisionTelemetry
}

const ACTION_DESCRIPTIONS: Record<ControllerAction, string> = {
  CONTINUE: 'send the request to the current healthy session',
  DELEGATE: 'send the request to an already-running suitable session',
  SPAWN: 'start a suitable available harness and send the request there',
  ORCHESTRATE: 'create a supervised Orca orchestration for a decomposable multi-part task',
  ASK: 'ask the user because no safe executable route remains',
}

function questionsFor(validActions: ControllerAction[]): JudgeQuestions {
  return {
    ...JUDGE_QUESTIONS,
    difficulty: {
      ...JUDGE_QUESTIONS.difficulty,
      instructions: 'Which one of the valid controller actions is the smallest sufficient route for this request and inventory? Choose only one listed action.',
      criteria: Object.fromEntries(validActions.map((action) => [action, ACTION_DESCRIPTIONS[action]])),
    },
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function text(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.slice(0, limit) : undefined
}

/** Keep controller judgment state below the configured core judge limit without sending diffs or catalogs. */
export function boundJevState(state: Record<string, unknown>, maxStateChars = 6000): Record<string, unknown> {
  const limit = Math.max(1, Math.floor(maxStateChars))
  const serialized = JSON.stringify(state)
  if (serialized.length <= limit) return state

  const inventory = objectValue(state.inventory)
  const handoff = objectValue(state.handoff)
  const bounded: Record<string, unknown> = {
    ...(text(state.request, 2000) ? { request: text(state.request, 2000) } : {}),
    ...(Array.isArray(state.validActions) ? { validActions: state.validActions } : {}),
    inventory: inventory ? {
      active: inventory.active,
      existingSessions: Array.isArray(inventory.existingSessions) ? inventory.existingSessions.slice(0, 8) : [],
      spawnCandidates: Array.isArray(inventory.spawnCandidates) ? inventory.spawnCandidates.slice(0, 8) : [],
    } : {},
    handoff: handoff ? {
      ...(text(handoff.objective, 800) ? { objective: text(handoff.objective, 800) } : {}),
      repo: handoff.repo,
      branch: handoff.branch,
      changedFileCount: handoff.changedFileCount,
      unresolvedWorkCount: handoff.unresolvedWorkCount,
      ...(text(handoff.nextAction, 800) ? { nextAction: text(handoff.nextAction, 800) } : {}),
    } : {},
  }
  if (JSON.stringify(bounded).length <= limit) return bounded

  const compact: Record<string, unknown> = {
    ...(text(state.request, 800) ? { request: text(state.request, 800) } : {}),
    ...(Array.isArray(state.validActions) ? { validActions: state.validActions } : {}),
    inventory: {
      active: objectValue(inventory?.active)?.id,
      existingSessionIds: Array.isArray(inventory?.existingSessions)
        ? inventory.existingSessions.map((candidate) => objectValue(candidate)?.id).filter(Boolean).slice(0, 8)
        : [],
      spawnCandidateIds: Array.isArray(inventory?.spawnCandidates)
        ? inventory.spawnCandidates.map((candidate) => objectValue(candidate)?.id).filter(Boolean).slice(0, 8)
        : [],
    },
  }
  return JSON.stringify(compact).length <= limit ? compact : { validActions: state.validActions }
}

export async function chooseActionWithJev(input: JevChoiceInput): Promise<JevChoiceResult> {
  const validActions = [...new Set(input.validActions)]
  const baseTelemetry: JevDecisionTelemetry = {
    status: 'not-consulted',
    validActions,
  }
  if (validActions.length < 2) return { action: input.fallback, telemetry: baseTelemetry }

  let config
  try {
    config = loadConfig(defaultConfigPath({ cwd: input.cwd }))
  } catch (error) {
    return {
      action: input.fallback,
      telemetry: { ...baseTelemetry, status: 'skipped', error: `config unavailable: ${(error as Error).message}` },
    }
  }
  const judge = config.judge
  if (!judge?.enabled) {
    return {
      action: input.fallback,
      telemetry: { ...baseTelemetry, status: 'skipped', error: 'Jev is disabled in the selected Sabi config' },
    }
  }

  try {
    const result = await createTypesafeClient().ask(boundJevState(input.state, judge.maxStateChars), questionsFor(validActions), judge)
    const selected = result.outcome.difficulty as ControllerAction | undefined
    if (!selected || !validActions.includes(selected)) {
      return {
        action: input.fallback,
        telemetry: {
          ...baseTelemetry,
          status: 'error',
          model: result.outcome.model,
          cached: result.cached,
          latencyMs: result.latencyMs,
          error: 'Jev returned an action outside the closed valid-action set',
        },
      }
    }
    return {
      action: selected,
      telemetry: {
        ...baseTelemetry,
        status: 'ok',
        selectedAction: selected,
        model: result.outcome.model,
        cached: result.cached,
        latencyMs: result.latencyMs,
      },
    }
  } catch (error) {
    return {
      action: input.fallback,
      telemetry: { ...baseTelemetry, status: 'error', error: (error as Error).message },
    }
  }
}
