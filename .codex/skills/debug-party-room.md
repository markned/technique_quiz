# Debug Party Room

Use this when room state, phase transitions, or player messages look wrong.

1. Confirm the PartyKit server is running with `npm run party:dev`.
2. Open the room health endpoint in a browser or with curl:
   - `http://127.0.0.1:1999/parties/main/<ROOM_CODE>`
3. Watch the PartyKit terminal while reproducing the issue.
4. Use deterministic E2E room codes beginning with `E2E` to shorten timers and force predictable first rounds.
5. Inspect the latest frontend state from the host/player UI:
   - host lobby should show room code, player count, and connected/disconnected state;
   - player UI should show reconnect/restoring or the current controller state.
6. If a message is ignored, check `src/multiplayer/messages.ts` first; invalid messages are rejected before room logic runs.
7. If scoring is wrong, check `src/multiplayer/scoring.ts` for quiz/leaderboard and `src/multiplayer/similarity.ts` for freestyle bonus.
8. If local state seems stale, stop `party:dev` and remove `.partykit/`, then restart.
