import httpx

from app.config import (
    ELEVENLABS_API_KEY,
    ELEVENLABS_VOICE_ID,
)

ELEVENLABS_URL = (
    f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}"
)


async def text_to_speech(text: str) -> bytes:
    """
    Sends text to ElevenLabs and returns MP3 audio bytes.
    """

    headers = {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }

    payload = {
        "text": text,
        "model_id": "eleven_flash_v2_5",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
        },
    }

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            ELEVENLABS_URL,
            headers=headers,
            json=payload,
        )

    print("ElevenLabs Status:", response.status_code)

    if response.status_code != 200:
        print(response.text)

    response.raise_for_status()

    return response.content