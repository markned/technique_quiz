# Online matches

Multiplayer has two independent session formats. Shared screen retains its host, audio readiness and pause behavior. Online matches are created only by the server coordinator; no client flag grants host privileges or changes a shared-screen room's format.

## Flow

`/online` asks for a nickname and a separate queue-admission ticket. Search reserves a seat and returns a player-only ticket for the assigned room. `/online/CODE` uses the existing authenticated player protocol and persistent reconnect token.

The queue fills lobbies up to six. Once at least two are connected, there are 15 seconds to confirm Ready. The Ready gesture primes the same audio element later used for tracks. When all connected players are ready, the roster locks immediately. At timeout, unready participants return to search; if fewer than two confirmed, everyone returns to search.

Two players automatically play quiz. Three or more vote between quiz and freestyle for up to 15 seconds; majority can finish early, a positive tie uses a server lottery, and no votes defaults to quiz. The server owns five rounds for either mode.

Each client loads the fragment during transition, up to 15 seconds. Ready clients play at a shared future timestamp with the existing server-clock estimate. A client missing the loading deadline or reporting playback failure cannot answer/vote that round. With no loaded client the match ends early. Playback/seek failure is visible and can be unlocked for subsequent rounds. Media readiness is a client capability signal, not a proof that a human listened.

Replay is personal: its permission and cooldown are server-checked, its timestamps appear only in the requesting player's private snapshot, and neither the shared answer deadline nor anyone else's playback changes. Cooldown is the fragment length. A submitted answer cannot request another replay.

The game keeps running when a player opens the menu or disconnects. A token-bound player can reconnect until the match ends. No new participants join after roster lock. If connected membership is below two (quiz) or three (freestyle), a 30-second grace period runs without pausing stage clocks. Failure to restore quorum ends the match without declaring a winner, preserving points from completed rounds.

After the final round, players may request a same-company rematch, find new opponents or return to the menu. A rematch has a 15-second acceptance limit; a ready quorum returns to mode choice. If fewer than two accept, return to search. Final standings are not rewritten when a participant leaves the results screen.

Online freestyle ballots use opaque per-round submission IDs and no submission timestamps. Own ballot IDs are private so a client can hide its own answer. Server voting maps these IDs to their owners and still rejects self-votes and duplicates. Author identities and similarity bonuses are revealed only in round results. No reports, block list, chat, account ranking or user registration is added.

## Infrastructure and limits

`OnlineCoordinator` is a new SQLite Durable Object binding (`Online`) in each configured environment, migration `v3`. Game rooms remain existing hibernating `TechniqueQuizRoom` objects with an explicit persisted online policy. Existing rooms without that policy remain shared-screen sessions.

The coordinator serializes assignments and persists a bounded registry: at most 600 active assignments, a 5-second new-search cooldown per identity and at most 200 newly created online rooms per UTC day per environment. Expired registry entries are cleaned by alarm. Full lobbies stay discoverable until closed or expired; stale reservations cannot enter a roster that has locked. The general HTTP/socket rate limits and R2 budgets remain unchanged. This uses no new paid service or account plan, and does not claim to bound unrelated account usage.

Queue tickets have purpose `queue-admission-v1`; ordinary room tickets have purpose `room-admission-v1`. Both bind client ID, expiry and intended destination. A queue ticket is not a room ticket; a host ticket is not accepted for search. Internal reservation/release calls are reachable only through the Worker binding, never public room URLs. Player/host tokens, queue assignments and alias ownership never enter public snapshots.

## Verification and rollout

Run commands from docs/QA.md. `test/room.test.ts` covers hostless lifecycle, privacy, audio eligibility, replay deadlines, quorum recovery and rematches. `test/matchmaking.test.ts` covers capacity, recovery, rotation and budgets. `test/security.test.ts` verifies the queue/room admission boundary. `e2e/online.spec.ts` enters through search and covers both modes, five rounds, reconnect, readiness timeout and real media loading.

Test-mode queues isolate E2E_ accelerated clients and QA_REAL_ real-media clients from ordinary manual sessions. Production always uses the public queue, regardless of client prefix. Accelerated online browser fixtures require both a test-mode backend and an E2E_-prefixed client ID; they generate E2E room codes. Audio skipping additionally requires a development/private frontend. Ordinary local/production clients retain real loading and timing. The test suite also includes a normal-timing case using actual audio loads and the Ready gesture.

Deployment is a separate authorized step: first apply the Worker binding/migration with the existing deployment process, then publish frontend assets including `content/audio/unlock.wav`. No deployed resources or production data are modified by verification. Rolling back the frontend alone does not remove the new namespace or online rooms; preserve both formats during rollout.
