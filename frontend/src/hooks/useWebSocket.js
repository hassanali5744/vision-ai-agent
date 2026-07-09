import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  connectWebSocket,
  disconnectWebSocket,
  getWebSocketStatus,
  sendWebSocketMessage,
  subscribeToWebSocket,
} from "../services/websocket";

export default function useWebSocket(sessionId = "default") {
  const [status, setStatus] = useState("disconnected");
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const lastSessionRef = useRef(sessionId);

  useEffect(() => {
    if (lastSessionRef.current !== sessionId) {
      lastSessionRef.current = sessionId;
    }

    const unsubscribe = subscribeToWebSocket((eventName, payload) => {
      if (eventName === "status") {
        setStatus(payload);
        setConnected(payload === "connected");
      }

      if (eventName === "message") {
        setLastMessage(payload);
      }
    });

    connectWebSocket(sessionId);

    return () => {
      unsubscribe();
      disconnectWebSocket();
    };
  }, [sessionId]);

  const sendMessage = useCallback((payload) => {
    if (!payload || typeof payload !== "object") {
      return false;
    }

    const message = {
      ...payload,
      timestamp: payload.timestamp || new Date().toISOString(),
    };

    return sendWebSocketMessage(message);
  }, [sessionId]);

  return useMemo(
    () => ({
      status,
      connected,
      lastMessage,
      sendMessage,
    }),
    [status, connected, lastMessage, sendMessage]
  );
}
