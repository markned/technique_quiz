import { z } from "zod";

const clientId = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine((v) => !["__proto__", "prototype", "constructor"].includes(v));
const hostToken = z.string().min(12).max(160);
const playerId = z.string().min(4).max(80);
const name = z.string().trim().min(1).max(24);

export const HostHelloMessageSchema = z.object({
  type: z.literal("host_hello"),
  clientId,
  hostToken,
});

export const PlayerJoinMessageSchema = z.object({
  type: z.literal("player_join"),
  clientId,
  name,
  knownPlayerId: playerId.optional(),
  playerToken: z.string().min(20).max(160),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  HostHelloMessageSchema,
  z.object({ type: z.literal("player_ready") }),
  z.object({ type: z.literal("player_rematch") }),
  z.object({ type: z.literal("player_media_ready"), turnId: z.string().min(1) }),
  z.object({ type: z.literal("player_media_failed"), turnId: z.string().min(1) }),
  z.object({ type: z.literal("host_media_failed"), turnId: z.string().min(1) }),
  z.object({ type: z.literal("host_retry_media") }),
  z.object({ type: z.literal("host_pause"), paused: z.boolean() }),
  z.object({ type: z.literal("host_return_lobby") }),
  z.object({ type: z.literal("player_replay"), turnId: z.string().min(1) }),
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("host_set_discord"), enabled: z.boolean() }),
  z.object({
    type: z.literal("host_media_ready"),
    turnId: z.string().min(1),
    replayId: z.string().max(80).optional(),
  }),
  PlayerJoinMessageSchema,
  z.object({ type: z.literal("player_leave") }),
  z.object({ type: z.literal("player_mode_vote"), mode: z.enum(["freestyle", "quiz"]) }),
  z.object({ type: z.literal("player_final_vote"), mode: z.enum(["freestyle", "quiz"]) }),
  z.object({
    type: z.literal("host_start_mode_select"),
  }),
  z.object({
    type: z.literal("host_select_mode"),
    mode: z.enum(["freestyle", "quiz"]),
  }),
  z.object({
    type: z.literal("host_start_game"),
  }),
  z.object({
    type: z.literal("host_media_checkpoint"),
    turnId: z.string().min(1),
    checkpoint: z.enum(["fragment_stopped"]),
    roundId: z.number().int(),
  }),
  z.object({
    type: z.literal("host_restart_game"),
  }),
  z.object({
    type: z.literal("player_rename"),
    name,
  }),
  z.object({
    type: z.literal("player_quiz_answer"),
    turnId: z.string().min(1),
    answer: z.discriminatedUnion("variant", [
      z.object({
        variant: z.literal("mc4"),
        selectedIndex: z.number().int().min(0).max(3),
      }),
      z.object({
        variant: z.literal("order"),
        orderIds: z.array(z.number().int()).min(3).max(12),
      }),
    ]),
  }),
  z.object({
    type: z.literal("player_freestyle_submit"),
    turnId: z.string().min(1),
    text: z.string().trim().min(1).max(280),
  }),
  z.object({
    type: z.literal("player_vote"),
    turnId: z.string().min(1),
    submissionId: playerId,
  }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export function parseClientMessage(raw: string | ArrayBuffer): ClientMessage | null {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  try {
    return ClientMessageSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
