from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import base64
import traceback
import os
from datetime import datetime, timezone, timedelta
from app.service import transcribe_audio
from app.elevenlabservice import text_to_speech
from app import config
from app.livekit_service import create_participant_token, dispatch_agent_to_room
from app.database import save_chat_message, mongo_health, get_conversation_history, get_grouped_conversation_history, get_all_rooms, save_behavior_script, get_behavior_script, get_all_behavior_scripts, get_active_behavior_script, delete_behavior_script, set_active_behavior_script
from app.websocket_router import router as websocket_router
from openai import OpenAI

app = FastAPI(title="Voice AI Demo")
app.include_router(websocket_router)

# Rate limiting: track last agent reply time per room
_last_agent_reply: dict[str, datetime] = {}

# How long a room's rate-limit entry is kept before being treated as stale
# and evicted. Prevents _last_agent_reply from growing unbounded over the
# life of a long-running server with many/ephemeral room names.
_RATE_LIMIT_ENTRY_TTL = timedelta(hours=1)

# Reject uploads larger than this to avoid buffering unbounded audio into
# memory via `await audio.read()`.
_MAX_AUDIO_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB

# Updated CORS to allow multiple origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _prune_stale_rate_limit_entries(now: datetime) -> None:
    """Evict rate-limit entries older than the TTL so the dict doesn't
    grow unbounded across the server's lifetime."""
    stale_keys = [
        key for key, last_time in _last_agent_reply.items()
        if (now - last_time) > _RATE_LIMIT_ENTRY_TTL
    ]
    for key in stale_keys:
        _last_agent_reply.pop(key, None)


@app.get("/")
async def home():
    return {"message": "Backend Running"}


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...), reply: bool = False, room: str = "voice-demo", participant: str = "guest"):
    """
    DEPRECATED: This endpoint is deprecated. Use LiveKit agent for voice conversations.
    Kept for backward compatibility only.
    """
    try:
        from app.websocket_manager import websocket_manager
        await websocket_manager.set_state(room, "Processing")
        print(f"[WARN] /transcribe endpoint is deprecated. Use LiveKit agent instead.")
        print(f"[DEBUG] /transcribe called with reply={reply}")
        print(f"[DEBUG] Audio filename: {audio.filename}")
        print(f"[DEBUG] Audio content_type: {audio.content_type}")

        # Read audio bytes
        audio_bytes = await audio.read()
        print(f"[DEBUG] Audio received: {len(audio_bytes)} bytes")

        if len(audio_bytes) == 0:
            print("[ERROR] Received empty audio file")
            return {
                "success": False,
                "transcript": "",
                "error": "Empty audio file",
                "deprecated": True,
            }

        if len(audio_bytes) > _MAX_AUDIO_UPLOAD_BYTES:
            print(f"[ERROR] Audio file too large: {len(audio_bytes)} bytes")
            return {
                "success": False,
                "transcript": "",
                "error": f"Audio file exceeds maximum allowed size of {_MAX_AUDIO_UPLOAD_BYTES} bytes",
                "deprecated": True,
            }

        # Get content type with fallback, strip codec info
        content_type = audio.content_type or "audio/webm"
        if ";" in content_type:
            content_type = content_type.split(";")[0]  # Strip codec info
        if content_type == "application/octet-stream":
            ext = (audio.filename or "").split(".")[-1].lower()
            mime_map = {
                "webm": "audio/webm",
                "ogg": "audio/ogg",
                "mp4": "audio/mp4",
                "m4a": "audio/mp4",
                "wav": "audio/wav",
                "mp3": "audio/mpeg",
                "mpeg": "audio/mpeg",
            }
            content_type = mime_map.get(ext, "audio/webm")
        print(f"[DEBUG] Using cleaned content_type: {content_type}")

        # Transcribe audio
        try:
            transcript = await transcribe_audio(audio_bytes, content_type=content_type)
            print(f"[DEBUG] Transcription result: '{transcript}'")
        except Exception as transcribe_error:
            print(f"[ERROR] Transcription failed: {transcribe_error}")
            traceback.print_exc()
            return {
                "success": False,
                "transcript": "",
                "error": f"Transcription failed: {str(transcribe_error)}",
                "deprecated": True,
            }

        print(f"[DEBUG] Returning transcript only: {transcript}")
        return {
            "success": True,
            "transcript": transcript or "",
            "deprecated": True,
            "message": "This endpoint is deprecated. Use LiveKit agent for voice conversations.",
        }

    except Exception as e:
        print(f"[ERROR] Transcribe endpoint error: {e}")
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Transcription failed: {str(e)}"
        )


