import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PartySocket from "partysocket";
import type { ClientMessage } from "./messages";
import type { PublicRoomState, RoomCode, ServerMessage } from "./types";
import { getKnownPlayerId, getOrCreateClientId, getOrCreateHostToken, rememberPlayerId } from "./identity";
import { partySocketOptionsFromEnv } from "./env";

type Role = "host" | "player";

type UsePartyRoomOptions = {
  code: RoomCode;
  role: Role;
  playerName?: string;
  enabled?: boolean;
};

type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function usePartyRoom({ code, role, playerName, enabled = true }: UsePartyRoomOptions) {
  const clientId = useMemo(() => getOrCreateClientId(), []);
  const hostToken = useMemo(() => (role === "host" ? getOrCreateHostToken(code) : null), [code, role]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [state, setState] = useState<PublicRoomState | null>(null);
  const [you, setYou] = useState<Extract<ServerMessage, { type: "snapshot" }>["you"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<PartySocket | null>(null);
  const joinedRef = useRef<string>("");

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  const sendHello = useCallback(() => {
    if (role === "host" && hostToken) {
      send({ type: "host_hello", clientId, hostToken });
      return;
    }
    const name = playerName?.trim();
    if (!name) return;
    const joinKey = `${code}:${name}`;
    if (joinedRef.current === joinKey) return;
    joinedRef.current = joinKey;
    send({
      type: "player_join",
      clientId,
      name,
      knownPlayerId: getKnownPlayerId(code),
    });
  }, [clientId, code, hostToken, playerName, role, send]);

  useEffect(() => {
    if (!enabled) return undefined;
    const { host, protocol } = partySocketOptionsFromEnv();
    const socket = new PartySocket({
      host,
      protocol,
      party: "main",
      room: code,
    });
    socketRef.current = socket;
    setStatus("connecting");
    setError(null);

    socket.addEventListener("open", () => {
      setStatus("connected");
      sendHello();
    });
    socket.addEventListener("close", () => setStatus("disconnected"));
    socket.addEventListener("error", () => {
      setStatus("disconnected");
      setError("Не удалось подключиться к комнате. Проверь PartyKit сервер.");
    });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.type === "snapshot") {
          setState(message.state);
          setYou(message.you);
          if (message.you.playerId) rememberPlayerId(code, message.you.playerId);
          setError(null);
        } else {
          setError(message.message);
        }
      } catch {
        setError("Сервер прислал нечитаемое сообщение.");
      }
    });

    return () => {
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [code, enabled, sendHello]);

  useEffect(() => {
    if (status === "connected") sendHello();
  }, [sendHello, status]);

  return {
    clientId,
    status,
    state,
    you,
    error,
    send,
  };
}
