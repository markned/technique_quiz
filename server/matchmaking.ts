import { z } from "zod";

export const SearchSchema = z.object({
  clientId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine((v) => !["__proto__", "constructor", "prototype"].includes(v)),
  playerToken: z
    .string()
    .min(20)
    .max(160)
    .regex(/^[A-Za-z0-9_-]+$/),
  fresh: z.boolean().optional(),
});
export type SearchIdentity = z.infer<typeof SearchSchema>;
export type MatchmakingState = {
  openRooms: string[];
  assignments: Record<string, { code: string; token: string; expiresAt: number; assignedAt: number }>;
  day: string;
  createdToday: number;
};
type Runtime = {
  load(): Promise<MatchmakingState | undefined>;
  save(state: MatchmakingState): Promise<void>;
  reserve(code: string, identity: SearchIdentity): Promise<{ accepted: boolean; open: boolean }>;
  release(code: string, identity: SearchIdentity): Promise<void>;
  code(): string;
};

/** Serialized by the coordinator. Its bounded registry never contains public game snapshots. */
export async function findOnlineMatch(runtime: Runtime, identity: SearchIdentity, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const state = (await runtime.load()) ?? { openRooms: [], assignments: {}, day, createdToday: 0 };
  if (state.day !== day) {
    state.day = day;
    state.createdToday = 0;
  }
  for (const [client, entry] of Object.entries(state.assignments))
    if (entry.expiresAt <= now) delete state.assignments[client];
  const prior = state.assignments[identity.clientId];
  if (prior) {
    if (prior.token !== identity.playerToken) throw new Error("identity_conflict");
    if (!identity.fresh && (await runtime.reserve(prior.code, identity)).accepted) return prior.code;
    if (now - prior.assignedAt < 5000) throw new Error("search_cooldown");
    await runtime.release(prior.code, identity);
    delete state.assignments[identity.clientId];
  }
  if (Object.keys(state.assignments).length >= 600) throw new Error("queue_full");
  state.openRooms = state.openRooms.filter((code) =>
    Object.values(state.assignments).some((a) => a.code === code),
  );
  for (const code of [...state.openRooms]) {
    const reservation = await runtime.reserve(code, identity);
    if (reservation.accepted) {
      state.assignments[identity.clientId] = {
        code,
        token: identity.playerToken,
        expiresAt: now + 30 * 60_000,
        assignedAt: now,
      };
      await runtime.save(state);
      return code;
    }
    if (!reservation.open) state.openRooms = state.openRooms.filter((c) => c !== code);
  }
  // A separate conservative creation budget prevents queue churn from creating unlimited rooms.
  if (state.createdToday >= 200) throw new Error("daily_queue_limit");
  let code = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = runtime.code();
    if ((await runtime.reserve(candidate, identity)).accepted) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new Error("queue_full");
  state.createdToday++;
  state.openRooms.push(code);
  state.assignments[identity.clientId] = {
    code,
    token: identity.playerToken,
    expiresAt: now + 30 * 60_000,
    assignedAt: now,
  };
  await runtime.save(state);
  return code;
}