@app.get("/rooms")
async def list_rooms(participant: str = ""):
    """Return distinct room names that have chat messages for a specific participant."""
    rooms = get_all_rooms(participant=participant or None)
    return {"success": True, "rooms": rooms}


@app.get("/history")
async def get_history(room: str = "", participant: str = "", limit: int = 100):
    """Fetch grouped conversation history.

    Query params:
      - room: filter by room name (empty = all rooms)
      - participant: filter by participant name (empty = all participants)
      - limit: max messages to return (default 100)
    """
    try:
        # Guard against pathological limit values (negative, zero, or
        # unbounded) being passed straight through to the DB layer.
        safe_limit = max(1, min(limit, 1000))

        normalized_room = room.strip() if room else None
        normalized_participant = participant.strip() if participant and participant.strip() else None
        grouped_history = get_grouped_conversation_history(
            room=normalized_room,
            participant=normalized_participant,
            limit=safe_limit,
        )
        return {
            "success": True,
            "room": normalized_room,
            "participant": normalized_participant,
            "grouped_history": grouped_history,
        }
    except Exception as exc:
        print(f"[ERROR] Failed to load history: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/livekit/token")
async def get_livekit_token(room: str = "voice-demo", identity: str = "guest"):
    try:
        print(f"[DEBUG] Generating token for room: {room}, identity: {identity}")

        # Validate inputs
        if not room or not room.strip():
            room = "voice-demo"
        if not identity or not identity.strip():
            identity = f"user-{os.urandom(4).hex()}"

        # Create participant token
        try:
            jwt_token = create_participant_token(room, identity)
            print(f"[DEBUG] Token generated successfully")
        except Exception as token_error:
            print(f"[ERROR] Failed to create token: {token_error}")
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"Token generation failed: {str(token_error)}")

        # Dispatch agent to room
        try:
            agent_dispatched = await dispatch_agent_to_room(room)
            print(f"[DEBUG] Agent dispatched: {agent_dispatched}")
        except Exception as agent_error:
            print(f"[ERROR] Failed to dispatch agent: {agent_error}")
            # Don't fail the request if agent dispatch fails
            agent_dispatched = False

        return {
            "token": jwt_token,
            "server_url": config.LIVEKIT_URL,
            "agent_name": config.LIVEKIT_AGENT_NAME,
            "agent_dispatched": agent_dispatched,
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] /livekit/token failed: {e}")
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get LiveKit token: {str(e)}"
        )


@app.post("/agent/tts")
async def agent_tts(payload: dict):
    """Generates TTS audio for the agent and returns base64-encoded audio bytes.

    Expected JSON: { "text": "Hello there" }
    """
    try:
        if not payload:
            raise HTTPException(status_code=400, detail="Request body is required")

        text = payload.get("text")
        if not text:
            raise HTTPException(status_code=400, detail="Missing 'text' in request body")

        print(f"[DEBUG] TTS request for text: {text[:50]}...")

        # Generate TTS audio
        try:
            audio_bytes = await text_to_speech(text)
            print(f"[DEBUG] TTS audio generated: {len(audio_bytes)} bytes")
        except Exception as tts_error:
            print(f"[ERROR] TTS generation failed: {tts_error}")
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"TTS generation failed: {str(tts_error)}")

        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
        return {"success": True, "audio": audio_b64}

    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] /agent/tts failed: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"TTS request failed: {str(e)}")


