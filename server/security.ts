import { readRequestBody } from "./requestBody";
import { z } from "zod";
export type SecurityEnv = {
  TEST_MODE?: string;
  APP_ORIGIN?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  ADMISSION_SECRET?: string;
  RequestLimit?: { limit(options: { key: string }): Promise<{ success: boolean }> };
};
const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
const unb64 = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const schema = z.object({
  clientId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine((v) => !["__proto__", "prototype", "constructor"].includes(v)),
  room: z.string().regex(/^[A-Z0-9]{6}$/),
  role: z.enum(["host", "player"]),
  token: z.string().min(1).max(2048),
});
export function localSecurityBypass(request: Request, env: SecurityEnv) {
  const host = new URL(request.url).hostname;
  return (
    ["localhost", "127.0.0.1", "[::1]"].includes(host) &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(env.APP_ORIGIN ?? "")
  );
}
async function key(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}
export async function mintTicket(
  secret: string,
  identity: { clientId: string; room: string; role: "host" | "player" },
  now = Date.now(),
) {
  const payload = b64(
    enc.encode(JSON.stringify({ ...identity, expiresAt: now + 24 * 3600_000, purpose: "room-admission-v1" })),
  );
  const signature = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(payload));
  return `${payload}.${b64(new Uint8Array(signature))}`;
}
export async function verifyTicket(secret: string, ticket: string, room: string, now = Date.now()) {
  try {
    if (ticket.length > 2048) return null;
    const [p, s, ...rest] = ticket.split(".");
    if (!p || !s || rest.length) return null;
    if (!(await crypto.subtle.verify("HMAC", await key(secret), unb64(s), enc.encode(p)))) return null;
    const data = JSON.parse(new TextDecoder().decode(unb64(p)));
    if (
      data.purpose !== "room-admission-v1" ||
      data.room !== room ||
      data.expiresAt <= now ||
      data.expiresAt > now + 25 * 3600_000
    )
      return null;
    return schema.omit({ token: true }).parse(data);
  } catch {
    return null;
  }
}
export async function checkTurnstile(
  secret: string,
  token: string,
  ip: string,
  expectedHost: string,
  verify = fetch,
) {
  try {
    const r = await verify("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return false;
    const d = (await r.json()) as { success?: boolean; hostname?: string; action?: string };
    return d.success === true && d.hostname === expectedHost && d.action === "room_access";
  } catch {
    return false;
  }
}
export async function admission(request: Request, env: SecurityEnv) {
  const data = schema.safeParse(JSON.parse(new TextDecoder().decode(await readRequestBody(request, 4096))));
  if (!data.success) return Response.json({ error: "Проверь данные подключения." }, { status: 400 });
  if (!env.TURNSTILE_SECRET || !env.ADMISSION_SECRET)
    return Response.json({ error: "Защита входа ещё не настроена." }, { status: 503 });
  const { token, ...identity } = data.data;
  const valid = await checkTurnstile(
    env.TURNSTILE_SECRET,
    token,
    request.headers.get("CF-Connecting-IP") ?? "",
    new URL(env.APP_ORIGIN!).hostname,
  );
  if (!valid) return Response.json({ error: "Проверка не пройдена. Повтори попытку." }, { status: 403 });
  return Response.json({ ticket: await mintTicket(env.ADMISSION_SECRET, identity) });
}
