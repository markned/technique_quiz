# Pause, replay, navigation and room admission

## Gameplay

- Host manual pause freezes server deadlines, audio, synchronized backgrounds and lyric reveal. It is distinct from connection/media failure and survives host reconnect. Only an authenticated host can resume it.
- Unanswered players may request a shared replay during quiz answers or freestyle submission. The server reserves one replay per room. The answer countdown is held, and remains held while host media is loading; a 30-second loading timeout pauses the room. A ready acknowledgement contains the replay ID so stale audio events cannot shorten the wait.
- Cooldown equals the fragment duration. Answers remain accepted during replay. Completing all answers cancels it and advances; already-answered players cannot request it. No replay during voting/results. Pausing a replay shifts its timestamps on resume.
- Clients and host calculate line reveal from the same server-adjusted timeline, without sending a socket message for each line. Current source lyrics use evenly spaced hints, not word-level timestamps.

## Menus

Rules and controls use readable responsive text, scrolling content and pinned actions instead of shrinking to 8px. Room menus, return to lobby, participant exit, recent-room recovery and home history are explicit. The singleplayer final screen distinguishes replay from menu. Editor departure offers saving or discarding changes; closing a tab uses a native browser warning.

## Security boundaries

Production admission uses managed Turnstile (`room_access`) with exact action and hostname checks through server-side Siteverify. A signed 24-hour ticket binds client identity, role and room; it is separate from the existing host/player session secrets. Tickets allow ordinary reconnect without another challenge. Production never trusts local/test query parameters. Origin is checked for HTTP and WebSocket upgrades. Turnstile does not replace authorization.

Rate limiting bounds HTTP bursts per IP (with headroom for shared Wi-Fi), socket messages (40 per 10 seconds per connection, persisted across hibernation) and simultaneous room sockets (24). Invalid or oversized messages are rejected. Admission is checked before routing to a room Durable Object. Static production HTML has a hash-based script CSP, no object embedding, restricted connections/frames and no executable user HTML. Worker HTTP responses add nosniff/referrer/frame restrictions. Existing schemas, ownership checks, bounded uploads and R2 reservations remain active.

Cloudflare's managed DDoS mitigation and these application limits reduce abuse; neither guarantees availability during every distributed attack. The frontend remains on GitHub Pages; no claim is made that zone-level Cloudflare WAF rules protect that domain. No paid security plan is enabled.

## Private testing

`npm run build:test` builds an isolated frontend for `technique-quiz-test.markned.workers.dev`; `wrangler deploy --env private` deploys it. The entire server, static assets, APIs and sockets require a signed HttpOnly Secure cookie issued by the password gate. With no `TEST_GATE_SECRET`, the private server fails closed. Localhost development is the only unauthenticated bypass.

The owner's generated access credential and one-click HTML entry file live only in `.codex-private/` (ignored by Git, directory 0700 / files 0600). Do not publish or share that file. The test Worker has separate room namespaces, R2 bucket and rate namespace. It reuses public production video/audio assets to avoid uploading oversized static files; private community uploads remain in its own R2 bucket. Two 1 GB R2 ledgers and their daily operation caps together remain below the account's R2 Standard free allowances, provided no other applications consume those quotas. See `FREE_TIER.md` for limits and exclusions.

## Cutover

Deploy backend with `ADMISSION_ENFORCED=false` only during the frontend cutover, so existing frontend bundles can reconnect. `/api/security/config` still asks new bundles for Turnstile during this short rollout. After Pages is live and verified, redeploy the checked configuration (`ADMISSION_ENFORCED=true`). The flag is server configuration, never a public URL switch. Verify missing-ticket rejection, correct Origin, real human admission, reconnect and private authentication after enabling enforcement.
