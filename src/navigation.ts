import { useEffect, useState } from "react";
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
export type RecentRoom = { code: string; role: "host" | "player"; expiresAt: number };
const key = "technique_quiz_recent_room";
export function recentRoom(): RecentRoom | null {
  try {
    const r = JSON.parse(localStorage.getItem(key) ?? "null");
    return r &&
      /^[A-Z0-9]{6}$/.test(r.code) &&
      ["host", "player"].includes(r.role) &&
      r.expiresAt > Date.now()
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
