import type {
  AgentDescriptor,
  AgentHarness,
  AgentRoutePlan,
  AgentRoutingInput,
  AgentSession,
} from './types.ts'

const REPEATED_FAILURE_STREAK = 2

interface Eligibility {
  eligible: boolean
  rule?: string
  reason?: string
  estimatedWaitMs?: number
  reconsiderAt?: number
}

function hasRequiredCapabilities(agent: AgentDescriptor, required: string[]): boolean {
  return required.every((capability) => agent.capabilities.includes(capability))
}

function waitUntilReset(agent: AgentDescriptor, now: number): number | undefined {
  return agent.capacity.resetAt === undefined ? undefined : Math.max(0, agent.capacity.resetAt - now)
}

function sessionBlocker(session: AgentSession, required: string[]): { rule: string; reason: string } | undefined {
  if (!session.available) return { rule: 'unavailable', reason: 'agent is not accepting work' }
  if (session.lifecycle === 'dead') return { rule: 'process-dead', reason: 'agent process is dead' }
  if (session.authenticated === false) return { rule: 'authentication-unavailable', reason: 'agent authentication is unavailable' }
  if (session.lifecycle === 'blocked' || session.lifecycle === 'waiting') {
    return { rule: session.lifecycle, reason: `agent is explicitly ${session.lifecycle}` }
  }
  if ((session.failureStreak ?? 0) >= REPEATED_FAILURE_STREAK) {
    return { rule: 'repeated-failure', reason: `agent has ${session.failureStreak} identical failures` }
  }
  if (!hasRequiredCapabilities(session, required)) {
    return { rule: 'required-capability-unavailable', reason: 'agent cannot satisfy the required capabilities' }
  }
  return undefined
}

function eligibility(
  agent: AgentSession | AgentHarness,
  input: AgentRoutingInput,
  forContinuation: boolean,
): Eligibility {
  if (agent.kind === 'session') {
    const blocker = sessionBlocker(agent, input.requiredCapabilities)
    if (blocker) return { eligible: false, ...blocker }
  } else {
    if (!agent.available) return { eligible: false, rule: 'unavailable', reason: 'harness is not accepting work' }
    if (!hasRequiredCapabilities(agent, input.requiredCapabilities)) {
      return { eligible: false, rule: 'required-capability-unavailable', reason: 'harness cannot satisfy the required capabilities' }
    }
  }

  const status = agent.capacity.status
  const waitMs = waitUntilReset(agent, input.now)
  if (status === 'available' || status === 'degraded' || waitMs === 0) return { eligible: true }

  // A low-priority provider/model is a valid last-resort replacement, but never wins over
  // healthy capacity. The active session still leaves CONTINUE when its normal quota is gone.
  if (!forContinuation && agent.capacity.fallbackMode && (status === 'rate_limited' || status === 'quota_exhausted')) {
    return { eligible: true, rule: 'fallback-capacity', reason: `${agent.capacity.fallbackMode} fallback remains available` }
  }

  if (status === 'quota_exhausted') {
    if (waitMs !== undefined && forContinuation && waitMs <= input.costs.handoffMs + input.costs.replacementExecutionMs) {
      return { eligible: true, estimatedWaitMs: waitMs, reconsiderAt: agent.capacity.resetAt }
    }
    return {
      eligible: false,
      rule: 'quota-exhausted',
      reason: waitMs === undefined ? 'quota is exhausted with no reset time' : `quota resets in ${waitMs}ms`,
      estimatedWaitMs: waitMs,
      reconsiderAt: agent.capacity.resetAt,
    }
  }

  if (status === 'rate_limited') {
    if (
      waitMs !== undefined &&
      forContinuation &&
      waitMs <= input.costs.rateLimitThresholdMs &&
      waitMs <= input.costs.handoffMs + input.costs.replacementExecutionMs
    ) {
      return { eligible: true, estimatedWaitMs: waitMs, reconsiderAt: agent.capacity.resetAt }
    }
    return {
      eligible: false,
      rule: 'rate-limited',
      reason:
        waitMs === undefined
          ? 'rate limit has no reset time'
          : waitMs > input.costs.rateLimitThresholdMs
            ? `rate limit exceeds the wait threshold (${waitMs}ms)`
            : `waiting ${waitMs}ms costs more than handoff`,
      estimatedWaitMs: waitMs,
      reconsiderAt: agent.capacity.resetAt,
    }
  }

  return { eligible: false, rule: 'capacity-unavailable', reason: 'agent capacity is unavailable' }
}

