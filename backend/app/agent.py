import os
import re
import socket
import sys
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")
sys.path.insert(0, str(BASE_DIR))


def ensure_backend_python() -> None:
    """Re-execute this script with the project's virtualenv Python when needed."""
    if os.name == "nt":
        venv_python = BASE_DIR / "venv" / "Scripts" / "python.exe"
    else:
        venv_python = BASE_DIR / "venv" / "bin" / "python"

    if not venv_python.exists():
        return

    current_python = Path(sys.executable).resolve()
    target_python = venv_python.resolve()

    if current_python != target_python:
        print(f"Re-running agent with backend virtualenv: {target_python}")
        os.execv(str(target_python), [str(target_python), str(Path(__file__).resolve()), *sys.argv[1:]])


ensure_backend_python()

from app import config

print("LIVEKIT_URL:", config.LIVEKIT_URL)
print("LIVEKIT_API_KEY:", config.LIVEKIT_API_KEY)
print("LIVEKIT_AGENT_NAME:", config.LIVEKIT_AGENT_NAME)
print("OPENAI_API_KEY:", "Loaded" if config.OPENAI_API_KEY else "Missing")

import asyncio
import json

from livekit import agents, rtc
from openai import OpenAI
from app.database import save_chat_message, get_active_behavior_script
from app.websocket_manager import (
    notify_agent_finished_speaking,
    notify_agent_speaking,
    notify_agent_thinking,
    notify_final_transcript,
    notify_partial_transcript,
)

# Models tried in order until one succeeds. Using Gemini 2.5 and 1.5 models.
MODELS_TO_TRY = [
    "google/gemini-2.5-flash",
    "google/gemini-2.5-flash:free",
    "google/gemini-1.5-flash",
    "meta-llama/llama-3.3-70b-instruct",
    "deepseek/deepseek-chat",
]
# Global variable to store the active behavior script
_active_behavior_script: dict | None = None


def load_active_behavior_script() -> dict | None:
    """Load the active behavior script from database."""
    global _active_behavior_script
    try:
        result = get_active_behavior_script()
        if result.get("success") and result.get("script"):
            _active_behavior_script = result["script"]
            print(f"[INFO] Loaded active behavior script: {_active_behavior_script.get('name', 'unnamed')}")
            return _active_behavior_script
        else:
            print("[WARN] No active behavior script found, using default behavior")
            _active_behavior_script = None
            return None
    except Exception as e:
        print(f"[ERROR] Failed to load active behavior script: {e}")
        _active_behavior_script = None
        return None


def get_script_field(field: str, default: str = "") -> str:
    """Get a field from the active behavior script, with fallback to default."""
    global _active_behavior_script
    if _active_behavior_script and "script" in _active_behavior_script:
        return _active_behavior_script["script"].get(field, default)
    return default

# Common non-name utterances that must never be captured by the fallback
# "bare single-line" name pattern below. This is not exhaustive by design --
# it's a safety net for the most common false positives, not a full
# intent classifier.
NAME_FALLBACK_STOPWORDS = {
    "hi", "hello", "hey", "yes", "no", "yeah", "yep", "nope", "sure",
    "okay", "ok", "thanks", "thank you", "please", "maybe", "not now",
    "what", "why", "how", "who", "where", "when",
}

# If the utterance contains any of these words, or ends in a question mark,
# it's very unlikely to be "just a name" even if it matches the bare-line
# regex, so we skip the fallback pattern for it.
NAME_FALLBACK_BLOCK_WORDS = {
    "what", "why", "how", "who", "where", "when", "can", "could", "would",
    "should", "do", "does", "did", "is", "are", "will", "help", "please",
    "weather", "joke", "news", "code", "coding", "time", "today",
}


def build_system_prompt(
    name: str | None,
    email: str | None,
    collection_complete: bool,
) -> str:
    """Build the system prompt for Gemini based on the active behavior script instructions."""
    # Get the free-form instructions from the active behavior script
    instructions = get_script_field("instructions", "")
    
    # If no custom instructions are set, use default behavior
    if not instructions:
        instructions = "You are a helpful AI assistant. Greet the user and have a natural conversation."
    
    # Add constraints to the custom instructions for smarter, more natural behavior
    constraints = (
        " Keep responses under 20 words. Stay focused on the instructions. Do NOT repeat questions you have already asked. "
        "Once you have gathered all the requested information or completed the task, politely end the conversation by saying 'Thanks for your time' or something similar. "
        "If the user asks about topics completely unrelated to your instructions, politely say 'I don't know' or redirect them back to the topic. "
        "Vary your phrasing; do not use the exact same sentence repeatedly."
    )
    return instructions + constraints


