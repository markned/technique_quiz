import { useEffect, useState } from "react";
import { apiUrl } from "../community/api";
type Turnstile = {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
  reset(id: string): void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
let scriptReady: Promise<void> | undefined;
export function loadScript() {
  return (scriptReady ??= new Promise<void>((resolve, reject) => {
    if (window.turnstile) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptReady = undefined;
      reject(new Error("Не удалось загрузить проверку."));
    };
    document.head.appendChild(script);
  }));
}
const storageKey = (code: string, role: string) => `technique_admission:${role}:${code}`;
function saved(code: string, role: string) {
  try {
    const value = localStorage.getItem(storageKey(code, role));
    if (!value) return "";
    const payload = JSON.parse(atob(value.split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/")));
    return payload.expiresAt > Date.now() + 60_000 ? value : "";
  } catch {
    return "";
  }
}
export function useAdmission(code: string, role: "host" | "player", clientId: string, enabled: boolean) {
  const [ticket, setTicket] = useState(() => saved(code, role));
  const [sitekey, setSitekey] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || ticket) return;
    let disposed = false;
    void fetch(apiUrl("/api/security/config"), { signal: AbortSignal.timeout(8000) })
      .then(async (r) => {
        if (!r.ok) throw new Error("Вход временно недоступен. Попробуй позже.");
        const config = (await r.json()) as { required: boolean; sitekey?: string };
        if (disposed) return;
        if (config.required === false) setTicket("local");
        else if (config.sitekey) setSitekey(config.sitekey);
        else throw new Error("Защита входа ещё настраивается.");
      })
      .catch((e) => {
        if (!disposed) setError(String(e.message));
      });
    return () => {
      disposed = true;
    };
  }, [enabled, ticket, attempt]);
  const solve = async (token: string) => {
    try {
      const r = await fetch(apiUrl("/api/admission"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, room: code, role, token }),
        signal: AbortSignal.timeout(12000),
      });
      const data = (await r.json()) as { ticket: string; error?: string };
      if (!r.ok) throw new Error(data.error ?? "Проверка не пройдена.");
      try {
        localStorage.setItem(storageKey(code, role), data.ticket);
      } catch {
        /* private browsing */
      }
      setError("");
      setTicket(data.ticket);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Повтори проверку.");
      throw e;
    }
  };
  return {
    ticket,
    sitekey,
    error,
    solve,
    retry: () => {
      setError("");
      setSitekey("");
      setAttempt((v) => v + 1);
    },
    invalidate: () => {
      try {
        localStorage.removeItem(storageKey(code, role));
      } catch {
        /* private browsing storage unavailable */
      }
      setTicket("");
      setSitekey("");
    },
  };
}
