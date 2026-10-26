import { useEffect, useState } from "react";
import { apiUrl } from "./community/api";
export function navigateMenu(stage = "menu") {
  window.location.href = `/#${stage}`;
}
export function useMenuStage() {
  const read = () => window.location.hash.slice(1) || "start";
  const [stage, update] = useState(read);
  useEffect(() => {
    const listener = () => update(read());
    window.addEventListener("popstate", listener);
    window.addEventListener("hashchange", listener);
    return () => {
      window.removeEventListener("popstate", listener);
      window.removeEventListener("hashchange", listener);
    };
  }, []);
  return [
    stage,
    (next: string) => {
      history.pushState(null, "", `#${next}`);
      update(next);
    },
  ] as const;
}
export type RecentRoom = { code: string; role: "host" | "player"; expiresAt: number; online?: boolean };
const key = "technique_quiz_recent_room";
export function recentRoom(): RecentRoom | null {
  try {
    const r = JSON.parse(localStorage.getItem(key) ?? "null");
    return r &&
      /^[A-Z0-9]{6}$/.test(r.code) &&
      ["host", "player"].includes(r.role) &&
      r.expiresAt > Date.now() &&
      localStorage.getItem(
        r.role === "host"
          ? `technique_quiz_multiplayer_host_token:${r.code}`
          : `technique_quiz_multiplayer_player_id:${r.code}`,
      )
      ? r
      : null;
  } catch {
    return null;
  }
}
export function rememberRoom(room: RecentRoom) {
  try {
    localStorage.setItem(key, JSON.stringify(room));
  } catch {
    /* storage unavailable */
  }
}
export function forgetRoom() {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

export function useRecentRoom() {
  const [room, setRoom] = useState(recentRoom);
  useEffect(() => {
    if (!room) return;
    let disposed = false;
    let ticket = "";
    try {
      ticket = localStorage.getItem(`technique_admission:${room.role}:${room.code}`) ?? "";
    } catch {
      /* unavailable */
    }
    void fetch(apiUrl(`/parties/main/${room.code}?ticket=${encodeURIComponent(ticket)}`), {
      signal: AbortSignal.timeout(5000),
    })
      .then(async (response) => {
        if (!response.ok) return; // Keep the recovery link during temporary connection or admission failure.
        const status = (await response.json()) as { phase: string };
        if (!disposed && status.phase === "expired") {
          forgetRoom();
          setRoom(null);
        }
      })
      .catch(() => {
        /* Offline users should still see their recovery link. */
      });
    return () => {
      disposed = true;
    };
  }, [room]);
  return room;
}
