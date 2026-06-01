export function partySocketOptionsFromEnv(): { host: string; protocol: "ws" | "wss" } {
  const raw =
    import.meta.env.VITE_PARTYKIT_HOST || import.meta.env.VITE_MULTIPLAYER_SERVER_URL || "localhost:1999";
  const hasProtocol = /^https?:\/\//i.test(raw);
  const url = hasProtocol ? new URL(raw) : null;
  const host = url ? url.host : raw.replace(/^wss?:\/\//i, "").replace(/\/.*$/, "");
  const protocol: "ws" | "wss" =
    raw.startsWith("wss://") ||
    raw.startsWith("https://") ||
    (!raw.includes("localhost") && window.location.protocol === "https:")
      ? "wss"
      : "ws";
  return { host, protocol };
}
