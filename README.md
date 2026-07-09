# AI Voice Assistant

A real-time voice conversation application built with React, LiveKit, FastAPI, and AI services. Features natural voice interactions with an AI agent that can collect user information through conversation.

## Architecture Overview

### Technology Stack

**Frontend:**
- React 19 with Vite
- LiveKit Client SDK for real-time audio/video
- TailwindCSS for styling
- Axios for API communication

**Backend:**
- FastAPI for REST API and WebSocket server
- LiveKit Agents for voice agent worker
- MongoDB for conversation history storage
- Deepgram for speech-to-text transcription
- ElevenLabs for text-to-speech synthesis
- z.ai (GLM models) for AI responses

## Project Structure

```
testing/
├── backend/
│   ├── app/
│   │   ├── agent.py              # LiveKit agent worker (voice conversation logic)
│   │   ├── config.py             # Environment configuration
│   │   ├── database.py           # MongoDB operations
│   │   ├── elevenlabservice.py   # ElevenLabs TTS integration
│   │   ├── livekit_service.py    # LiveKit token & agent dispatch
│   │   ├── main.py               # FastAPI REST API endpoints
│   │   ├── service.py            # Deepgram transcription service
│   │   ├── websocket_manager.py # WebSocket connection management
│   │   └── websocket_router.py  # WebSocket routes
│   ├── .env                      # Backend environment variables
│   └── venv/                     # Python virtual environment
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── LiveKitRoom.jsx   # LiveKit room integration
    │   │   ├── ConversationHistory.jsx # Chat history viewer
    │   │   └── AgentBot.jsx      # Agent status display
    │   ├── hooks/
    │   │   └── useWebSocket.js   # WebSocket React hook
    │   ├── services/
    │   │   ├── api.js            # API service layer
    │   │   └── websocket.js      # WebSocket service
    │   └── App.jsx               # Main application
    ├── .env                      # Frontend environment variables
    └── package.json
```

## Data Flow

### Voice Conversation Flow

1. **User Speech Capture**
   - Frontend records audio via browser MediaRecorder API
   - Audio chunks collected in WebM/OGG format

2. **Transcription**
   - Audio sent to backend `/transcribe` endpoint (deprecated) or processed via LiveKit data channel
   - Deepgram API transcribes audio to text
   - Transcript sent to LiveKit agent via data channel

3. **AI Processing**
   - LiveKit agent receives transcript via data channel
   - Agent extracts name/email using regex patterns
   - Context built based on collection state (name → email → complete)
   - AI response generated using z.ai GLM models with fallback

4. **Text-to-Speech**
   - Agent response sent to ElevenLabs API
   - MP3 audio generated and base64-encoded
   - Audio chunked into 50KB segments (LiveKit data channel limit: 64KB)

5. **Audio Playback**
   - Chunks sent via LiveKit data channel
   - Frontend reassembles chunks in order
   - Audio played via HTML5 Audio element
   - State transitions: Idle → Listening → Processing → Speaking → Idle

### WebSocket State Synchronization

- **States:** Idle, Listening, Processing, Speaking
- **Frontend → Backend:** `start_listening`, `playback_finished`
- **Backend → Frontend:** `state_change`, `agent_event`, `connection_established`
- **Agent Process → FastAPI:** HTTP POST to `/ws/emit` (when running as separate process)

## Environment Configuration

### Backend (.env)

```env
DEEPGRAM_API_KEY=your_deepgram_api_key
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=your_voice_id
LIVEKIT_API_KEY=your_livekit_apiキー
LIVEKIT_API_SECRET=your_livekit_api_secret
LIVEKIT_URL=wss://your-livekit-server.cloud
OPENAI_API_KEY=your_zai_api_key
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=voice_ai
MONGODB_COLLECTION=chat_messages
```

### Frontend (.env)

```env
VITE_LIVEKIT_URL=ws://localhost:7880
```

## Setup Instructions

### Prerequisites

- Python 3.8+
- Node.js 18+
- MongoDB (local or cloud instance)
- LiveKit server (local or cloud)
- API keys for Deepgram, ElevenLabs, z.ai

### Backend Setup

1. **Create virtual environment**
   ```bash
   cd backend
   python -m venv venv
   venv\Scripts\activate  # Windows
   # or
   source venv/bin/activate  # Linux/Mac
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```
   Required packages:
   - fastapi
   - uvicorn
   - livekit
   - openai
   - pymongo
   - httpx
   - python-dotenv
   - deepgram-sdk

