---
name: game-code-review
description: Review changes to Technique Quiz gameplay, room protocol, authentication and persistence.
---

Start with changed files and direct callers. Trace affected transitions through src/multiplayer/messages.ts, server/room.ts and party/server.ts. Check authoritative scores, identity/token binding, host privilege, duplicate/stale actions, concurrent disconnect/reconnect, hibernation persistence, alarms and cleanup. Inspect snapshots for unrevealed lyrics, correct answers or other players' private submissions. Check quotas/authorization for community changes. Report only evidenced actionable defects with severity, absolute file and line, trigger and impact. Do not manufacture findings or rescan unrelated files.
