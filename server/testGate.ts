import { mintTicket, verifyTicket } from "./security";
import { readRequestBody } from "./requestBody";
export async function testGate(request: Request, secret: string | undefined): Promise<Response | null> {
  if (!secret) return new Response("Private testing is not configured", { status: 503 });
  const cookie =
    (request.headers.get("Cookie") ?? "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("__Host-technique-test="))
      ?.split("=")
      .slice(1)
      .join("=") ?? "";
  const identity = await verifyTicket(secret, cookie, "TEST00");
  if (identity?.clientId === "private-tester") return null;
  if (new URL(request.url).pathname === "/__test/login" && request.method === "POST") {
    try {
      const raw = new TextDecoder().decode(await readRequestBody(request, 4096));
      const value = new URLSearchParams(raw).get("access") ?? "";
      const digest = (v: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
      const [a, b] = await Promise.all([digest(value), digest(secret)]);
      let diff = 0;
      const aa = new Uint8Array(a),
        bb = new Uint8Array(b);
      for (let i = 0; i < aa.length; i++) diff |= aa[i]! ^ bb[i]!;
      if (diff === 0) {
        const session = await mintTicket(secret, {
          room: "TEST00",
          role: "host",
          clientId: "private-tester",
        });
        return new Response(null, {
          status: 303,
          headers: {
            Location: "/simulate",
            "Set-Cookie": `__Host-technique-test=${session}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`,
            "Cache-Control": "no-store",
          },
        });
      }
    } catch {
      /* fail closed */
    }
    return new Response("Access denied", { status: 403 });
  }
  return new Response(
    '<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width"><title>Личный тест игры</title><body style="font:18px system-ui;background:#10151f;color:white;padding:40px"><h1>Личный тест игры</h1><p>Открой личный файл доступа или введи код тестировщика.</p><form method="post" action="/__test/login"><input type="password" name="access" aria-label="Код доступа" autocomplete="current-password" required><button>Войти</button></form></body></html>',
    {
      status: 401,
      headers: {
        "Content-Type": "text/html;charset=utf-8",
        "Cache-Control": "no-store",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
      },
    },
  );
}