3. **Configure environment**
   - Copy `.env.example` to `.env`
   - Fill in all API keys and URLs

4. **Start FastAPI server**
   ```bash
   python -m app.main
   # or
   uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```

5. **Start LiveKit agent worker**
   ```bash
   python app/agent.py dev
   ```

### Frontend Setup

1. **Install dependencies**
   ```bash
   cd frontend
   npm install
   ```

2. **Configure environment**
   - Set `VITE_LIVEKIT_URL` in `.env`

3. **Start development server**
   ```bash
   npm run dev
   ```

## API Endpoints

### REST API (FastAPI)

- `GET /` - Health check
- `POST /transcribe` - Transcribe audio (deprecated)
- `GET /rooms` - List all rooms
- `GET /history` - Get conversation history
- `GET /livekit/token` - Generate LiveKit participant token
- `POST /agent/tts` - Generate TTS audio
- `POST /chat/messages` - Save chat message
- `GET /health` - System health check

### WebSocket Endpoints

- `WS /ws/sync?session_id={id}` - Real-time state synchronization
- `POST /ws/emit` - Agent event forwarding (internal)

## Key Features

### 1. Real-time Voice Conversation
- Low-latency audio streaming via LiveKit
- Browser-based recording with echo cancellation
- Chunked audio transmission to handle large TTS files

### 2. Intelligent Information Collection
- Regex-based name extraction (explicit patterns + fallback)
- Email extraction with normalization ("at" → "@", "dot" → ".")
- State machine: Ask Name → Ask Email → Complete

### 3. AI Response Generation
- Multiple model fallback (GLM-5.1 → GLM-4.6V-FlashX → GLM-4.6)
- Context-aware system prompts
- Retry logic for incomplete responses
- Fallback responses when API fails

### 4. Audio Handling
- Deepgram Nova-2 for accurate transcription
- ElevenLabs Flash v2.5 for natural TTS
- Base64 encoding with chunking (50KB chunks)
- HTML5 Audio playback with event handling

### 5. State Management
- Conversation state: Idle, Listening, Processing, Speaking
- WebSocket-based state synchronization
- Cross-process communication (agent → FastAPI)
- Automatic reconnection with heartbeat

### 6. Data Persistence
- MongoDB for conversation history
- Duplicate detection (30-second window)
- Grouped history by room
- Metadata tracking (source, phase)

## Troubleshooting

### Audio Not Playing
- Check browser autoplay permissions
- Verify ElevenLabs API key is valid
- Check console for chunk assembly errors
- Ensure audio chunks are received in order

### Agent Not Responding
- Verify LiveKit agent worker is running
- Check agent logs for errors
- Ensure agent is dispatched to room
- Verify WebSocket connection status

### Transcription Failing
- Check Deepgram API key
- Verify audio format is supported
- Check audio file size (>160 bytes)
- Review Deepgram API status

### WebSocket Connection Issues
- Verify FastAPI server is running on port 8000
- Check firewall settings
- Review WebSocket service logs
- Ensure session_id matches between frontend/backend

## Development Notes

### Audio Chunking
LiveKit data channel has a 64KB limit. Audio is chunked into 50KB segments to safely stay under this limit. Chunks are reassembled on the frontend before playback.

### Agent Process Separation
The LiveKit agent runs as a separate process (`IS_AGENT_PROCESS=true`). It communicates with FastAPI via HTTP POST to `/ws/emit` for state synchronization.

### Model Fallback
The agent tries multiple AI models in sequence. If all fail, it uses hardcoded fallback responses to ensure the conversation continues.

### Duplicate Prevention
Chat messages are checked against the last 30 seconds of history to prevent duplicate entries in MongoDB.

## Security Considerations

- API keys are stored in `.env` files (not committed to git)
- LiveKit tokens are generated with limited grants
- WebSocket connections require session_id
- Audio data is transmitted over encrypted WebSocket (wss://)
- MongoDB connection should use authentication in production

## Future Enhancements

- Add user authentication
- Support multiple rooms/participants
- Add conversation export functionality
- Implement voice activity detection (VAD)
- Add sentiment analysis
- Support multiple languages
- Add conversation analytics dashboard

## License

This project is for demonstration purposes.
# vision-ai-agent
