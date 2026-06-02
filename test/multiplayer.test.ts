import { describe, expect, it } from "vitest";
import { FREESTYLE_SESSION_LENGTH } from "../src/helpers/quizConfig";
import { buildMultiplayerRoundOrder } from "../src/multiplayer/rounds";
import { ClientMessageSchema } from "../src/multiplayer/messages";
import {
  buildLeaderboard,
  canVoteForSubmission,
  identityReducer,
  scoreQuizAnswer,
} from "../src/multiplayer/scoring";
import {
  compareAnswerSimilarity,
  isSimilarityBonus,
  normalizeAnswerText,
} from "../src/multiplayer/similarity";
import { generateRoomCode, normalizeRoomCode } from "../src/multiplayer/identity";
import { hostPath, parseAppRoute, playerPath } from "../src/multiplayer/routes";
import type { PublicPlayer } from "../src/multiplayer/types";

function player(id: string, name: string, score: number): PublicPlayer {
  return {
    id,
    clientId: `client-${id}`,
    name,
    score,
    connected: true,
    joinedAt: 1,
    lastSeenAt: 1,
  };
}

describe("multiplayer text similarity", () => {
  it("normalizes case, punctuation, whitespace, ё, and diacritics", () => {
    expect(normalizeAnswerText("  Ё-моё, Café!!!  ")).toBe("е мое cafe");
  });

  it("scores close answers above the bonus threshold", () => {
    expect(isSimilarityBonus("ya lyublyu katatsya na velike", "я люблю кататься на велике")).toBe(true);
  });

  it("scores unrelated answers below the bonus threshold", () => {
    expect(compareAnswerSimilarity("совсем другой ответ", "я люблю кататься на велике").score).toBeLessThan(
      0.5,
    );
  });
});

describe("multiplayer leaderboard", () => {
  it("sorts by score, then name, and gives equal scores the same rank", () => {
    expect(
      buildLeaderboard([player("b", "Боря", 2), player("a", "Аня", 3), player("c", "Саша", 2)]),
    ).toMatchObject([
      { playerId: "a", rank: 1, score: 3 },
      { playerId: "b", rank: 2, score: 2 },
      { playerId: "c", rank: 2, score: 2 },
    ]);
  });
});

describe("multiplayer quiz scoring", () => {
  it("scores multiple choice answers", () => {
    expect(scoreQuizAnswer({ variant: "mc4", selectedIndex: 2 }, 2, [])).toBe(true);
    expect(scoreQuizAnswer({ variant: "mc4", selectedIndex: 1 }, 2, [])).toBe(false);
  });

  it("scores order answers only when every line is in place", () => {
    expect(scoreQuizAnswer({ variant: "order", orderIds: [1, 2, 3] }, 0, [1, 2, 3])).toBe(true);
    expect(scoreQuizAnswer({ variant: "order", orderIds: [1, 3, 2] }, 0, [1, 2, 3])).toBe(false);
  });
});

describe("multiplayer freestyle voting validation", () => {
  it("rejects self-votes and unknown submissions", () => {
    expect(canVoteForSubmission("p1", "p1", ["p1", "p2"])).toBe(false);
    expect(canVoteForSubmission("p1", "missing", ["p1", "p2"])).toBe(false);
    expect(canVoteForSubmission("p1", "p2", ["p1", "p2"])).toBe(true);
  });
});

describe("multiplayer routes and room codes", () => {
  it("normalizes room codes for typed and pasted input", () => {
    expect(normalizeRoomCode(" ab-c 123 !!! ")).toBe("ABC123");
    expect(normalizeRoomCode("abcdefghi")).toBe("ABCDEF");
  });

  it("generates six-character room codes", () => {
    expect(generateRoomCode()).toMatch(/^[A-Z0-9]{6}$/);
  });

  it("parses direct host and player links", () => {
    expect(parseAppRoute(hostPath("ABC123"))).toEqual({ kind: "host", code: "ABC123" });
    expect(parseAppRoute(playerPath("ABC123"))).toEqual({ kind: "player", code: "ABC123" });
    expect(parseAppRoute("/room/abc-123/player")).toEqual({ kind: "player", code: "ABC123" });
  });
});

describe("freestyle round order", () => {
  it("limits multiplayer freestyle to 8 single-line answer rounds from content", () => {
    const order = buildMultiplayerRoundOrder("freestyle");

    expect(order.length).toBeLessThanOrEqual(FREESTYLE_SESSION_LENGTH);
    expect(order.every((item) => item.revealLineIds.length === 1)).toBe(true);
  });
});

describe("multiplayer identity reducer", () => {
  it("remembers room-scoped host and player identities", () => {
    const withClient = identityReducer(
      { clientId: null, hostTokensByRoom: {}, playerIdsByRoom: {} },
      {
        type: "set_client_id",
        clientId: "client-1",
      },
    );
    const withHost = identityReducer(withClient, {
      type: "remember_host",
      roomCode: "ABC123",
      hostToken: "host-1",
    });
    expect(
      identityReducer(withHost, { type: "remember_player", roomCode: "ABC123", playerId: "player-1" }),
    ).toEqual({
      clientId: "client-1",
      hostTokensByRoom: { ABC123: "host-1" },
      playerIdsByRoom: { ABC123: "player-1" },
    });
  });
});

describe("multiplayer message validation", () => {
  it("accepts valid player answers and rejects malformed messages", () => {
    expect(
      ClientMessageSchema.safeParse({
        type: "player_quiz_answer",
        answer: { variant: "mc4", selectedIndex: 3 },
      }).success,
    ).toBe(true);
    expect(
      ClientMessageSchema.safeParse({
        type: "player_vote",
        submissionId: "",
      }).success,
    ).toBe(false);
  });
});
