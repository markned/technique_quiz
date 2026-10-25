# Release checklist

## GitHub checks

The pull request runs formatting, lint, unit tests, Worker dry-run, browser tests and a production frontend build on Node 24. Pull requests do not publish Pages. Publication from main additionally requires a reachable production Worker health endpoint.

## Production prerequisites

1. Authenticate Wrangler to the intended Cloudflare account and enable R2.
2. Create the R2 bucket `technique-quiz-media` if it does not already exist. `wrangler.jsonc` binds it as `Media` and declares both SQLite Durable Object migrations.
3. Deploy the backend with `npm run party:deploy`. Keep `TEST_MODE=false` and `APP_ORIGIN=https://technique.ink`.
4. Check the deployed Worker's `/health`. It must return `ok: true`, `service: technique-quiz`, `testMode: false` and `appOrigin: https://technique.ink`.
5. Set GitHub repository variable `MULTIPLAYER_SERVER_URL` to that Worker's HTTPS origin, without a path. The Pages publication job rejects missing, local, invalid or unhealthy endpoints.
6. Configure GitHub Pages to deploy through GitHub Actions. Merge the reviewed PR only after backend health is confirmed.
7. If community authoring is enabled, temporarily set `ADMIN_SETUP_SECRET`, run the moderator setup described in README, then remove that secret. Invite authors through the moderator interface.

Backend deployed on 2026-10-25: `https://technique-quiz.markned.workers.dev`. Workers Free was confirmed in the dashboard; the dedicated R2 Standard bucket was created empty with public access disabled. `/health` and `/api/catalog` passed, and GitHub variable `MULTIPLAYER_SERVER_URL` was configured. Pages already uses GitHub Actions and the `technique.ink` custom domain.

See [free-tier protection](FREE_TIER.md) for persistent R2 caps and account-wide billing limitations. The static frontend alone cannot host WebSocket rooms or the community API.

## Reproduce the local acceptance tests

- `npm ci`, `npm run format:check`, `npm run lint`, `npm test`, `npm run build`, `npm run server:check`.
- Start the normal frontend and backend as documented in README. The normal game uses real media and timings.
- For the full accelerated scenario, start the isolated test backend on 2001 using the README command and open `/simulate?fast=1`.
- First select 2 players and run: all 14 quiz rounds finish; there is no initial ballot, and freestyle is unavailable.
- Then select 3 players and run: clients vote for quiz, all 14 quiz rounds finish, clients vote for freestyle and all 8 freestyle rounds finish in the same room.
- Optional observer: `node scripts/observe-multiplayer-sequence.mjs ROOM_CODE 2` or `3`. It checks the full round counts, initial skip/ballot, roster count and final mode switch without submitting actions.
- From a fresh browser session: home → Start → skip intro → Multiplayer → enter room code → enter name → Play. Confirm the host sees the player. Refresh the player and verify the same seat returns.

## Before announcing the release

Check the deployed domain on separate devices: room creation, joining from home and via a link, initial voting, two-player quiz, three-player freestyle, player refresh, host recovery, personal results and final voting. Validate Discord streaming with sound in an actual voice call; local acceleration does not test Discord latency or production network quality.
