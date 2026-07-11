import { BoolNode, ScriptNode, deserializeBool, deserializeScript, serializeBool, serializeScript } from './scriptAst';

export type Effect =
  | { type: 'SetBNumberProperty'; characterId: string; propertyId: string; value: ScriptNode }
  | { type: 'SetSpoolStatus'; spoolId: string; value: BoolNode }
  | { type: 'NextPage'; encounterId: string };

export function serializeEffect(effect: Effect): any {
  if (effect.type === 'SetBNumberProperty') {
    return {
      type: effect.type,
      characterId: effect.characterId,
      propertyId: effect.propertyId,
      value: serializeScript(effect.value),
    };
  }
  if (effect.type === 'SetSpoolStatus') {
    return {
      type: effect.type,
      spoolId: effect.spoolId,
      value: serializeBool(effect.value),
    };
  }
  return {
    type: effect.type,
    encounterId: effect.encounterId,
  };
}

export function deserializeEffect(data: any): Effect {
  if (!data || typeof data !== 'object') {
    return { type: 'NextPage', encounterId: '' };
  }
  if (data.type === 'SetBNumberProperty') {
    return {
      type: 'SetBNumberProperty',
      characterId: data.characterId ?? '',
      propertyId: data.propertyId ?? '',
      value: deserializeScript(data.value),
    };
  }
  if (data.type === 'SetSpoolStatus') {
    return {
      type: 'SetSpoolStatus',
      spoolId: data.spoolId ?? '',
      value: deserializeBool(data.value),
    };
  }
  return { type: 'NextPage', encounterId: data.encounterId ?? '' };
}

export function formatEffect(effect: Effect): string {
  if (effect.type === 'SetBNumberProperty') {
    return `Set property ${effect.propertyId}`;
  }
  if (effect.type === 'SetSpoolStatus') {
    return `Set spool ${effect.spoolId}`;
  }
  return `Next page ${effect.encounterId}`;
}

export function reorderEffects(effects: Effect[], from: number, to: number): Effect[] {
  if (from === to || from < 0 || to < 0 || from >= effects.length || to >= effects.length) {
    return effects;
  }
  const next = [...effects];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
