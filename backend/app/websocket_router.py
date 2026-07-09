from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.websocket_manager import websocket_manager

router = APIRouter(prefix="/ws", tags=["websocket"])


@router.post("/emit")
async def emit_agent_forwarded_event(payload: dict[str, Any]) -> dict[str, Any]:
    """Receive events from separate worker processes and broadcast to local websocket clients."""
    session_id = payload.get("session_id")
    event_type = payload.get("event_type")
    data = payload.get("data", {})

    if not session_id or not event_type:
        return {"success": False, "error": "Missing session_id or event_type"}

    if event_type == "state":
        state = data.get("state", "Idle")
        await websocket_manager.set_state(session_id, state)
    else:
        await websocket_manager.send_to_session(
            session_id,
            {
                "type": "agent_event",
                "event_type": event_type,
                "timestamp": websocket_manager._now_iso(),
                **data,
            },
        )
    return {"success": True}


@router.websocket("/sync")
async def websocket_sync_endpoint(websocket: WebSocket) -> None:
    """Handle frontend synchronization events over WebSocket."""
    session_id = websocket.query_params.get("session_id", "default")
    await websocket_manager.connect(session_id, websocket)

    try:
        while True:
            raw_message = await websocket.receive_text()
            try:
                payload = json.loads(raw_message)
            except json.JSONDecodeError:
                await websocket.send_json(
                    {
                        "type": "error",
                        "message": "Invalid JSON payload",
                    }
                )
                continue

            message_type = payload.get("type")
            if message_type == "ping":
                await websocket.send_json({"type": "pong", "timestamp": payload.get("timestamp")})
                continue

            if message_type == "ack":
                await websocket.send_json(
                    {
                        "type": "ack_received",
                        "message_id": payload.get("message_id"),
                    }
                )
                continue

            if message_type == "start_listening":
                await websocket_manager.set_state(session_id, "Listening")
                continue

            if message_type == "playback_finished":
                await websocket_manager.set_state(session_id, "Idle")
                continue

            # Client-to-server events are logged but not echoed back
            print(f"[WS] Received client event: {message_type} from session {session_id}")
    except WebSocketDisconnect:
        await websocket_manager.disconnect(session_id, websocket)
    except Exception as exc:
        await websocket_manager.disconnect(session_id, websocket)
        print(f"[ERROR] WebSocket error: {exc}")

