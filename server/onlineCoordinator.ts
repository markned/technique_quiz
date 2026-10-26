import { DurableObject } from "cloudflare:workers";
import { findOnlineMatch, SearchSchema, type MatchmakingState, type SearchIdentity } from "./matchmaking";
import { readRequestBody } from "./requestBody";

export class OnlineCoordinator extends DurableObject<WorkerBindings> {
  private pending: Promise<unknown> = Promise.resolve();
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }
  fetch(request: Request): Promise<Response> {
    return this.run(() => this.search(request));
  }
  private async search(request: Request) {
    try {
      const identity = SearchSchema.parse(
        JSON.parse(new TextDecoder().decode(await readRequestBody(request, 4096))),
      );
      const call = (code: string, action: string, who: SearchIdentity) =>
        this.env.Main.get(this.env.Main.idFromName(code)).fetch(
          new Request(`https://internal/internal/online/${action}`, {
            method: "POST",
            headers: { "x-partykit-room": code, "Content-Type": "application/json" },
            body: JSON.stringify({ clientId: who.clientId, token: who.playerToken }),
          }),
        );
      const code = await findOnlineMatch(
        {
          load: () => this.ctx.storage.get<MatchmakingState>("queue"),
          save: async (state) => {
            await this.ctx.storage.transaction(async (tx) => {
              await tx.put("queue", state);
              await tx.setAlarm(Date.now() + 31 * 60_000);
            });
          },
          reserve: async (code, who) => {
            const r = await call(code, "reserve", who);
            if (!r.ok) throw new Error("reserve_failed");
            return r.json<{ accepted: boolean; open: boolean }>();
          },
          release: async (code, who) => {
            const r = await call(code, "release", who);
            if (!r.ok) throw new Error("release_failed");
          },
          code: () => {
            const bytes = crypto.getRandomValues(new Uint8Array(6));
            const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
            const code = Array.from(bytes, (b) => chars[b % chars.length]).join("");
            return this.env.TEST_MODE === "true" && identity.clientId.startsWith("E2E_")
              ? `E2E${code.slice(0, 3)}`
              : code;
          },
        },
        identity,
      );
      return Response.json({ code });
    } catch (error) {
      const message = error instanceof Error ? error.message : "search_failed";
      return Response.json(
        {
          error:
            message === "identity_conflict"
              ? "Повтори проверку входа."
              : "Поиск временно недоступен. Попробуй чуть позже.",
        },
        { status: 429 },
      );
    }
  }
  alarm() {
    return this.run(() => this.cleanup());
  }
  private async cleanup() {
    const state = await this.ctx.storage.get<MatchmakingState>("queue");
    if (!state) return;
    for (const [id, entry] of Object.entries(state.assignments))
      if (entry.expiresAt <= Date.now()) delete state.assignments[id];
    state.openRooms = state.openRooms.filter((code) =>
      Object.values(state.assignments).some((a) => a.code === code),
    );
    await this.ctx.storage.put("queue", state);
    if (Object.keys(state.assignments).length) await this.ctx.storage.setAlarm(Date.now() + 31 * 60_000);
  }
}
