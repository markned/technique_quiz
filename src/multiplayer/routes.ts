import { generateRoomCode, normalizeRoomCode } from "./identity";
import type { RoomCode } from "./types";

export type AppRoute =
  | { kind: "home" }
  | { kind: "host"; code: RoomCode }
  | { kind: "player"; code: RoomCode }
  | { kind: "editor" };

export function parseAppRoute(pathname = window.location.pathname): AppRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/editor") return { kind: "editor" };
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "room" && parts[1]) {
    const code = normalizeRoomCode(parts[1]);
    if (parts[2] === "host") return { kind: "host", code };
    if (parts[2] === "player") return { kind: "player", code };
  }
  if (parts[0] === "join" && parts[1]) {
    return { kind: "player", code: normalizeRoomCode(parts[1]) };
  }
  return { kind: "home" };
}

export function hostPath(code: RoomCode): string {
  return `/room/${code}/host`;
}

export function playerPath(code: RoomCode): string {
  return `/join/${code}`;
}

export function createHostRoomUrl(): string {
  return hostPath(generateRoomCode());
}

export function publicJoinUrl(code: RoomCode): string {
  return `${window.location.origin}${playerPath(code)}`;
}
