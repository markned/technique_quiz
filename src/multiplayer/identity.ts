import { ROOM_CODE_LENGTH, type HostToken, type PlayerId, type RoomCode } from "./types";

const CLIENT_ID_KEY = "technique_quiz_multiplayer_client_id";
const PLAYER_NAME_KEY = "technique_quiz_multiplayer_player_name";
const HOST_TOKEN_PREFIX = "technique_quiz_multiplayer_host_token:";
const PLAYER_ID_PREFIX = "technique_quiz_multiplayer_player_id:";
const ROOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomToken(prefix: string, size = 24): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (byte) => ROOM_CHARS[byte % ROOM_CHARS.length]).join("")}`;
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function generateRoomCode(): RoomCode {
  return Array.from(
    { length: ROOM_CODE_LENGTH },
    () => ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)],
  ).join("");
}

export function normalizeRoomCode(input: string): RoomCode {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, ROOM_CODE_LENGTH);
}

export function getOrCreateClientId(): string {
  const storage = safeLocalStorage();
  const existing = storage?.getItem(CLIENT_ID_KEY);
  if (existing) return existing;
  const next = randomToken("c");
  storage?.setItem(CLIENT_ID_KEY, next);
  return next;
}

export function getOrCreateHostToken(roomCode: RoomCode): HostToken {
  const storage = safeLocalStorage();
  const key = `${HOST_TOKEN_PREFIX}${roomCode}`;
  const existing = storage?.getItem(key);
  if (existing) return existing;
  const next = randomToken("h");
  storage?.setItem(key, next);
  return next;
}

export function rememberPlayerId(roomCode: RoomCode, playerId: PlayerId): void {
  safeLocalStorage()?.setItem(`${PLAYER_ID_PREFIX}${roomCode}`, playerId);
}

export function getKnownPlayerId(roomCode: RoomCode): PlayerId | undefined {
  return safeLocalStorage()?.getItem(`${PLAYER_ID_PREFIX}${roomCode}`) ?? undefined;
}

export function getSavedPlayerName(): string {
  return safeLocalStorage()?.getItem(PLAYER_NAME_KEY) ?? "";
}

export function rememberPlayerName(name: string): void {
  safeLocalStorage()?.setItem(PLAYER_NAME_KEY, name);
}