function capacityRank(agent: AgentDescriptor): number {
  switch (agent.capacity.status) {
    case 'available':
      return 0
    case 'degraded':
      return 1
    case 'rate_limited':
      return 2
    case 'quota_exhausted':
      return 3
    case 'unavailable':
      return 4
  }
}

function preferenceRank(agent: AgentDescriptor, preferred: string[] | undefined): number {
  if (!preferred?.length) return 0
  const index = preferred.indexOf(agent.harness)
  return index < 0 ? preferred.length : index
}

function best<T extends AgentSession | AgentHarness>(agents: T[], required: string[], preferred?: string[]): T | undefined {
  return [...agents].sort((left, right) => {
    const rank = capacityRank(left) - capacityRank(right)
    if (rank !== 0) return rank
    const preference = preferenceRank(left, preferred) - preferenceRank(right, preferred)
    if (preference !== 0) return preference
    const leftExtra = left.capabilities.filter((capability) => !required.includes(capability)).length
    const rightExtra = right.capabilities.filter((capability) => !required.includes(capability)).length
    return leftExtra - rightExtra || (right.lastOutputAt ?? 0) - (left.lastOutputAt ?? 0) || left.id.localeCompare(right.id)
  })[0]
}

/** Pure capacity gate and handoff planner. It never calls a harness or invokes Jev. */
export function planAgentRoute(input: AgentRoutingInput): AgentRoutePlan {
  const transferCostMs = Math.max(0, input.costs.handoffMs) + Math.max(0, input.costs.replacementExecutionMs)
  const active = eligibility(input.active, input, true)
  const sessionCandidates = input.existingSessions.filter((session) => eligibility(session, input, false).eligible)
  const harnessCandidates = input.spawnCandidates.filter((harness) => eligibility(harness, input, false).eligible)
  const eligibleAgentIds = [
    ...(active.eligible ? [input.active.id] : []),
    ...sessionCandidates.map((session) => session.id),
    ...harnessCandidates.map((harness) => harness.id),
  ]

  if (active.eligible) {
    return {
      action: 'CONTINUE',
      rule: 'capacity-eligible',
      reason: active.estimatedWaitMs === undefined ? 'active agent remains eligible' : `waiting ${active.estimatedWaitMs}ms costs less than handoff`,
      currentEligible: true,
      eligibleAgentIds,
      handoff: input.handoff,
      estimatedWaitMs: active.estimatedWaitMs,
      reconsiderAt: active.reconsiderAt,
      transferCostMs,
    }
  }

  const target = best(sessionCandidates, input.requiredCapabilities, input.preferredHarnesses)
  if (target) {
    return {
      action: 'DELEGATE',
      rule: active.rule ?? 'capacity',
      reason: `active agent is not eligible (${active.reason ?? 'capacity'}); reuse ${target.agent} session`,
      currentEligible: false,
      eligibleAgentIds,
      handoff: input.handoff,
      target,
      estimatedWaitMs: active.estimatedWaitMs,
      reconsiderAt: active.reconsiderAt,
      transferCostMs,
    }
  }

  const harness = best(harnessCandidates, input.requiredCapabilities, input.preferredHarnesses)
  if (harness) {
    return {
      action: 'SPAWN',
      rule: active.rule ?? 'capacity',
      reason: `active agent is not eligible (${active.reason ?? 'capacity'}); spawn ${harness.agent}`,
      currentEligible: false,
      eligibleAgentIds,
      handoff: input.handoff,
      target: harness,
      estimatedWaitMs: active.estimatedWaitMs,
      reconsiderAt: active.reconsiderAt,
      transferCostMs,
    }
  }

  return {
    action: 'ASK',
    rule: active.rule ?? 'no-capable-route',
    reason: `active agent is not eligible (${active.reason ?? 'capacity'}) and no suitable replacement is available`,
    currentEligible: false,
    eligibleAgentIds,
    handoff: input.handoff,
    estimatedWaitMs: active.estimatedWaitMs,
    reconsiderAt: active.reconsiderAt,
    transferCostMs,
  }
}
