# Verify Reconnect

Use this to verify transparent host/player reconnect.

1. Start Vite and PartyKit locally.
2. Open `http://127.0.0.1:18768/room/E2ERC1/host`.
3. Join three players from separate browser contexts at `http://127.0.0.1:18768/join/E2ERC1`.
4. Start quiz mode and answer at least one round.
5. Refresh the host page:
   - host should reconnect to the same room;
   - room code, players, scores, and phase should remain.
6. Refresh one player page:
   - player should not duplicate in the lobby/player list;
   - name, score, answers/votes, and controller phase should remain.
7. Close one player tab and confirm host marks the player as disconnected.
8. Reopen the same player URL in the same browser context and confirm the player returns as connected.
9. Run `npm run test:e2e` for automated coverage of host/player reconnect and main flows.
