# Multiplayer release review

Reviewed the room engine and transport, player identity and private snapshots, initial/final ballots, membership changes, community permissions/body handling, frontend routing and Pages publication setup.

## Findings addressed

- Host commands could bypass player ballots. Deprecated `host_select_mode` and `host_restart_game` now return an error; clients control mode ballots and the server resolves them.
- New participants could change the roster after a mode was decided. Membership is locked on a decision and during the game, while authenticated reconnection remains available. A cancelled decision releases the lock so a deficient room can recover.
- Snapshots included unrevealed lyric lines. Before results, the public round now contains only hint lines; personal submissions and votes are sent only to their authenticated owner. A regression test covers host, player and spectator snapshots.
- A slow request body held the shared community mutation queue. Bodies now have a streaming byte cap and timeout and are read before entering that queue. Uploads have a separate queue to bound memory; account permissions are checked again when committed.
- Updated the production Zod dependency to its patched compatible version after the dependency audit identified an oversized-collection validation issue. The production dependency audit now reports zero vulnerabilities.
- Pages could publish with an absent backend address. Main-branch publication now requires a valid HTTPS origin and the production Worker's health response. Pull requests run source/build/browser checks without publishing.

## Acceptance evidence

- 55 unit tests passed after these changes, including quorum 2/3, initial skip, client majority/tie handling, restart/reconnect, membership locking, private answer restoration, body limits and deploy configuration validation.
- Accelerated real-connection run with 2 players: 14 quiz rounds, no initial ballot.
- Following real-connection run with 3 players: initial ballot, 14 quiz rounds, final ballot and 8 freestyle rounds in the same room.
- Manual fresh-session entry from the home page succeeded, and refresh restored the same player.
- Frontend build, formatting/lint and Worker deployment dry-run passed locally. GitHub browser checks are additionally run on the PR.

## Remaining limits

The singleplayer game intentionally ships its static round catalog and media publicly. Redacting room snapshots is not a complete anti-cheat system against someone inspecting those public assets. Server-side scoring and ownership checks remain authoritative.

Production infrastructure is not yet verified: Wrangler is not authenticated to Cloudflare, the live Worker/R2 have not been deployed by this task, and the GitHub backend variable could not be inspected through the available connector. Password recovery and orphaned-media cleanup remain documented limitations of the initial community editor.

The full dependency audit still reports 14 findings in development tooling (1 low, 6 moderate, 7 high). These are not included in the production dependency tree; resolving major tooling upgrades remains separate work.
