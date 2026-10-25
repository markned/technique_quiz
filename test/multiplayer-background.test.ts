import { describe, expect, it } from "vitest";
import { multiplayerRoundBackground } from "../src/helpers/roundBackground";
import { rounds } from "../src/content/rounds";

describe("shared multiplayer backgrounds", () => {
  it("keeps the same source across clients, answer phases, remounts and reconnects", () => {
    const turn = { code: "SAMEBG", turnId: "turn_abc", round: rounds[0]! };
    const original = multiplayerRoundBackground(turn);
    expect(original.photoUrl).toBeTruthy();
    for (let n = 0; n < 20; n++) expect(multiplayerRoundBackground(structuredClone(turn))).toEqual(original);
  });
  it("uses round video configuration identically for host and players", () => {
    const turn = {
      code: "SAMEBG",
      turnId: "turn_video",
      round: { ...rounds[0]!, backgroundVideo: { file: "test.mp4", start: 9 } },
    };
    expect(multiplayerRoundBackground(turn)).toMatchObject({
      videoSrc: expect.stringContaining("test.mp4"),
      videoStartSec: 9,
    });
    expect(multiplayerRoundBackground(structuredClone(turn))).toEqual(multiplayerRoundBackground(turn));
  });
});
