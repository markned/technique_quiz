/// <reference path="../worker-bindings.d.ts" />
import { testGate } from "../server/testGate";
import {
  admission,
  localSecurityBypass,
  mintTicket,
  verifyTicket,
  type SecurityEnv,
} from "../server/security";
import { SearchSchema } from "../server/matchmaking";
import { readRequestBody } from "../server/requestBody";
export { OnlineCoordinator } from "../server/onlineCoordinator";
import { parseClientMessage } from "../src/multiplayer/messages";
import { Server, routePartykitRequest, type Connection, type ConnectionContext } from "partyserver";
import { QuizRoom, type RoomConnection } from "../server/room";
import type { ConnectionMeta } from "../src/multiplayer/types";

import { CommunityStore, type CommunityEnv } from "../server/community";
import type { Round } from "../src/types";
import { FREE_TIER_LIMITS } from "../server/freeTier";
export { CommunityStore };

type Env = WorkerBindings & CommunityEnv & SecurityEnv & { TEST_GATE_SECRET?: string };
const STORAGE_KEY = "room-state-v2";

export class TechniqueQuizRoom extends Server<Env> {
  static options = { hibernate: true };
  private game!: QuizRoom;
  private pending: Promise<unknown> = Promise.resolve();

  async onStart() {
    this.game = new QuizRoom({
      id: this.name,
      testMode: this.env.TEST_MODE === "true",
      publishedRounds: async () => {
        const response = await this.env.Community.get(this.env.Community.idFromName("catalog")).fetch(
          "https://internal/api/catalog",
        );
        if (!response.ok) throw new Error("Failed to read approved rounds");
        return (await response.json<{ rounds: Round[] }>()).rounds;
      },
      load: () => this.ctx.storage.get(STORAGE_KEY),
      save: async (state, alarmAt) => {
        // State and its wake-up deadline commit together.
        await this.ctx.storage.transaction(async (tx) => {
          await tx.put(STORAGE_KEY, state);
          if (state.phase === "expired") await tx.deleteAlarm();
          else await tx.setAlarm(Math.max(Date.now() + 1, alarmAt));
        });
      },
      connections: () => this.getConnections<ConnectionMeta>() as Iterable<RoomConnection>,
    });
    await this.game.onStart();
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    // Serialize through storage awaits, including close/message/alarm races.
    const result = this.pending.then(operation);
    this.pending = result.catch((error) => {
      console.error("Room operation failed", this.name, error);
    });
    return result;
  }

  getConnectionTags(_connection: Connection, context: ConnectionContext) {
    const claim = context.request.headers.get("X-Verified-Admission");
    return claim ? [claim] : [];
  }
  onConnect(connection: Connection<ConnectionMeta>) {
    if ([...this.getConnections()].length > 24) {
      connection.close(1013, "В комнате слишком много подключений.");
      return;
    }
    return this.run(async () => this.game.onConnect(connection as RoomConnection));
  }
  onMessage(connection: Connection<ConnectionMeta>, message: string | ArrayBuffer) {
    const parsed = parseClientMessage(message);
    if (!parsed) {
      connection.close(1008, "Некорректное сообщение.");
      return;
    }
    const claim = connection.tags.find((t) => t.startsWith("admission:"));
    if (claim && (parsed.type === "host_hello" || parsed.type === "player_join")) {
      const [, role, clientId] = claim.split(":");
      if (parsed.clientId !== clientId || role !== (parsed.type === "host_hello" ? "host" : "player")) {
        connection.close(1008, "Сессия не подтверждена.");
        return;
      }
    }
    // Connection attachment survives hibernation; rate counters must survive too.
    const countKey = `socket-rate:${connection.id}`;
    return this.run(async () => {
      const previous = await this.ctx.storage.get<{ at: number; count: number }>(countKey);
      const rate = previous && Date.now() - previous.at < 10_000 ? previous : { at: Date.now(), count: 0 };
      if (++rate.count > 40) {
        connection.close(1008, "Слишком много действий. Подключись позже.");
        return;
      }
      await this.ctx.storage.put(countKey, rate);
      await this.game.onMessage(message, connection as RoomConnection);
    });
  }
  onClose(connection: Connection<ConnectionMeta>) {
    return this.run(async () => {
      await this.ctx.storage.delete(`socket-rate:${connection.id}`);
      await this.game.onClose(connection as RoomConnection);
    });
  }
  onError(connection: Connection<ConnectionMeta>) {
    return this.run(async () => {
      await this.ctx.storage.delete(`socket-rate:${connection.id}`);
      await this.game.onError(connection as RoomConnection);
    });
  }
  onAlarm() {
    return this.run(() => this.game.onAlarm());
  }
  onRequest(request: Request) {
    return this.run(async () => {
      const path = new URL(request.url).pathname;
      if (path.startsWith("/internal/online/") && request.method === "POST") {
        const body = JSON.parse(new TextDecoder().decode(await readRequestBody(request, 4096)));
        const who = SearchSchema.parse({ clientId: body.clientId, playerToken: body.token });
        if (path.endsWith("/release")) {
          await this.game.releaseOnline(who.clientId, who.playerToken);
          return Response.json({ ok: true });
        }
        if (path.endsWith("/reserve")) {
          const accepted = await this.game.reserveOnline(who.clientId, who.playerToken);
          return Response.json({
            accepted,
            open: !!this.game.state.online && this.game.state.phase === "lobby",
          });
        }
      }
      return this.game.onRequest();
    });
  }
}