def get_worker_port() -> int:
    configured_port = os.getenv("LIVEKIT_AGENT_PORT")
    if configured_port:
        try:
            return int(configured_port)
        except ValueError:
            pass
    
    # Let the OS pick a free port by binding a temporary socket
    import socket
    # We only use the OS to give us a port number, then we pass it to livekit
    # which binds its own socket. This is slightly racy but usually works.
    # A cleaner approach in production is to pass a config instructing the
    # server directly to port 0 instead of pre-selecting a port here.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            return sock.getsockname()[1]
    except OSError as exc:
        print(f"Unable to auto-select a free port: {exc}. Falling back to 18081.")
        return 18081


def get_openai_client() -> OpenAI | None:
    """Get OpenAI client configured for Gemini API."""
    api_key = config.OPENAI_API_KEY
    if not api_key:
        print("[ERROR] OPENAI_API_KEY is not configured")
        return None

    return OpenAI (
    api_key=api_key,
    base_url="https://openrouter.ai/api/v1"
    )

def normalize_spoken_text(text: str) -> str:
    """Normalize spoken text for better pattern matching (email extraction only)."""
    normalized = text.lower()
    normalized = re.sub(r"\s+at\s+", "@", normalized)
    normalized = re.sub(r"\s+dot\s+", ".", normalized)
    return normalized


def looks_like_complete_sentence(text: str) -> bool:
    """Return True when the model output looks like a complete sentence."""
    cleaned = re.sub(r"\s+", " ", (text or "")).strip()
    if not cleaned:
        return False

    # Strip surrounding quotes that some models return
    cleaned = cleaned.strip('"\'').strip()
    if not cleaned:
        return False

    words = cleaned.split()
    # Accept very short responses if they have punctuation
    if len(words) <= 2:
        return cleaned.endswith((".", "!", "?"))

    # For longer responses, require proper ending punctuation
    return cleaned.endswith((".", "!", "?"))


def _looks_like_non_name_utterance(text: str) -> bool:
    """Heuristic guard against the bare single-line fallback name pattern
    matching ordinary conversational text (questions, requests, small talk).
    """
    stripped = text.strip()
    lowered = stripped.lower()

    if not stripped:
        return True

    # Questions are never bare names.
    if stripped.endswith("?"):
        return True

    if lowered in NAME_FALLBACK_STOPWORDS:
        return True

    words = re.findall(r"[a-zA-Z']+", lowered)
    if any(word in NAME_FALLBACK_BLOCK_WORDS for word in words):
        return True

    # Real names are short. Long sentences are almost never "just a name".
    if len(words) > 4:
        return True

    return False


def extract_contact_fields(
    user_input: str,
    current_name: str | None = None,
    current_email: str | None = None,
) -> tuple[str | None, str | None]:
    """Extract name and email from user input using regex patterns."""
    text = (user_input or "").strip()
    name = current_name
    email = current_email
    normalized = normalize_spoken_text(text)

    # Extract email
    if not email:
        email_match = re.search(
            r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
            normalized,
        )
        if email_match:
            email = email_match.group(0).strip().lower()

    # Extract name
    if not name:
        # Explicit self-introduction patterns are checked first and are
        # always trusted -- these phrasings are unambiguous.
        explicit_name_patterns = [
            re.compile(r"\bmy name is ([a-zA-Z][a-zA-Z .'-]+)", re.I),
            re.compile(r"\bname is ([a-zA-Z][a-zA-Z .'-]+)", re.I),
            re.compile(r"\bi am ([a-zA-Z][a-zA-Z .'-]+)", re.I),
            re.compile(r"\bi'm ([a-zA-Z][a-zA-Z .'-]+)", re.I),
            re.compile(r"\bcall me ([a-zA-Z][a-zA-Z .'-]+)", re.I),
        ]

        for pattern in explicit_name_patterns:
            match = pattern.search(text)
            if match:
                candidate = match.group(1).strip().title()
                if "@" not in candidate:
                    name = candidate
                    break

        # Bare single-line fallback: only used when the text doesn't look
        # like an ordinary question/command/small-talk utterance. This is
        # what previously caused things like "what is the weather" to be
        # misread as a name.
        if not name and not _looks_like_non_name_utterance(text):
            bare_line_pattern = re.compile(r"^([a-zA-Z][a-zA-Z .'-]{1,40})$")
            match = bare_line_pattern.match(text)
            if match:
                candidate = match.group(1).strip().title()
                if "@" not in candidate:
                    name = candidate

    return name, email


