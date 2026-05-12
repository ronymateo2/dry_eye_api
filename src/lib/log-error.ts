import type { DrizzleDb } from "../db";
import { dyApiErrors } from "../db";

export function logError(
  db: DrizzleDb,
  data: { method: string; path: string; user_id?: string | null; message: string },
): Promise<unknown> {
  return db
    .insert(dyApiErrors)
    .values({
      id: crypto.randomUUID(),
      method: data.method,
      path: data.path,
      user_id: data.user_id ?? null,
      message: data.message.slice(0, 500),
    })
    .run();
}
