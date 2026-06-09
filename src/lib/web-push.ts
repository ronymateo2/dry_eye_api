import { buildPushPayload } from "@block65/webcrypto-web-push";
import type { Env } from "../types";

export type StoredSub = { endpoint: string; p256dh: string; auth: string };
export type PushPayload = { title: string; body: string; tag: string; url: string };

function vapid(env: Env) {
  return {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
}

// Devuelve el status HTTP del servicio de push (404/410 => suscripción muerta).
export async function sendPush(sub: StoredSub, payload: PushPayload, env: Env): Promise<number> {
  const init = await buildPushPayload(
    { data: JSON.stringify(payload), options: { ttl: 3600 } },
    { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    vapid(env),
  );
  const res = await fetch(sub.endpoint, init);
  return res.status;
}

// Reagenda la alarma del DO del usuario tras cualquier cambio de cronograma.
export function touchReminders(env: Env, userId: string): Promise<void> {
  const stub = env.REMINDERS.get(env.REMINDERS.idFromName(userId));
  return stub.refresh(userId);
}
