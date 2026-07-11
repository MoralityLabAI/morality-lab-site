import { Storyworld } from '../Storyworld';
import { getPerceptionValue } from './perception';

export type BoolNode =
  | { type: 'Constant'; value: boolean }
  | { type: 'SpoolActive'; spoolId: string };

export type ScriptNode =
  | { type: 'Constant'; value: number }
  | { type: 'BNumberProperty'; characterId: string; propertyId: string; perceivedCharacterId?: string; perceivedCharacterId2?: string }
  | { type: 'ArithmeticNegation'; child: ScriptNode }
  | { type: 'Proximity'; left: ScriptNode; right: ScriptNode }
  | { type: 'Average'; left: ScriptNode; right: ScriptNode }
  | { type: 'Blend'; left: ScriptNode; right: ScriptNode; weight: ScriptNode }
  | { type: 'Maximum'; left: ScriptNode; right: ScriptNode }
  | { type: 'Minimum'; left: ScriptNode; right: ScriptNode }
  | { type: 'Nudge'; base: ScriptNode; nudge: ScriptNode }
  | { type: 'IfThen'; condition: BoolNode; thenNode: ScriptNode; elseNode: ScriptNode };

export interface EvalContext {
  storyworld: Storyworld;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function evaluateBool(node: BoolNode, context: EvalContext): boolean {
  if (node.type === 'Constant') {
    return node.value;
  }
  const spool = context.storyworld.spool_directory.get(node.spoolId);
  return Boolean(spool?.active_at_start);
}

export function evaluateScript(node: ScriptNode, context: EvalContext): number {
  switch (node.type) {
    case 'Constant':
      return clamp01(node.value);
    case 'BNumberProperty': {
      const actor = context.storyworld.character_directory.get(node.characterId);
      const property = context.storyworld.authored_properties.find((prop) => prop.id === node.propertyId);
      const fallback = property?.default_value ?? 0;
      const raw = actor?.bnumber_properties.get(node.propertyId);
      const keyring = [
        ...(node.perceivedCharacterId ? [node.perceivedCharacterId] : []),
        ...(node.perceivedCharacterId2 ? [node.perceivedCharacterId2] : []),
      ];
      const value = getPerceptionValue(raw, keyring, fallback);
      return clamp01(value);
    }
    case 'ArithmeticNegation': {
      const value = evaluateScript(node.child, context);
      return clamp01(1 - value);
    }
    case 'Proximity': {
      const left = evaluateScript(node.left, context);
      const right = evaluateScript(node.right, context);
      return clamp01(1 - Math.abs(left - right));
    }
    case 'Average': {
      const left = evaluateScript(node.left, context);
      const right = evaluateScript(node.right, context);
      return clamp01((left + right) / 2);
    }
    case 'Blend': {
      const left = evaluateScript(node.left, context);
      const right = evaluateScript(node.right, context);
      const weight = clamp01(evaluateScript(node.weight, context));
      return clamp01(left * (1 - weight) + right * weight);
    }
    case 'Maximum': {
      const left = evaluateScript(node.left, context);
      const right = evaluateScript(node.right, context);
      return clamp01(Math.max(left, right));
    }
    case 'Minimum': {
      const left = evaluateScript(node.left, context);
      const right = evaluateScript(node.right, context);
      return clamp01(Math.min(left, right));
    }
    case 'Nudge': {
      const base = evaluateScript(node.base, context);
      const nudge = evaluateScript(node.nudge, context);
      return clamp01(base * (1 - nudge) + nudge);
    }
    case 'IfThen': {
      const condition = evaluateBool(node.condition, context);
      return evaluateScript(condition ? node.thenNode : node.elseNode, context);
    }
  }
}

export function serializeScript(node: ScriptNode): any {
  if (node.type === 'Constant') {
    return { type: node.type, value: Number(node.value.toFixed(4)) };
  }
  if (node.type === 'BNumberProperty') {
    return {
      type: node.type,
      characterId: node.characterId,
      propertyId: node.propertyId,
      perceivedCharacterId: node.perceivedCharacterId ?? '',
      perceivedCharacterId2: node.perceivedCharacterId2 ?? '',
    };
  }
  if (node.type === 'ArithmeticNegation') {
    return { type: node.type, child: serializeScript(node.child) };
  }
  if (node.type === 'Proximity' || node.type === 'Average' || node.type === 'Maximum' || node.type === 'Minimum') {
    return { type: node.type, left: serializeScript(node.left), right: serializeScript(node.right) };
  }
  if (node.type === 'Blend') {
    return {
      type: node.type,
      left: serializeScript(node.left),
      right: serializeScript(node.right),
      weight: serializeScript(node.weight),
    };
  }
  if (node.type === 'Nudge') {
    return {
      type: node.type,
      base: serializeScript(node.base),
      nudge: serializeScript(node.nudge),
    };
  }
  return {
    type: node.type,
    condition: serializeBool(node.condition),
    thenNode: serializeScript(node.thenNode),
    elseNode: serializeScript(node.elseNode),
  };
}

export function serializeBool(node: BoolNode): any {
  if (node.type === 'Constant') {
    return { type: node.type, value: node.value };
  }
  return { type: node.type, spoolId: node.spoolId };
}

export function deserializeScript(data: any): ScriptNode {
  if (!data || typeof data !== 'object') {
    return { type: 'Constant', value: 0 };
  }
  switch (data.type) {
    case 'Constant':
      return { type: 'Constant', value: Number(data.value ?? 0) };
    case 'BNumberProperty':
      return {
        type: 'BNumberProperty',
        characterId: data.characterId ?? '',
        propertyId: data.propertyId ?? '',
        perceivedCharacterId: data.perceivedCharacterId ?? '',
        perceivedCharacterId2: data.perceivedCharacterId2 ?? '',
      };
    case 'ArithmeticNegation':
      return { type: 'ArithmeticNegation', child: deserializeScript(data.child) };
    case 'Proximity':
      return { type: 'Proximity', left: deserializeScript(data.left), right: deserializeScript(data.right) };
    case 'Average':
      return { type: 'Average', left: deserializeScript(data.left), right: deserializeScript(data.right) };
    case 'Blend':
      return {
        type: 'Blend',
        left: deserializeScript(data.left),
        right: deserializeScript(data.right),
        weight: deserializeScript(data.weight),
      };
    case 'Maximum':
      return { type: 'Maximum', left: deserializeScript(data.left), right: deserializeScript(data.right) };
    case 'Minimum':
      return { type: 'Minimum', left: deserializeScript(data.left), right: deserializeScript(data.right) };
    case 'Nudge':
      return { type: 'Nudge', base: deserializeScript(data.base), nudge: deserializeScript(data.nudge) };
    case 'IfThen':
      return {
        type: 'IfThen',
        condition: deserializeBool(data.condition),
        thenNode: deserializeScript(data.thenNode),
        elseNode: deserializeScript(data.elseNode),
      };
    default:
      return { type: 'Constant', value: 0 };
  }
}

export function deserializeBool(data: any): BoolNode {
  if (!data || typeof data !== 'object') {
    return { type: 'Constant', value: false };
  }
  if (data.type === 'Constant') {
    return { type: 'Constant', value: Boolean(data.value) };
  }
  return { type: 'SpoolActive', spoolId: data.spoolId ?? '' };
}

export function createDefaultScriptNode(): ScriptNode {
  return { type: 'Constant', value: 0 };
}

export function createDefaultBoolNode(): BoolNode {
  return { type: 'SpoolActive', spoolId: '' };
}
