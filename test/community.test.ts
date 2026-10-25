import { describe, expect, it } from "vitest";
import { CommunityRoundSchema, DraftRoundSchema } from "../src/community/schema";
const round = {
  title: "Title",
  audioFile: "/api/media/00000000-0000-0000-0000-000000000000",
  start: 2,
  end: 10,
  lyrics: [
    { id: 1, text: "Hint" },
    { id: 2, text: "Answer" },
  ],
  hintLineIds: [1],
  revealLineIds: [2],
};
describe("community validation", () => {
  it("saves incomplete work as a draft but requires complete content for moderation", () => {
    const incomplete = { ...round, title: "", audioFile: "", lyrics: [], hintLineIds: [], revealLineIds: [] };
    expect(DraftRoundSchema.safeParse(incomplete).success).toBe(true);
    expect(CommunityRoundSchema.safeParse(incomplete).success).toBe(false);
    expect(CommunityRoundSchema.safeParse(round).success).toBe(true);
  });
  it("rejects external media, invalid timing and overlapping or duplicated lines", () => {
    for (const change of [
      { audioFile: "https://other/audio.mp3" },
      { audioFile: "data:audio/wav;base64,AAAA" },
      { end: 1 },
      { end: 1000 },
      { hintLineIds: [1, 2] },
      { revealLineIds: [2, 2] },
      { revealLineIds: [3] },
    ]) {
      expect(CommunityRoundSchema.safeParse({ ...round, ...change }).success).toBe(false);
    }
  });
});
