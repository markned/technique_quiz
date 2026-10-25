type EndpointOptions = { origin: string; configured?: string; development: boolean };

export function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function resolveMultiplayerEndpoint({ origin, configured, development }: EndpointOptions): {
  host: string;
  protocol: "ws" | "wss";
} {
  const page = new URL(origin);
  const raw = configured?.trim();
  let endpoint = raw ? new URL(/^(?:https?|wss?):\/\//i.test(raw) ? raw : `${page.protocol}//${raw}`) : page;
  // A phone must never connect to its own localhost, even with an old .env.local.
  if (development && isLoopbackHost(endpoint.hostname) && !isLoopbackHost(page.hostname)) endpoint = page;
  return { host: endpoint.host, protocol: ["https:", "wss:"].includes(endpoint.protocol) ? "wss" : "ws" };
}

export function partySocketOptionsFromEnv() {
  let simulationServer: string | undefined;
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search);
    const candidate = params.get("simClient") && params.get("simServer");
    if (candidate) {
      try {
        const url = new URL(candidate);
        if (isLoopbackHost(url.hostname)) simulationServer = url.origin;
      } catch {
        /* invalid preview server */
      }
    }
  }
  return resolveMultiplayerEndpoint({
    origin: window.location.origin,
    configured:
      simulationServer || import.meta.env.VITE_MULTIPLAYER_SERVER_URL || import.meta.env.VITE_PARTYKIT_HOST,
    development: import.meta.env.DEV,
  });
}

export function publicGameOrigin(): string {
  if (import.meta.env.DEV && isLoopbackHost(window.location.hostname)) {
    return import.meta.env.VITE_LOCAL_NETWORK_ORIGIN || window.location.origin;
  }
  return window.location.origin;
}
