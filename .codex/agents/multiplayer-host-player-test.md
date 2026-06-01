# Multiplayer Host/Player Test Agent

Goal: run a repeatable multiplayer verification with one host and three player pages.

Steps:

1. Ensure dependencies are installed: `npm install`.
2. Ensure Node 20+: `nvm use`.
3. Start services:
   - frontend: `npm run dev -- --host 127.0.0.1`;
   - backend: `npm run party:dev`.
4. Use Playwright or Browser automation to open:
   - host: `http://127.0.0.1:18768/room/E2EAT1/host`;
   - players: `http://127.0.0.1:18768/join/E2EAT1`.
5. Join as Alice, Bob, and Cara.
6. Verify lobby shows 3/10 players and mode select is enabled.
7. Play quiz:
   - choose `Викторина`;
   - advance controls;
   - answer the known first E2E round correctly on all players;
   - verify `Верно: 3` and leaderboard.
8. Test reconnect:
   - refresh host and one player;
   - verify no duplicate players and score persists.
9. Use a new room `E2EAF1` for freestyle:
   - submit one answer similar to original and two different answers;
   - verify self-vote is unavailable;
   - vote, reveal original, and verify similarity bonus.
10. Finish by running:
   - `npm run lint`;
   - `npm run test`;
   - `npm run build`;
   - `npm run test:e2e`.
11. Report failing selectors, browser console output, PartyKit logs, and Playwright trace paths.
