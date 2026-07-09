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
from app.database import save_chat_message
from app.websocket_manager import (
    notify_agent_finished_speaking,
    notify_agent_speaking,
    notify_agent_thinking,
    notify_final_transcript,
    notify_partial_transcript,
)

# Models tried in order until one succeeds. Using Gemini Flash models for speed.
MODELS_TO_TRY = [
    "gemini-1.5-flash",      # Latest Flash model, very fast
    "gemini-1.5-flash-8b",   # 8B parameter Flash model, even faster
]

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
    """Build the system prompt for Gemini based on current collection state."""
    if collection_complete:
        return f"Name: {name}, Email: {email}. Collection complete. Respond with one short sentence."

    if name and not email:
        return f"Name: {name}. Ask for email in one short sentence."
    elif not name:
        return "Ask for name in one short sentence."
    else:
        return "Ask for name and email in one short sentence."


def get_worker_port() -> int:
    configured_port = os.getenv("LIVEKIT_AGENT_PORT")
    if configured_port:
        try:
            return int(configured_port)
        except ValueError:
            print(f"Invalid LIVEKIT_AGENT_PORT value {configured_port!r}; using an auto-selected port instead.")

    # NOTE: there is an inherent (small) TOCTOU race here -- the socket used
    # to discover a free port is closed before the caller binds to it, so in
    # theory another process could grab the port in between. This is a
    # standard, generally-accepted trade-off for "find a free port" helpers
    # in Python since there's no atomic "reserve and hand off" primitive
    # across processes. If strict guarantees are required, bind the real
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

    return OpenAI(
        api_key=api_key,
        base_url="https://generativelanguage.googleapis.com/v1beta",
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
    if not client:
        # Fallback responses if API fails
        if collection_complete:
            return "Your name and email are saved. Onboarding is complete."
        if name and not email:
            return f"Thanks, {name}. What is your email address?"
        return "What is your name?"

    # Build the system prompt
    system_prompt = build_system_prompt(name, email, collection_complete)

    # Prepare messages for Gemini - NO conversation history to save tokens
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_input}
    ]

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
                max_tokens=50,  # Reduced for lightweight responses
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
    # Fallback responses if all models fail
    if collection_complete:
        return "Your name and email are saved. Onboarding is complete."
    if name and not email:
        return f"Thanks, {name}. What is your email address?"
    return "What is your name?"


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

    # Send text via data channel
    payload = {
        "type": "agent_message",
        "text": response_text,
        "listen": listen,
        "phase": phase,
        "has_audio": audio_b64 is not None,
    }
    await room.local_participant.publish_data(json.dumps(payload), reliable=True)
    print(f"[INFO] Response sent: {response_text}")

    # Send audio in chunks if available (LiveKit data channel limit is ~64KB)
    if audio_b64:
        chunk_size = 50000  # Safe margin under 64KB limit
        for i in range(0, len(audio_b64), chunk_size):
            chunk = audio_b64[i:i + chunk_size]
            audio_payload = {
                "type": "audio_chunk",
                "chunk": chunk,
                "index": i // chunk_size,
                "total_chunks": (len(audio_b64) + chunk_size - 1) // chunk_size,
            }
            await room.local_participant.publish_data(json.dumps(audio_payload), reliable=True)
        print(f"[INFO] Audio sent in {(len(audio_b64) + chunk_size - 1) // chunk_size} chunks")


async def entrypoint(ctx: agents.JobContext):
    """Main entry point for the LiveKit agent."""
    print("Connecting to LiveKit...")
    await ctx.connect()
    print("Worker connected to room.")

    room = ctx.room
    welcome_sent: set[str] = set()
    processing_lock = asyncio.Lock()
    shutdown_event = asyncio.Event()
    collected_name: str | None = None
    collected_email: str | None = None
    collection_complete = False
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

        # Get initial greeting from Gemini
        greeting = await get_ai_reply(
            "Start the conversation and ask for the user's name",
            collected_name,
            collected_email,
            collection_complete,
            conversation_history
        )

        phase = "collect_name"
        await send_response(room, greeting, room.name or "voice-demo", listen=True, phase=phase)
        print(f"[INFO] Greeting sent to {identity}: {greeting}")

    async def process_user_transcript(packet: rtc.DataPacket) -> None:
        """Process incoming user transcript and generate responses."""
        nonlocal collected_name, collected_email, collection_complete, conversation_history, last_processed_transcript, last_process_time

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
                    save_chat_message(
                        room=room.name or "voice-demo",
                        participant=identity,
                        speaker="user",
                        text=transcript,
                        metadata={"source": "livekit_transcript"},
                    )
                except Exception as db_error:
                    print(f"[WARN] Failed to save livekit transcript to MongoDB: {db_error}")

                # Extract name and email from user input
                name, email = extract_contact_fields(transcript, collected_name, collected_email)

                # Update collected fields
                if name and not collected_name:
                    collected_name = name

                if email and not collected_email:
                    collected_email = email

                # Check if collection is complete
                if collected_name and collected_email and not collection_complete:
                    collection_complete = True
                    print(f"[INFO] Collection complete for {identity}")

                print(
                    f"[DEBUG] Collected - Name: {collected_name}, Email: {collected_email}, "
                    f"Complete: {collection_complete}"
                )

                await notify_agent_thinking(room.name or "voice-demo")
                await notify_partial_transcript(room.name or "voice-demo", transcript)

                # Get AI reply based on current state
                reply = await get_ai_reply(
                    transcript,
                    collected_name,
                    collected_email,
                    collection_complete,
                    conversation_history
                )

                # Determine phase and listening state
                if collection_complete:
                    phase = "complete"
                    listen = False
                elif collected_name and not collected_email:
                    phase = "collect_email"
                    listen = True
                else:
                    phase = "collect_name"
                    listen = True

                # Add AI response to conversation history
                conversation_history.append({"role": "assistant", "content": reply})

                # Limit history length to prevent token overflow
                if len(conversation_history) > 20:
                    conversation_history = conversation_history[-20:]

                # Save AI response to database
                if reply:
                    try:
                        save_chat_message(
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