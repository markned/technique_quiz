# Playtest Multiplayer

Use this runbook to manually verify the PartyKit multiplayer flow.

1. Install dependencies with `npm install`.
2. Use Node 20 or newer: `nvm use` from the repo root.
3. Start the frontend: `npm run dev -- --host 127.0.0.1`.
4. In a second terminal, start PartyKit: `npm run party:dev`.
5. Open the host page at `http://127.0.0.1:18768/room/E2EQA1/host`.
6. Open three player pages:
   - `http://127.0.0.1:18768/join/E2EQA1`
   - use three separate browser contexts or profiles if possible.
7. Join as three names, confirm they appear in the host lobby, then click `К выбору режима`.
8. Test Quiz:
   - choose `Викторина`;
   - pass the controls screen;
   - answer the first round on each player device;
   - verify the host shows correct answer, per-round results, and leaderboard.
9. Test Freestyle in a new room like `E2EFA1`:
   - choose `Фристайл`;
   - submit three text answers;
   - verify voting is anonymous and each player cannot see/vote for their own answer;
   - verify original answer is shown only after voting and similarity bonus appears.
10. Run automated checks: `npm run lint`, `npm run test`, `npm run build`, `npm run test:e2e`.
11. Capture failures with browser console logs, PartyKit terminal logs, and Playwright traces from `test-results/`.
