export function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function stringifyNullable(value: unknown): string | null {
  return value ? JSON.stringify(value) : null;
}
