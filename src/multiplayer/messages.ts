import { z } from "zod";

const clientId = z.string().min(8).max(128);
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
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  HostHelloMessageSchema,
  PlayerJoinMessageSchema,
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
    text: z.string().trim().min(1).max(280),
  }),
  z.object({
    type: z.literal("player_vote"),
    submissionId: playerId,
  }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export function parseClientMessage(raw: string | ArrayBuffer): ClientMessage | null {
  if (typeof raw !== "string") return null;
  try {
    return ClientMessageSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
