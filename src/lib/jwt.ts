const ALGO = { name: "HMAC", hash: "SHA-256" };
const EXP_SECONDS = 30 * 24 * 60 * 60; // 30 days

async function importKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey("raw", enc.encode(secret), ALGO, false, [
    "sign",
    "verify",
  ]);
}

function b64url(buf: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(str: string): string {
  return atob(str.replace(/-/g, "+").replace(/_/g, "/"));
}

export async function signToken(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const header = b64url(
    new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  );
  const body = b64url(
    new TextEncoder().encode(
      JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) }),
    ),
  );
  const key = await importKey(secret);
  const sig = b64url(
    await crypto.subtle.sign(ALGO, key, new TextEncoder().encode(`${header}.${body}`)),
  );
  return `${header}.${body}.${sig}`;
}

export async function verifyToken(
  token: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];
  const key = await importKey(secret);
  const valid = await crypto.subtle.verify(
    ALGO,
    key,
    Uint8Array.from(b64urlDecode(sig), (c) => c.charCodeAt(0)),
    new TextEncoder().encode(`${header}.${body}`),
  );
  if (!valid) return null;
  const payload = JSON.parse(b64urlDecode(body)) as Record<string, unknown>;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) return null;
  return payload;
}

export function makePayload(userId: string): Record<string, unknown> {
  return {
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + EXP_SECONDS,
  };
}