@app.post("/chat/messages")
async def save_message(payload: dict):
    try:
        if not payload:
            raise HTTPException(status_code=400, detail="Request body is required")

        room = payload.get("room") or "voice-demo"
        participant = payload.get("participant") or "guest"
        speaker = payload.get("speaker") or "user"
        text = payload.get("text")
        metadata = payload.get("metadata") or {}

        result = save_chat_message(room, participant, speaker, text, metadata)
        if not isinstance(result, dict):
            # Defensive: don't let an unexpected return type from
            # save_chat_message crash this endpoint with an AttributeError.
            print(f"[WARN] save_chat_message returned unexpected type: {type(result)!r}")
            return {"success": False, "stored": False}

        return {"success": bool(result.get("stored", False)), **result}
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[ERROR] Failed to save chat message: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint for debugging"""
    return {
        "status": "healthy",
        "openai_configured": bool(config.OPENAI_API_KEY),
        "mongodb": mongo_health(),
        "livekit_configured": bool(config.LIVEKIT_URL and config.LIVEKIT_API_KEY),
        "elevenlabs_configured": bool(config.ELEVENLABS_API_KEY),
    }


# Behavior Script Management Endpoints

@app.get("/scripts")
async def get_scripts():
    """Get all behavior scripts."""
    try:
        result = get_all_behavior_scripts()
        return result
    except Exception as exc:
        print(f"[ERROR] Failed to get scripts: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/scripts/active")
async def get_active_script():
    """Get the currently active behavior script."""
    try:
        result = get_active_behavior_script()
        return result
    except Exception as exc:
        print(f"[ERROR] Failed to get active script: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/scripts/{script_name}")
async def get_script_by_name(script_name: str):
    """Get a specific behavior script by name."""
    try:
        result = get_behavior_script(name=script_name)
        if not result.get("success"):
            raise HTTPException(status_code=404, detail=result.get("error", "Script not found"))
        return result
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[ERROR] Failed to get script: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/scripts")
async def create_script(payload: dict):
    """Create or update a behavior script."""
    try:
        if not payload:
            raise HTTPException(status_code=400, detail="Request body is required")

        name = payload.get("name")
        script = payload.get("script")
        is_active = payload.get("is_active", False)

        if not name:
            raise HTTPException(status_code=400, detail="Missing 'name' in request body")
        if not script or not isinstance(script, dict):
            raise HTTPException(status_code=400, detail="Missing or invalid 'script' in request body")

        result = save_behavior_script(name, script, is_active)
        if not result.get("success"):
            raise HTTPException(status_code=500, detail=result.get("error", "Failed to save script"))

        return result
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[ERROR] Failed to create script: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.put("/scripts/{script_name}")
async def update_script(script_name: str, payload: dict):
    """Update an existing behavior script."""
    try:
        if not payload:
            raise HTTPException(status_code=400, detail="Request body is required")

        script = payload.get("script")
        is_active = payload.get("is_active")

        if not script or not isinstance(script, dict):
            raise HTTPException(status_code=400, detail="Missing or invalid 'script' in request body")

        result = save_behavior_script(script_name, script, is_active if is_active is not None else False)
        if not result.get("success"):
            raise HTTPException(status_code=500, detail=result.get("error", "Failed to update script"))

        return result
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[ERROR] Failed to update script: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.delete("/scripts/{script_name}")
async def delete_script(script_name: str):
    """Delete a behavior script by name."""
    try:
        result = delete_behavior_script(name=script_name)
        if not result.get("success"):
            raise HTTPException(status_code=404, detail=result.get("error", "Script not found"))
        return result
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[ERROR] Failed to delete script: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/scripts/{script_name}/activate")
async def activate_script(script_name: str):
    """Set a behavior script as active."""
    try:
        result = set_active_behavior_script(name=script_name)
        if not result.get("success"):
            raise HTTPException(status_code=404, detail=result.get("error", "Script not found"))
        return result
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[ERROR] Failed to activate script: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)