async def get_ai_reply(
    user_input: str,
    name: str | None,
    email: str | None,
    collection_complete: bool,
    conversation_history: list[dict[str, str]] | None = None,
) -> str:
    """Get AI reply from Gemini API with proper context."""
    client = get_openai_client()
    
    # Get script instructions for fallback
    instructions = get_script_field("instructions", "")
    
    if not client:
        return "I don't know right now."

    # Build the system prompt
    system_prompt = build_system_prompt(name, email, collection_complete)

    # Prepare messages for Gemini - use history so it remembers what it asked!
    messages = [{"role": "system", "content": system_prompt}]
    
    if conversation_history:
        messages.extend(conversation_history[-15:])
    else:
        messages.append({"role": "user", "content": user_input})

    # Try multiple models with retry logic
    for attempt, model in enumerate(MODELS_TO_TRY):
        try:
            print(f"[DEBUG] Trying model: {model}")
            print("[DEBUG] Prompt sent to model:")
            for message in messages:
                print(f"  - {message['role']}: {message['content']}")

            retry_messages = messages
            if attempt > 0:
                retry_messages = messages + [
                    {
                        "role": "system",
                        "content": "Return one complete, natural sentence that ends with punctuation. Never return fragments, ellipses, or an unfinished thought.",
                    }
                ]

            response = client.chat.completions.create(
                model=model,
                messages=retry_messages,
                temperature=0.2,
                max_tokens=30,  # Reduced for short, focused responses
            )

            text = response.choices[0].message.content
            if isinstance(text, list):
                text = " ".join(str(part) for part in text)
            text = str(text or "").strip()
            print(f"[DEBUG] Model {model} replied: {text!r}")

            if looks_like_complete_sentence(text):
                return text

            print(f"[WARN] Model {model} returned an incomplete reply; retrying with a stronger instruction")
        except Exception as exc:
            print(f"[WARN] Model {model} failed: {exc}")
            continue

    print("[ERROR] All models failed, using fallback")
    return "This is not in my range."


async def send_response(
    room: rtc.Room,
    response_text: str,
    session_id: str,
    *,
    listen: bool = True,
    phase: str = "conversation",
) -> None:
    """Send response to the room via data channel and WebSocket events."""
    if not room.local_participant:
        print("[ERROR] No local participant in room to publish data!")
        return

    import base64
    import uuid
    from app.elevenlabservice import text_to_speech

    # Notify frontend that agent is speaking (transitions state to Speaking)
    await notify_agent_speaking(session_id, response_text)

    # Generate ElevenLabs TTS audio
    audio_b64 = None
    try:
        print(f"[INFO] Generating ElevenLabs TTS for: {response_text[:50]}...")
        audio_bytes = await text_to_speech(response_text)
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
        print(f"[INFO] ElevenLabs TTS generated successfully: {len(audio_bytes)} bytes (base64: {len(audio_b64)} chars)")
    except Exception as e:
        print(f"[ERROR] Failed to generate ElevenLabs TTS: {e}")

    # Generate a unique audio ID for tracking
    audio_id = str(uuid.uuid4())

    # Send text via data channel
    payload = {
        "type": "agent_message",
        "text": response_text,
        "listen": listen,
        "phase": phase,
        "has_audio": audio_b64 is not None,
        "audio_id": audio_id,
    }
    await room.local_participant.publish_data(json.dumps(payload), reliable=True)
    print(f"[INFO] Response sent: {response_text}")

    # Send audio in chunks if available (LiveKit data channel limit is ~64KB)
    if audio_b64:
        chunk_size = 15000  # Safe size for WebRTC to prevent silent packet drops
        total_chunks = (len(audio_b64) + chunk_size - 1) // chunk_size
        for i in range(0, len(audio_b64), chunk_size):
            chunk = audio_b64[i:i + chunk_size]
            audio_payload = {
                "type": "audio_chunk",
                "audio_id": audio_id,
                "chunk": chunk,
                "index": i // chunk_size,
                "total_chunks": total_chunks,
            }
            await room.local_participant.publish_data(json.dumps(audio_payload), reliable=True)
            await asyncio.sleep(0.02)  # Tiny pause to avoid WebRTC buffer overflow
        print(f"[INFO] Audio sent in {total_chunks} chunks")
    else:
        # No audio available, transition to Idle immediately
        await notify_agent_finished_speaking(session_id)


