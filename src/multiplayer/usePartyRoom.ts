import { useAdmission } from "./useAdmission";
import { rememberRoom } from "../navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PartySocket from "partysocket";
import { useSimulation } from "../dev/useSimulation";
import { simulationClient } from "../dev/simulationContext";
import type { ClientMessage } from "./messages";
import type { PublicRoomState, RoomCode, ServerMessage } from "./types";
import {
  adoptHostToken,
  getKnownPlayerId,
  getOrCreateClientId,
  getOrCreateHostToken,
  getOrCreatePlayerToken,
  rememberPlayerId,
} from "./identity";
import { partySocketOptionsFromEnv } from "./env";

type UsePartyRoomOptions = {
  code: RoomCode;
  role: "host" | "player";
  playerName?: string;
  enabled?: boolean;
};
type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function usePartyRoom({ code, role, playerName, enabled = true }: UsePartyRoomOptions) {
  const clientId = useMemo(() => getOrCreateClientId(), []);
  const hostToken = useMemo(() => {
    if (role !== "host") return null;
    adoptHostToken(code);
    return getOrCreateHostToken(code);
  }, [code, role]);
  const playerToken = useMemo(() => getOrCreatePlayerToken(code), [code]);
  const admission = useAdmission(code, role, clientId, enabled);
  const [left, setLeft] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [state, setState] = useState<PublicRoomState | null>(null);
  const [you, setYou] = useState<Extract<ServerMessage, { type: "snapshot" }>["you"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<PartySocket | null>(null);
  const authenticated = useRef(false);
  const serverOffset = useRef(0);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !authenticated.current) return false;
    // Never queue game actions across disconnects: they may belong to a finished round.
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  useEffect(() => {
    if (!enabled || !admission.ticket) return;
    const { host, protocol } = partySocketOptionsFromEnv();
    const socket = new PartySocket({
      host,
      protocol,
      party: "main",
      room: code,
      query: { ticket: admission.ticket },
      connectionTimeout: 10_000,
      maxReconnectionDelay: 5_000,
    });
    socketRef.current = socket;
    authenticated.current = false;
    setStatus("connecting");
    setState(null);
    setYou(null);
    setError(null);
    let lastReceivedAt = Date.now();
    let pingSentAt = 0;
    let clockInitialized = false;
    let disposed = false;
    let failures = 0;

    socket.addEventListener("open", () => {
      if (disposed) return;
      authenticated.current = false;
      lastReceivedAt = Date.now();
      setStatus("connecting");
      const hello: ClientMessage | null =
        role === "host" && hostToken
          ? { type: "host_hello", clientId, hostToken }
          : playerName?.trim()
            ? {
                type: "player_join",
                clientId,
                name: playerName.trim(),
                knownPlayerId: getKnownPlayerId(code),
                playerToken,
              }
            : null;
      if (hello) socket.send(JSON.stringify(hello));
    });
    socket.addEventListener("close", () => {
      if (disposed) return;
      authenticated.current = false;
      setStatus("disconnected");
    });
    socket.addEventListener("error", () => {
      if (disposed) return;
      authenticated.current = false;
      if (++failures >= 5) admission.invalidate();
      setStatus("disconnected");
      setError("Не удалось подключиться к комнате. Восстанавливаем связь…");
    });
    socket.addEventListener("message", (event) => {
      if (disposed) return;
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        lastReceivedAt = Date.now();
        if (message.type === "player_left") {
          setLeft(true);
          socket.close();
          return;
        }
        if (message.type === "snapshot") {
          // Ignore the initial spectator snapshot until the server accepts our identity.
          if (message.you.role === "spectator" && message.state.phase !== "expired") return;
          authenticated.current = message.you.role !== "spectator";
          failures = 0;
          setStatus("connected");
          if (message.state.phase !== "expired" && !simulationClient())
            rememberRoom({ code, role, expiresAt: message.state.expiresAt });
          if (!clockInitialized && message.serverNow) {
            serverOffset.current = message.serverNow - Date.now();
            clockInitialized = true;
          }
          if (pingSentAt && message.serverNow) {
            serverOffset.current = message.serverNow - (pingSentAt + Date.now()) / 2;
            pingSentAt = 0;
          }
          const shift = (value: number | null) => (value == null ? null : value - serverOffset.current);
          setState({
            ...message.state,
            pausedAt: shift(message.state.pausedAt),
            replay: message.state.replay
              ? {
                  ...message.state.replay,
                  startedAt: shift(message.state.replay.startedAt),
                  endsAt: shift(message.state.replay.endsAt),
                }
              : null,
            deadlineAt: shift(message.state.deadlineAt),
            transitionUntil: shift(message.state.transitionUntil),
            nextAdvanceAt: shift(message.state.nextAdvanceAt),
            playingStartedAt: shift(message.state.playingStartedAt),
            backgroundStartedAt: shift(message.state.backgroundStartedAt),
            initialVote: message.state.initialVote
              ? {
                  ...message.state.initialVote,
                  decision: message.state.initialVote.decision
                    ? {
                        ...message.state.initialVote.decision,
                        startsAt: shift(message.state.initialVote.decision.startsAt)!,
                      }
                    : null,
                }
              : null,
            finalVote: message.state.finalVote
              ? {
                  ...message.state.finalVote,
                  decision: message.state.finalVote.decision
                    ? {
                        ...message.state.finalVote.decision,
                        startsAt: shift(message.state.finalVote.decision.startsAt)!,
                      }
                    : null,
                }
              : null,
          });
          setYou((previous) => ({
            ...message.you,
            reconnected: message.you.reconnected || !!previous?.reconnected,
          }));
          if (message.you.playerId) rememberPlayerId(code, message.you.playerId);
          setError(null);
        } else if (message.type === "error") {
          setError(message.message);
          if (
            ["session_replaced", "host_conflict", "room_expired", "invalid_room", "room_full"].includes(
              message.code,
            )
          ) {
            authenticated.current = false;
            socket.close();
          }
        }
      } catch {
        setError("Сервер прислал нечитаемое сообщение.");
      }
    });
    const heartbeat = window.setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastReceivedAt > 30_000) {
        authenticated.current = false;
        setStatus("disconnected");
        socket.reconnect();
      } else if (authenticated.current) {
        pingSentAt = Date.now();
        socket.send(JSON.stringify({ type: "ping" }));
      }
    }, 10_000);
    return () => {
      disposed = true;
      window.clearInterval(heartbeat);
      socket.close();
      if (socketRef.current === socket) {
        socketRef.current = null;
        authenticated.current = false;
      }
    };
  }, [clientId, code, enabled, hostToken, playerName, playerToken, role, admission.ticket]);

  useSimulation(state, you?.playerId, role, send);
  return { admission, clientId, status, state, you, error, send, left };
}
