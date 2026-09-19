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
    const result = await createTypesafeClient().ask(input.state, questionsFor(validActions), judge)
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
