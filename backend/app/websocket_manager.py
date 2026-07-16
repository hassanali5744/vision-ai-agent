from __future__ import annotations

import json
import os
import httpx
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket
from starlette.websockets import WebSocketState


class WebSocketManager:
    """Manage real-time WebSocket connections and states by session id."""

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        # Shared state machine; defaults to "Idle"
        self._states: dict[str, str] = defaultdict(lambda: "Idle")

    async def connect(self, session_id: str, websocket: WebSocket) -> None:
        """Accept a WebSocket connection and register it for a session."""
        await websocket.accept()
        self._connections[session_id].add(websocket)
        
        # Send connection confirmation along with the current state of this session
        state = self._states[session_id]
        await websocket.send_json(
            {
                "type": "connection_established",
                "session_id": session_id,
                "status": "connected",
                "state": state,
                "timestamp": self._now_iso(),
            },
        )

    async def disconnect(self, session_id: str, websocket: WebSocket) -> None:
        """Remove a WebSocket connection and close it gracefully if needed."""
        if session_id in self._connections:
            self._connections[session_id].discard(websocket)
            if not self._connections[session_id]:
                del self._connections[session_id]

        if websocket.application_state != WebSocketState.DISCONNECTED:
            try:
                await websocket.close(code=1000)
            except RuntimeError:
                pass

    def get_state(self, session_id: str) -> str:
        """Get the current conversation state for a session."""
        return self._states[session_id]

    async def set_state(self, session_id: str, state: str) -> None:
        """Set the conversation state and broadcast the transition to all session clients."""
        self._states[session_id] = state
        print(f"[WS] State updated for session {session_id}: {state}")
        await self.send_to_session(
            session_id,
            {
                "type": "state_change",
                "state": state,
                "timestamp": self._now_iso(),
            },
        )

    async def send_to_session(self, session_id: str, payload: dict[str, Any]) -> None:
        """Send a JSON payload to every active socket in a session."""
        if session_id not in self._connections:
            return

        dead_connections: list[WebSocket] = []
        for websocket in list(self._connections[session_id]):
            try:
                await websocket.send_json(payload)
            except Exception:
                dead_connections.append(websocket)

        for websocket in dead_connections:
            await self.disconnect(session_id, websocket)

    async def broadcast(self, payload: dict[str, Any]) -> None:
        """Send a JSON payload to every active socket across all sessions."""
        for session_id in list(self._connections.keys()):
            await self.send_to_session(session_id, payload)

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()


websocket_manager = WebSocketManager()


async def emit_agent_event_or_state(session_id: str, event_type: str, data: dict[str, Any]) -> None:
    """Helper to route events locally or forward them to FastAPI via HTTP if running in agent process."""
    if os.getenv("IS_AGENT_PROCESS") == "true":
        # We are in the separate agent process, forward via HTTP POST to FastAPI
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "http://localhost:8000/ws/emit",
                    json={
                        "session_id": session_id,
                        "event_type": event_type,
                        "data": data,
                    },
                    timeout=5.0,
                )
                if response.status_code != 200:
                    print(f"[WARN] Failed to forward agent event: status={response.status_code}")
        except Exception as e:
            print(f"[ERROR] Failed to forward agent event via HTTP: {e}")
    else:
        # Local execution (within FastAPI process)
        if event_type == "state":
            state = data.get("state", "Idle")
            await websocket_manager.set_state(session_id, state)
        else:
            await websocket_manager.send_to_session(
                session_id,
                {
                    "type": "agent_event",
                    "event_type": event_type,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    **data,
                },
            )


async def notify_agent_thinking(session_id: str) -> None:
    await emit_agent_event_or_state(session_id, "state", {"state": "Processing"})


async def notify_agent_speaking(session_id: str, text: str | None = None) -> None:
    # State transitions to Speaking
    await emit_agent_event_or_state(session_id, "state", {"state": "Speaking"})


async def notify_agent_finished_speaking(session_id: str) -> None:
    # State transitions to Idle
    await emit_agent_event_or_state(session_id, "state", {"state": "Idle"})


async def notify_partial_transcript(session_id: str, text: str) -> None:
    await emit_agent_event_or_state(session_id, "partial_transcript", {"text": text})


async def notify_final_transcript(session_id: str, text: str) -> None:
    await emit_agent_event_or_state(session_id, "final_transcript", {"text": text})


async def notify_agent_hold(session_id: str) -> None:
    """Notify frontend that agent is on hold."""
    await emit_agent_event_or_state(session_id, "state", {"state": "Hold"})


async def notify_agent_resume(session_id: str) -> None:
    """Notify frontend that agent is resuming from hold."""
    await emit_agent_event_or_state(session_id, "state", {"state": "Idle"})

