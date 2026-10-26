/** Separate browser identities only; admission and server permissions still apply normally. */
export function simulationClient(): string | null {
  const client = new URLSearchParams(window.location.search).get("simClient");
  return client && /^[A-Za-z0-9_-]{1,64}$/.test(client) ? client : null;
}

export function simulationStorageKey(key: string): string {
  const client = simulationClient();
  return client ? `simulation:${client}:${key}` : key;
}
