import httpx
from app.config import DEEPGRAM_API_KEY

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true&diarization=false"

MIN_AUDIO_BYTES = 160


def normalize_content_type(content_type: str | None) -> str:
    if not content_type:
        return "audio/webm"

    base = content_type.split(";")[0].strip().lower()
    mapping = {
        "audio/webm": "audio/webm",
        "audio/ogg": "audio/ogg",
        "audio/mp4": "audio/mp4",
        "audio/mpeg": "audio/mpeg",
        "audio/wav": "audio/wav",
        "audio/x-wav": "audio/wav",
    }
    return mapping.get(base, base)


def is_likely_valid_audio(audio_bytes: bytes, content_type: str | None = None) -> bool:
    if len(audio_bytes) < 16:
        return False

    header = audio_bytes[:4]
    if header == b"\x1a\x45\xdf\xa3":  # WebM / Matroska
        return True
    if header == b"OggS":
        return True
    if header == b"RIFF":
        return True
    if len(audio_bytes) > 8 and audio_bytes[4:8] == b"ftyp":
        return True
    if content_type and str(content_type).startswith("audio/"):
        return True

    return False


async def transcribe_audio(audio_bytes: bytes, content_type: str | None = None) -> str:
    print(
        f"[DEBUG] transcribe_audio called with {len(audio_bytes)} bytes, "
        f"content_type: {content_type}"
    )

    if not DEEPGRAM_API_KEY:
        print("[ERROR] DEEPGRAM_API_KEY is not configured")
        raise ValueError("DEEPGRAM_API_KEY is not set in backend/.env")

    if len(audio_bytes) < MIN_AUDIO_BYTES:
        print("[WARN] Audio is smaller than the preferred size, but continuing anyway")

    if not is_likely_valid_audio(audio_bytes, content_type):
        print("[WARN] Audio does not look like a standard media container; continuing anyway")

    content_type = normalize_content_type(content_type)
    headers = {
        "Authorization": f"Token {DEEPGRAM_API_KEY}",
        "Content-Type": content_type,
    }

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            print(f"[DEBUG] Sending complete audio file to Deepgram as {content_type}")
            response = await client.post(
                DEEPGRAM_URL,
                headers=headers,
                content=audio_bytes,
            )

        print(f"[DEBUG] Deepgram Status Code: {response.status_code}")
        print(f"[DEBUG] Deepgram Response: {response.text[:500]}")

        if response.status_code == 400:
            print("[WARN] Deepgram rejected audio as corrupt/unsupported; returning empty transcript")
            return ""

        response.raise_for_status()

        data = response.json()
        transcript = data["results"]["channels"][0]["alternatives"][0]["transcript"]
        print(f"[DEBUG] Extracted transcript: '{transcript}'")
        return transcript.strip()
    except httpx.HTTPStatusError as http_err:
        print(f"[ERROR] Deepgram HTTP Error: {http_err}")
        if http_err.response is not None:
            print(f"[ERROR] Response status: {http_err.response.status_code}")
            print(f"[ERROR] Response text: {http_err.response.text}")
        return ""
    except (KeyError, IndexError) as parse_err:
        print(f"[ERROR] Failed to parse Deepgram response: {parse_err}")
        return ""
    except Exception as e:
        print(f"[ERROR] Unexpected error in transcribe_audio: {e}")
        return ""