async def entrypoint(ctx: agents.JobContext):
    """Main entry point for the LiveKit agent."""
    print("Connecting to LiveKit...")
    await ctx.connect()
    print("Worker connected to room.")

    # Load the active behavior script at startup
    load_active_behavior_script()

    room = ctx.room
    welcome_sent: set[str] = set()
    processing_lock = asyncio.Lock()
    shutdown_event = asyncio.Event()
    conversation_history: list[dict[str, str]] = []
    last_processed_transcript: str = ""
    last_process_time: float = 0

    # Keep strong references to background tasks so they aren't garbage
    # collected mid-execution (a well-known asyncio pitfall with
    # fire-and-forget create_task calls).
    background_tasks: set[asyncio.Task] = set()

    def _track(task: asyncio.Task) -> None:
        background_tasks.add(task)
        task.add_done_callback(background_tasks.discard)

    async def greet_participant(participant: rtc.RemoteParticipant) -> None:
        """Greet a newly connected participant."""
        identity = participant.identity
        if identity in welcome_sent:
            return

        welcome_sent.add(identity)
        await notify_agent_thinking(room.name or "voice-demo")

        # Get initial greeting from Gemini based on script instructions
        greeting = await get_ai_reply(
            "Start the conversation",
            None,  # No name tracking
            None,  # No email tracking
            False,  # No collection state
            conversation_history
        )

        phase = "conversation"
        
        # Add the greeting to the conversation history so it remembers it already greeted!
        conversation_history.append({"role": "assistant", "content": greeting})
        
        # Save greeting to database so it appears in the frontend history
        try:
            await save_chat_message(
                room=room.name or "voice-demo",
                participant=identity,
                speaker="assistant",
                text=greeting,
                metadata={"source": "livekit_reply", "phase": phase},
            )
        except Exception as db_error:
            print(f"[WARN] Failed to save initial greeting to MongoDB: {db_error}")
            
        await send_response(room, greeting, room.name or "voice-demo", listen=True, phase=phase)
        print(f"[INFO] Greeting sent to {identity}: {greeting}")

    async def process_user_transcript(packet: rtc.DataPacket) -> None:
        """Process incoming user transcript and generate responses."""
        nonlocal conversation_history, last_processed_transcript, last_process_time

        try:
            async with processing_lock:
                if not packet.data:
                    return

                try:
                    payload = json.loads(packet.data.decode("utf-8"))
                except Exception as exc:
                    print(f"[ERROR] Failed to decode payload: {exc}")
                    return

                if payload.get("type") != "user_transcript":
                    return

                transcript = str(payload.get("text", "")).strip()
                if len(transcript) < 2:
                    return

                # Check for duplicate transcript within 2 seconds
                current_time = asyncio.get_event_loop().time()
                if transcript == last_processed_transcript and (current_time - last_process_time) < 2.0:
                    print(f"[DEBUG] Duplicate transcript detected, skipping: {transcript[:50]}...")
                    return

                last_processed_transcript = transcript
                last_process_time = current_time

                # Add user message to conversation history (after duplicate check)
                conversation_history.append({"role": "user", "content": transcript})

                participant = packet.participant
                if not participant:
                    return

                identity = participant.identity
                print(f"[INFO] Transcript from {identity}: {transcript}")

                # Save user transcript to database
                try:
                    await save_chat_message(
                        room=room.name or "voice-demo",
                        participant=identity,
                        speaker="user",
                        text=transcript,
                        metadata={"source": "livekit_transcript"},
                    )
                except Exception as db_error:
                    print(f"[WARN] Failed to save livekit transcript to MongoDB: {db_error}")

                await notify_agent_thinking(room.name or "voice-demo")
                await notify_partial_transcript(room.name or "voice-demo", transcript)

                # Get AI reply based on script instructions
                reply = await get_ai_reply(
                    transcript,
                    None,  # No name tracking
                    None,  # No email tracking
                    False,  # No collection state
                    conversation_history
                )

                # Always listen and use conversation phase
                phase = "conversation"
                listen = True

                # Add AI response to conversation history
                conversation_history.append({"role": "assistant", "content": reply})

                # Limit history length to prevent token overflow
                if len(conversation_history) > 20:
                    conversation_history = conversation_history[-20:]

                # Save AI response to database
                if reply:
                    try:
                        await save_chat_message(
                            room=room.name or "voice-demo",
                            participant=identity,
                            speaker="assistant",
                            text=reply,
                            metadata={"source": "livekit_reply", "phase": phase},
                        )
                    except Exception as db_error:
                        print(f"[WARN] Failed to save livekit reply to MongoDB: {db_error}")

                    await send_response(room, reply, room.name or "voice-demo", listen=listen, phase=phase)
                    await notify_final_transcript(room.name or "voice-demo", reply)
                    print("[DEBUG] Response sent successfully")
        except Exception as e:
            print(f"[ERROR] Error in process_user_transcript: {e}")
            import traceback
            traceback.print_exc()

    def handle_data_received(packet: rtc.DataPacket) -> None:
        """Handle incoming data packets."""
        sender = packet.participant.identity if packet.participant else "server"
        data_len = len(packet.data) if packet.data else 0
        print(f"[DEBUG] Data received from {sender}, bytes={data_len}")

        # Check for playback_finished signal from frontend
        try:
            if packet.data:
                payload = json.loads(packet.data.decode("utf-8"))
                if payload.get("type") == "playback_finished":
                    print("[DEBUG] Playback finished signal received, transitioning to Idle")
                    task = asyncio.create_task(notify_agent_finished_speaking(room.name or "voice-demo"))
                    _track(task)
                    return
        except Exception as exc:
            print(f"[DEBUG] Failed to parse playback_finished signal: {exc}")

        task = asyncio.create_task(process_user_transcript(packet))
        _track(task)
        task.add_done_callback(
            lambda t: print(f"[ERROR] Packet processing failed: {t.exception()}")
            if t.exception()
            else None
        )

    def on_participant_connected(participant: rtc.RemoteParticipant) -> None:
        """Handle participant connection."""
        print(f"[INFO] Participant connected: {participant.identity}")
        task = asyncio.create_task(greet_participant(participant))
        _track(task)

    def on_disconnected(_reason) -> None:
        """Handle room disconnection."""
        print("[INFO] Room disconnected, shutting down agent session.")
        shutdown_event.set()

    # Register event handlers
    room.on("data_received", handle_data_received)
    room.on("participant_connected", on_participant_connected)
    room.on("disconnected", on_disconnected)

    # Greet any participants already in the room
    for participant in room.remote_participants.values():
        task = asyncio.create_task(greet_participant(participant))
        _track(task)

    print("[INFO] Agent is active and waiting for user messages...")
    await shutdown_event.wait()


if __name__ == "__main__":
    os.environ["IS_AGENT_PROCESS"] = "true"
    if not config.LIVEKIT_API_KEY or not config.LIVEKIT_API_SECRET or not config.LIVEKIT_URL:
        raise RuntimeError(
            "LiveKit credentials missing. Set LIVEKIT_URL, LIVEKIT_API_KEY, and "
            "LIVEKIT_API_SECRET in backend/.env before starting the agent worker."
        )

    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=config.LIVEKIT_AGENT_NAME,
            ws_url=config.LIVEKIT_URL,
            api_key=config.LIVEKIT_API_KEY,
            api_secret=config.LIVEKIT_API_SECRET,
            port=get_worker_port(),
        )
    )