import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")
print("DEEPGRAM_API_KEY:", DEEPGRAM_API_KEY)
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
print("ELEVENLABS_API_KEY:", ELEVENLABS_API_KEY)
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID")
print("ELEVENLABS_VOICE_ID:", ELEVENLABS_VOICE_ID)

LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY")
print("LIVEKIT_API_KEY:", LIVEKIT_API_KEY)
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET")
# Mask secret in output for security
print("LIVEKIT_API_SECRET:", "***" if LIVEKIT_API_SECRET else None)
LIVEKIT_URL = os.getenv("LIVEKIT_URL")
print("LIVEKIT_URL:", LIVEKIT_URL)

LIVEKIT_AGENT_NAME = os.getenv("LIVEKIT_AGENT_NAME", "onboarding-agent")
print("LIVEKIT_AGENT_NAME:", LIVEKIT_AGENT_NAME)

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017")
MONGODB_DB = os.getenv("MONGODB_DB", "voice_ai")
MONGODB_COLLECTION = os.getenv("MONGODB_COLLECTION", "chat_messages")