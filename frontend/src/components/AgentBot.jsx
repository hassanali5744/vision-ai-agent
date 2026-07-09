import { useMemo } from "react";
import useWebSocket from "../hooks/useWebSocket";

export default function AgentBot() {
    const sessionId = "voice-demo";
    const { status, connected } = useWebSocket(sessionId);

    const statusLabel = useMemo(() => {
        if (connected) return "Connected";
        if (status === "connecting") return "Connecting";
        return "Disconnected";
    }, [connected, status]);

    const statusTone = connected ? "#16a34a" : status === "connecting" ? "#d97706" : "#dc2626";

    return (
        <div className="agent-bot-card">
            <h4>Backend LiveKit Agent</h4>
            <p className="muted">
                Start the backend agent worker before joining to let the room agent greet you instantly.
            </p>
            <code>cd backend &amp;&amp; python app/agent.py dev</code>
            <p className="muted">
                When you connect, the backend dispatches the onboarding agent into your room. It will greet you and guide the conversation naturally.
            </p>

            <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ width: "10px", height: "10px", borderRadius: "999px", background: statusTone }} />
                <strong>WebSocket: {statusLabel}</strong>
            </div>

            <p className="muted" style={{ marginTop: "8px" }}>
                Status: {status}
            </p>
        </div>
    );
}
