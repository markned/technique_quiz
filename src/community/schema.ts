import { z } from "zod";

export const DraftRoundSchema = z.object({
  title: z.string().trim().max(160),
  audioFile: z.string().regex(/^(?:\/api\/media\/[a-f0-9-]{36})?$/),
  start: z.number().finite().min(0).max(1200),
  end: z.number().finite().min(0).max(1200),
  lyrics: z.array(z.object({ id: z.number().int().positive(), text: z.string().max(500) })).max(64),
  hintLineIds: z.array(z.number().int().positive()).max(32),
  revealLineIds: z.array(z.number().int().positive()).max(12),
});

export const CommunityRoundSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    audioFile: z.string().regex(/^\/api\/media\/[a-f0-9-]{36}$/),
    start: z.number().finite().min(0).max(1200),
    end: z.number().finite().positive().max(1200),
    lyrics: z
      .array(z.object({ id: z.number().int().positive(), text: z.string().trim().min(1).max(500) }))
      .min(2)
      .max(64),
    hintLineIds: z.array(z.number().int().positive()).min(1).max(32),
    revealLineIds: z.array(z.number().int().positive()).min(1).max(12),
  })
  .superRefine((round, ctx) => {
    const ids = new Set(round.lyrics.map((line) => line.id));
    const hints = new Set(round.hintLineIds);
    const reveal = new Set(round.revealLineIds);
    if (round.end - round.start < 0.25 || round.end - round.start > 120)
      ctx.addIssue({ code: "custom", message: "Фрагмент должен длиться от 0,25 до 120 секунд." });
    if (
      ids.size !== round.lyrics.length ||
      hints.size !== round.hintLineIds.length ||
      reveal.size !== round.revealLineIds.length ||
      [...hints, ...reveal].some((id) => !ids.has(id)) ||
      [...reveal].some((id) => hints.has(id))
    ) {
      ctx.addIssue({ code: "custom", message: "Проверь строки подсказок и ответа." });
    }
    const lastHint = Math.max(...hints);
    if (round.revealLineIds.some((id, i) => id !== lastHint + i + 1))
      ctx.addIssue({ code: "custom", message: "Ответ должен идти подряд после подсказок." });
  });

export type CommunityRoundInput = z.infer<typeof CommunityRoundSchema>;
export type Author = { id: string; username: string; role: "author" | "moderator"; disabled: boolean };
export type RoundDraft = {
  id: number;
  authorId: string;
  authorName: string;
  revision: number;
  status: "draft" | "submitted" | "rejected" | "approved";
  content: CommunityRoundInput;
  published: (CommunityRoundInput & { id: number; revision: number }) | null;
  comment: string;
  updatedAt: number;
};
