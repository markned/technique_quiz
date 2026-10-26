import { ROOM_CODE_LENGTH, type HostToken, type PlayerId, type RoomCode } from "./types";
import { simulationClient, simulationStorageKey } from "../dev/simulationContext";

const CLIENT_ID_KEY = "technique_quiz_multiplayer_client_id";
const PLAYER_NAME_KEY = "technique_quiz_multiplayer_player_name";
const HOST_TOKEN_PREFIX = "technique_quiz_multiplayer_host_token:";
const PLAYER_ID_PREFIX = "technique_quiz_multiplayer_player_id:";
const memoryStorage = new Map<string, string>();
const ROOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomToken(prefix: string, size = 24): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (byte) => ROOM_CHARS[byte % ROOM_CHARS.length]).join("")}`;
}

function safeLocalStorage(): Pick<Storage, "getItem" | "setItem"> {
  try {
    const storage = window.localStorage;
    const probe = "technique_quiz_storage_probe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    const simulation = simulationClient();
    if (simulation)
      return {
        getItem: (key) => storage.getItem(simulationStorageKey(key)),
        setItem: (key, value) => storage.setItem(simulationStorageKey(key), value),
      };
    return storage;
  } catch {
    return {
      getItem: (key) => memoryStorage.get(key) ?? null,
      setItem: (key, value) => {
        memoryStorage.set(key, value);
      },
    };
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
  if (simulationClient()) {
    const params = new URLSearchParams(window.location.search);
    if (params.get("simClient") && params.get("simName")) return params.get("simName")!.slice(0, 24);
  }
  return safeLocalStorage()?.getItem(PLAYER_NAME_KEY) ?? "";
}

export function rememberPlayerName(name: string): void {
  safeLocalStorage()?.setItem(PLAYER_NAME_KEY, name);
}

export function getOrCreatePlayerToken(code: RoomCode): string {
  const storage = safeLocalStorage();
  const key = `technique_quiz_multiplayer_player_token:${code}`;
  const existing = storage.getItem(key);
  if (existing) return existing;
  const token = randomToken("p", 32);
  storage.setItem(key, token);
  return token;
}

export function adoptHostToken(code: RoomCode): void {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("screen");
  if (token && /^h_[A-Z0-9]{24,64}$/.test(token)) {
    safeLocalStorage().setItem(`${HOST_TOKEN_PREFIX}${code}`, token);
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}