const app = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (
      url.search.length > 3000 ||
      (url.searchParams.has("_pk") && !/^[A-Za-z0-9_-]{1,80}$/.test(url.searchParams.get("_pk")!))
    )
      return new Response("Invalid connection", { status: 400 });
    let bypass = localSecurityBypass(request, env);
    if (env.TEST_MODE === "true" && !bypass) {
      const gate = await testGate(request, env.TEST_GATE_SECRET);
      if (
        gate &&
        env.RequestLimit &&
        !(
          await env.RequestLimit.limit({
            key: `test-login:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`,
          })
        ).success
      )
        return new Response("Try later", { status: 429 });
      if (gate) return gate;
      bypass = true;
    }
    const origin = request.headers.get("Origin");
    if (origin && origin !== env.APP_ORIGIN) return new Response("Origin not allowed", { status: 403 });
    if (!bypass && env.RequestLimit && path !== "/health") {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      if (
        !(await env.RequestLimit.limit({ key: `${path === "/api/admission" ? "admit" : "http"}:${ip}` }))
          .success
      )
        return Response.json(
          { error: "Слишком много запросов. Попробуй чуть позже." },
          {
            status: 429,
            headers: { "Retry-After": "60", "Access-Control-Allow-Origin": env.APP_ORIGIN ?? "" },
          },
        );
    }
    if (path === "/health" && request.method === "GET")
      return Response.json({
        ok: true,
        service: "technique-quiz",
        testMode: env.TEST_MODE === "true",
        appOrigin: env.APP_ORIGIN,
        freeTierGuard: "r2-v1",
        mediaLimits: FREE_TIER_LIMITS,
      });
    if (path.startsWith("/api/")) {
      const origin = request.headers.get("Origin");
      const allowedOrigin = env.APP_ORIGIN ?? "http://localhost:18768";
      if (origin && origin !== allowedOrigin) return new Response("Origin not allowed", { status: 403 });
      const headers = {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        Vary: "Origin",
      };
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (path === "/api/security/config")
        return Response.json({ required: !bypass, sitekey: env.TURNSTILE_SITE_KEY ?? null }, { headers });
      if (path === "/api/admission") {
        try {
          const response = await admission(request, env);
          for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
          return response;
        } catch {
          return Response.json({ error: "Не удалось подтвердить подключение." }, { status: 400, headers });
        }
      }
      if (path === "/api/online/search") {
        if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers });
        try {
          const who = SearchSchema.parse(
            JSON.parse(new TextDecoder().decode(await readRequestBody(request, 4096))),
          );
          const ticket = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
          const claim =
            !bypass && env.ADMISSION_SECRET
              ? await verifyTicket(env.ADMISSION_SECRET, ticket, "ONLINE", Date.now(), "queue-admission-v1")
              : null;
          if (!bypass && (!claim || claim.role !== "player" || claim.clientId !== who.clientId))
            return Response.json({ error: "Подтверди вход в поиск." }, { status: 403, headers });
          const pool =
            env.TEST_MODE === "true" && who.clientId.startsWith("E2E_")
              ? "e2e-fast-v1"
              : env.TEST_MODE === "true" && who.clientId.startsWith("QA_REAL_")
                ? "e2e-media-v1"
                : "public-v1";
          const response = await env.Online.get(env.Online.idFromName(pool)).fetch(
            new Request("https://internal/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(who),
            }),
          );
          if (!response.ok) return new Response(response.body, { status: response.status, headers });
          const { code } = await response.json<{ code: string }>();
          const roomTicket = bypass
            ? "local"
            : await mintTicket(env.ADMISSION_SECRET!, { room: code, role: "player", clientId: who.clientId });
          return Response.json({ code, ticket: roomTicket }, { headers });
        } catch {
          return Response.json(
            { error: "Не удалось найти игру. Повтори попытку." },
            { status: 400, headers },
          );
        }
      }
      const response = await env.Community.get(env.Community.idFromName("catalog")).fetch(request);
      const result = new Response(response.body, response);
      for (const [key, value] of Object.entries(headers)) result.headers.set(key, value);
      return result;
    }
    if (env.Assets && /^\/(content|audio)\/.*\.(mp4|m4a|mp3|ogg|wav|webm)$/i.test(path))
      return Response.redirect(`https://technique.ink${path}`, 307);
    if (!path.startsWith("/api/") && !path.startsWith("/parties/") && env.Assets)
      return env.Assets.fetch(request);
    if (!/^\/parties\/main\/[A-Z0-9]{6}$/.test(path)) {
      return new Response("Not found", { status: 404 });
    }
    if (!bypass && env.ADMISSION_ENFORCED !== "false") {
      if (!env.ADMISSION_SECRET) return new Response("Security not configured", { status: 503 });
      const claim = await verifyTicket(
        env.ADMISSION_SECRET,
        url.searchParams.get("ticket") ?? "",
        path.split("/").at(-1)!,
      );
      if (!claim) return new Response("Подтверди вход на сайте.", { status: 403 });
      const headers = new Headers(request.headers);
      headers.set("X-Verified-Admission", `admission:${claim.role}:${claim.clientId}`);
      request = new Request(request, { headers });
    } else {
      const headers = new Headers(request.headers);
      headers.delete("X-Verified-Admission");
      request = new Request(request, { headers });
    }
    return (await routePartykitRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

export default {
  async fetch(request: Request, env: Env) {
    const response = await app.fetch(request, env);
    if (response.status === 101) return response;
    const safe = new Response(response.body, response);
    if (new URL(request.url).pathname.startsWith("/parties/") && response.status === 200) {
      safe.headers.set("Access-Control-Allow-Origin", env.APP_ORIGIN ?? "");
      safe.headers.set("Vary", "Origin");
    }
    safe.headers.set("X-Content-Type-Options", "nosniff");
    safe.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    safe.headers.set("X-Frame-Options", "SAMEORIGIN");
    if (!safe.headers.has("Cache-Control")) safe.headers.set("Cache-Control", "no-store");
    return safe;
  },
} satisfies ExportedHandler<Env>;
