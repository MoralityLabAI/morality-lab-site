export type PerceptionValue = number | Record<string, any>;

const isRecord = (value: any): value is Record<string, any> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function extractBaseValue(value: any, preferredId: string | null, fallback: number): number {
  if (typeof value === 'number') return value;
  if (isRecord(value)) {
    if (preferredId && preferredId in value) {
      return extractBaseValue(value[preferredId], preferredId, fallback);
    }
    const keys = Object.keys(value);
    if (keys.length > 0) {
      return extractBaseValue(value[keys[0]], preferredId, fallback);
    }
  }
  return fallback;
}

export function normalizePerceptionValue(
  current: any,
  depth: number,
  castIds: string[],
  fallback: number,
  preferredId: string | null = null
): PerceptionValue {
  const buildLayer = (seed: any, remaining: number): PerceptionValue => {
    if (remaining <= 0) {
      return extractBaseValue(seed, preferredId, fallback);
    }
    const map: Record<string, any> = {};
    for (const id of castIds) {
      const nextSeed = isRecord(seed) && id in seed ? seed[id] : seed;
      map[id] = buildLayer(nextSeed, remaining - 1);
    }
    return map;
  };
  return buildLayer(current, depth);
}

export function getPerceptionValue(value: any, keyring: string[], fallback: number): number {
  let cursor: any = value;
  for (const key of keyring) {
    if (!isRecord(cursor) || !(key in cursor)) {
      return fallback;
    }
    cursor = cursor[key];
  }
  return extractBaseValue(cursor, keyring[keyring.length - 1] ?? null, fallback);
}

export function setPerceptionValue(value: any, keyring: string[], nextValue: number): PerceptionValue {
  if (keyring.length === 0) {
    return nextValue;
  }
  if (!isRecord(value)) {
    return value;
  }
  let cursor: any = value;
  for (let i = 0; i < keyring.length; i += 1) {
    const key = keyring[i];
    if (i === keyring.length - 1) {
      cursor[key] = nextValue;
    } else {
      if (!isRecord(cursor[key])) {
        cursor[key] = {};
      }
      cursor = cursor[key];
    }
  }
  return value;
}
