---
name: multiplayer-qa
description: Run multiplayer gameplay, recovery, privacy and responsive checks for Technique Quiz.
---

Use existing test/room.test.ts and e2e/multiplayer.spec.ts before adding scenarios. Read docs/QA.md for commands and artifacts. Run `npm run verify:multiplayer`; use isolated player sessions. Check quiz quorum2, freestyle quorum3, initial/final votes, anonymous submissions, no self-vote, consistent scores, pause/replay, stale sockets and reconnect identity. Prefer deterministic room tests for races; browser tests for actual rendering/media. Report failed assertions and artifact paths, not full traces. Load tests are local only; never infer production capacity or Discord latency from them.
