import { Server, routePartykitRequest, type Connection } from "partyserver";
import { QuizRoom, type RoomConnection } from "../server/room";
import type { ConnectionMeta } from "../src/multiplayer/types";

import { CommunityStore, type CommunityEnv } from "../server/community";
import type { Round } from "../src/types";
export { CommunityStore };

type Env = CommunityEnv & {
  Community: DurableObjectNamespace<CommunityStore>;
  Main: DurableObjectNamespace<TechniqueQuizRoom>;
  TEST_MODE: string;
};
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

  onConnect(connection: Connection<ConnectionMeta>) {
    return this.run(async () => this.game.onConnect(connection as RoomConnection));
  }
  onMessage(connection: Connection<ConnectionMeta>, message: string | ArrayBuffer) {
    return this.run(() => this.game.onMessage(message, connection as RoomConnection));
  }
  onClose(connection: Connection<ConnectionMeta>) {
    return this.run(() => this.game.onClose(connection as RoomConnection));
  }
  onError(connection: Connection<ConnectionMeta>) {
    return this.run(() => this.game.onError(connection as RoomConnection));
  }
  onAlarm() {
    return this.run(() => this.game.onAlarm());
  }
  onRequest() {
    return this.run(() => this.game.onRequest());
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET")
      return Response.json({
        ok: true,
        service: "technique-quiz",
        testMode: env.TEST_MODE === "true",
        appOrigin: env.APP_ORIGIN,
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
      const response = await env.Community.get(env.Community.idFromName("catalog")).fetch(request);
      const result = new Response(response.body, response);
      for (const [key, value] of Object.entries(headers)) result.headers.set(key, value);
      return result;
    }
    if (!/^\/parties\/main\/[A-Z0-9]{6}$/.test(path)) {
      return new Response("Not found", { status: 404 });
    }
    return (await routePartykitRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
