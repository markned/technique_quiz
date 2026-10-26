# Verification and project skills

Use Node24 (`.nvmrc`); minimum22.14. Run `npm ci` after dependency changes.

- Quick: `npm run verify:quick` selects deterministic checks from working changes. Add `-- --base origin/main` to include committed branch changes, or `-- --plan` to inspect selection.
- Multiplayer: `npm run verify:multiplayer` runs unit, browser and Worker checks.
- Release: `npm run verify:release` runs full formatting, lint, unit, build, Worker dry-run, browser and local load checks. It never deploys.
- Add `-- --fresh` after browser/runtime/environment changes. Successful checks are cached only for the same repository/runtime fingerprint. Logs and receipts live in ignored `.cache/qa/`.

Start an isolated accelerated local backend with `npm run party:test`. The load runner defaults to `ws://localhost:1999`; override `MULTIPLAYER_LOAD_URL` only with a loopback test server. It exercises ten rooms, one hundred players and fifty reconnects. Fast fixture codes require TEST_MODE and an E2E prefix; ordinary party:dev and production retain normal timing. Never stress production or delete the user's development state to reset tests.

Playwright Test remains the automated suite; CI installs Chromium and retains traces on failures. Locally, install its browser with `npx playwright install chromium` or use the existing Chrome with `PLAYWRIGHT_CHANNEL=chrome npm run verify:release`. Type checks include test/E2E sources through `npm run typecheck:qa`. Use semantic locators, isolated sessions and geometry assertions for representative phones and desktop hosts. A codec/autoplay error is distinct from an authoritative state failure. Local browser automation cannot establish actual Discord streaming latency.

Interactive browser tooling must follow the active Codex environment's policy. The official https://github.com/microsoft/playwright-cli was evaluated; do not install an overlapping browser controller in sessions restricted to CUA. Use CUA for interactive investigation here and the existing Test suite in authorized automated environments. No Artillery, CodeRabbit, Superpowers bundle or Sentry is required.

Discoverable workflows are in `.agents/skills/`: multiplayer-qa, game-code-review, code-change-verification, systematic-debugging and docs-sync. Legacy `.codex` notes route here. Keep root AGENTS.md short. CI retains its existing single workflow and production protections; heavy load is explicit Release work, not every small PR.
