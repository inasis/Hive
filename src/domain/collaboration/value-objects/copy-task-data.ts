/** Copies JSON-shaped task metadata so callers cannot mutate aggregate state through nested references. */
export function copyTaskMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return copyValue(metadata, new WeakMap()) as Record<string, unknown>;
}

/** Compares JSON-shaped task values by content while tolerating repeated/cyclic object pairs. */
export function taskDataEquals(left: unknown, right: unknown): boolean {
  return equalValue(left, right, new WeakMap());
}

function copyValue(value: unknown, copies: WeakMap<object, object>): unknown {
  if (value === null || typeof value !== "object") return value;
  const knownCopy = copies.get(value);
  if (knownCopy) return knownCopy;

  try {
    const copy = structuredClone(value);
    copies.set(value, copy);
    return copy;
  } catch {
    if (Array.isArray(value)) {
      const copy: unknown[] = [];
      copies.set(value, copy);
      for (const entry of value) copy.push(copyValue(entry, copies));
      return copy;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;

    const copy = Object.create(prototype) as Record<string, unknown>;
    copies.set(value, copy);
    for (const [key, entry] of Object.entries(value)) copy[key] = copyValue(entry, copies);
    return copy;
  }
}

function equalValue(left: unknown, right: unknown, compared: WeakMap<object, WeakSet<object>>): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;

  const leftIsArray = Array.isArray(left);
  if (leftIsArray || Array.isArray(right)) {
    if (!leftIsArray || !Array.isArray(right) || left.length !== right.length) return false;
    if (hasComparedPair(left, right, compared)) return true;
    rememberComparedPair(left, right, compared);
    return left.every((entry, index) => equalValue(entry, right[index], compared));
  }

  const prototype = Object.getPrototypeOf(left);
  if (prototype !== Object.getPrototypeOf(right) || (prototype !== Object.prototype && prototype !== null)) return false;
  if (hasComparedPair(left, right, compared)) return true;
  rememberComparedPair(left, right, compared);

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => {
    if (key !== rightKeys[index]) return false;
    return equalValue(leftRecord[key], rightRecord[key], compared);
  });
}

function hasComparedPair(left: object, right: object, compared: WeakMap<object, WeakSet<object>>): boolean {
  return compared.get(left)?.has(right) === true;
}

function rememberComparedPair(left: object, right: object, compared: WeakMap<object, WeakSet<object>>): void {
  const rights = compared.get(left) ?? new WeakSet<object>();
  rights.add(right);
  compared.set(left, rights);
}
