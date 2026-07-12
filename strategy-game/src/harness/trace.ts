import { createHash } from 'crypto';

import { GamePhase } from '../engine/types';
import {
  BindingStatus,
  EnforcementMode,
  ExecutionStatus,
  TraceChannel,
  TraceEvent,
  TraceValidationIssue
} from './types';

export function createCanonicalHash(value: unknown): string {
  return createHash('sha256')
    .update(stableStringify(value))
    .digest('hex');
}

export function createTraceEvent(params: {
  eventId: string;
  type: string;
  turn: number;
  phase: GamePhase;
  enforcementMode: EnforcementMode;
  preStateHash: string;
  postStateHash: string;
  data?: Record<string, unknown>;
  overrides?: Partial<TraceEvent>;
}): TraceEvent {
  const channel = params.overrides?.channel || inferTraceChannel(params.type);
  const bindingStatus = params.overrides?.binding_status || inferBindingStatus(channel, params.enforcementMode);
  const executionStatus = params.overrides?.execution_status || inferExecutionStatus(params.type, params.data || {});
  const overrides = { ...params.overrides };
  delete overrides.schema;
  delete overrides.event_id;
  delete overrides.turn;
  delete overrides.phase;
  delete overrides.pre_state_hash;
  delete overrides.post_state_hash;

  return {
    ...overrides,
    schema: 'theysing.traceEvent.v1',
    event_id: params.eventId,
    turn: params.turn,
    phase: params.phase,
    channel,
    binding_status: bindingStatus,
    execution_status: executionStatus,
    content_ref: params.overrides?.content_ref || params.type,
    pre_state_hash: params.preStateHash,
    post_state_hash: params.postStateHash,
    attempted: params.overrides?.attempted ?? inferAttempted(params.type, params.data || {}),
    accepted: params.overrides?.accepted ?? inferAccepted(params.type, params.data || {}),
    executed: params.overrides?.executed ?? executionStatus === 'executed',
    blocked: params.overrides?.blocked ?? executionStatus === 'blocked'
  };
}

export function validateTraceEvent(value: unknown, index = 0): TraceValidationIssue[] {
  const issues: TraceValidationIssue[] = [];
  const event = value as Partial<TraceEvent> | null;

  if (!event || typeof event !== 'object') {
    return [{ index, severity: 'error', message: 'trace must be an object' }];
  }

  requireField(issues, index, event.schema === 'theysing.traceEvent.v1', 'trace.schema must be theysing.traceEvent.v1');
  requireField(issues, index, typeof event.event_id === 'string' && event.event_id.length > 0, 'trace.event_id is required');
  requireField(issues, index, Number.isFinite(event.turn), 'trace.turn must be numeric');
  requireField(issues, index, typeof event.phase === 'string' && event.phase.length > 0, 'trace.phase is required');
  requireField(issues, index, typeof event.channel === 'string' && event.channel.length > 0, 'trace.channel is required');
  requireField(issues, index, typeof event.binding_status === 'string' && event.binding_status.length > 0, 'trace.binding_status is required');
  requireField(issues, index, typeof event.execution_status === 'string' && event.execution_status.length > 0, 'trace.execution_status is required');
  requireField(issues, index, isHash(event.pre_state_hash), 'trace.pre_state_hash must be a sha256 hex hash');
  if (event.post_state_hash !== undefined) {
    requireField(issues, index, isHash(event.post_state_hash), 'trace.post_state_hash must be a sha256 hex hash');
  }

  return issues;
}

function inferTraceChannel(type: string): TraceChannel {
  if (type === 'session_created' || type === 'session_completed') return 'session';
  if (
    type === 'negotiation_messages' ||
    type === 'sing_canonical_revealed' ||
    type === 'lexicon_mutation_proposed'
  ) return 'public_speech';
  if (type === 'negotiation_reasoning_diary' || type === 'phase_reasoning_diary') return 'private_diary';
  if (
    type === 'pacts_activated' ||
    type === 'common_carrier_treaty_ratified' ||
    type === 'pact_expired' ||
    type === 'pact_honored' ||
    type === 'lexicon_mutation_accepted' ||
    type === 'lexicon_fork_executed'
  ) return 'formal_pact';
  if (type === 'orders_submitted') return 'order';
  if (
    type.startsWith('pact_breach') ||
    type.startsWith('institution_') ||
    type === 'lexicon_fork_blocked' ||
    type === 'lexicon_mutation_blocked' ||
    type === 'pax_jenkins_authority_changed'
  ) return 'pact_enforcement';
  if (type === 'architecture_pressure' || type === 'sing_decode_receipt') return 'analysis';
  return 'engine_resolution';
}

function inferBindingStatus(channel: TraceChannel, enforcementMode: EnforcementMode): BindingStatus {
  if (channel === 'public_speech' || channel === 'private_diary' || channel === 'analysis' || channel === 'session') {
    return 'nonbinding';
  }
  if (channel === 'formal_pact' || channel === 'pact_enforcement' || channel === 'order') {
    if (enforcementMode === 'hard') return 'hard_enforced_pact';
    if (enforcementMode === 'graduated') return 'graduated_pact';
    return 'formal_soft_pact';
  }
  return 'nonbinding';
}

function inferExecutionStatus(type: string, data: Record<string, unknown>): ExecutionStatus {
  if (type.endsWith('_blocked')) return 'blocked';
  if (type.endsWith('_executed') || type.endsWith('_accepted') || type === 'sing_canonical_revealed') return 'executed';
  if (type.endsWith('_proposed')) return 'attempted';
  if (type === 'sing_decode_receipt') return 'accepted';
  if (type === 'pact_breach_blocked') return 'blocked';
  if (type === 'pact_breach_executed') return 'executed';
  if (type === 'pact_breach_sanctioned') return 'sanctioned';
  if (type === 'orders_submitted') {
    const accepted = Number(data.acceptedOrderCount || 0);
    const rejected = Number(data.rejectedOrderCount || 0);
    if (accepted > 0) return 'accepted';
    if (rejected > 0) return 'blocked';
    return 'attempted';
  }
  if (type === 'engine_event' || type === 'phase_advanced' || type === 'turn_completed') return 'executed';
  return 'not_applicable';
}

function inferAttempted(type: string, data: Record<string, unknown>): boolean {
  if (
    type.startsWith('pact_breach') ||
    type.startsWith('institution_') ||
    type.startsWith('lexicon_mutation_') ||
    type.startsWith('lexicon_fork_') ||
    type === 'sing_decode_receipt'
  ) return true;
  if (type === 'orders_submitted') return Number(data.requestedOrderCount || 0) > 0;
  return false;
}

function inferAccepted(type: string, data: Record<string, unknown>): boolean {
  if (type === 'orders_submitted') return Number(data.acceptedOrderCount || 0) > 0;
  if (type === 'pacts_activated') return true;
  if (
    type.endsWith('_executed') ||
    type.endsWith('_accepted') ||
    type === 'sing_decode_receipt' ||
    type === 'sing_canonical_revealed'
  ) return true;
  return false;
}

function requireField(
  issues: TraceValidationIssue[],
  index: number,
  condition: boolean,
  message: string
): void {
  if (!condition) {
    issues.push({ index, severity: 'error', message });
  }
}

function isHash(value: unknown): boolean {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (value instanceof Set) return Array.from(value).map(normalize).sort();
  if (value instanceof Map) {
    return Array.from(value.entries())
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
      .map(([key, entryValue]) => [key, normalize(entryValue)]);
  }

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, normalize(record[key])])
  );
}
