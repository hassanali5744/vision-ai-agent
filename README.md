# AI Voice Assistant

A real-time voice conversation application built with React, LiveKit, FastAPI, and AI services. Features natural voice interactions with an AI agent with customizable behavior scripts, hold/resume functionality, and conversation history management.

## Architecture Overview

### Technology Stack

**Frontend:**
- React 19 with Vite
- LiveKit Client SDK (@livekit/components-react, livekit-client) for real-time audio/video
- TailwindCSS v4 for styling
- Axios for API communication
- Custom WebSocket service with reconnection and heartbeat

**Backend:**
- FastAPI for REST API and WebSocket server
- LiveKit Agents for voice agent worker
- MongoDB for conversation history and script storage
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
    │   │   ├── LiveKitRoom.jsx   # LiveKit room integration with hold/resume
    │   │   ├── ConversationHistory.jsx # Chat history viewer with search
    │   │   ├── ScriptManager.jsx  # Behavior script management UI
    │   │   └── AgentBot.jsx      # Agent status display
    │   ├── hooks/
    │   │   └── useWebSocket.js   # WebSocket React hook
    │   ├── services/
    │   │   ├── api.js            # API service layer (transcribe, history, scripts)
    │   │   └── websocket.js      # WebSocket service with heartbeat
    │   ├── App.jsx               # Main application with tab navigation
    │   ├── App.css               # Application styling
    │   └── main.jsx              # Application entry point
    ├── .env                      # Frontend environment variables
    └── package.json
```

## Data Flow

### Frontend Application Flow

#### 1. Application Initialization
- **App.jsx** loads with three lazy-loaded tabs (LiveKitRoom, ConversationHistory, ScriptManager)
- WebSocket service initializes with connection pooling and heartbeat
- Session ID generated for WebSocket synchronization
- Participant name loaded from sessionStorage or generated randomly

#### 2. LiveKit Voice Conversation Pipeline

**Step 1: Room Connection**
- User enters room name and participant name
- Frontend calls `getLiveKitToken()` API endpoint
- Backend generates LiveKit token with appropriate grants
- LiveKitRoom component connects to LiveKit server using token
- Connection state tracked (Disconnected → Connecting → Connected)

**Step 2: Recording & Transcription**
- User clicks "Tap to Talk" button
- WebSocket sends `start_listening` message to backend
- Frontend starts MediaRecorder with echo cancellation, noise suppression, auto-gain control
- Audio recorded in supported format (WebM/OGG/MP4) with automatic fallback
- On stop, audio blob sent to `/transcribe` API endpoint
- Deepgram transcribes audio to text
- Transcript published to LiveKit data channel as `user_transcript`

**Step 3: AI Processing**
- LiveKit agent receives transcript via data channel
- Agent loads active behavior script from MongoDB
- AI generates response using z.ai GLM models with script instructions
- Response sent to ElevenLabs for TTS synthesis
- Audio base64-encoded and chunked into 50KB segments

**Step 4: Audio Playback**
- Agent sends `agent_message` with audio_id via LiveKit data channel
- Frontend initializes chunk collection for new audio_id
- Audio chunks sent via `audio_chunk` messages
- Frontend reassembles chunks in array-based order
- When all chunks received, audio played via HTML5 Audio element
- On audio end, `playback_finished` sent via LiveKit data channel

**Step 5: Hold/Resume Flow**
- User clicks "Hold" button → Frontend sends `hold` via LiveKit data channel
- Frontend immediately stops microphone recording and audio playback
- Hold music starts (Web Audio API synthesized C major 7th chord)
- Backend state changes to "hold" → WebSocket sends `state_change`
- User clicks "Resume" → Frontend sends `resume` via LiveKit data channel
- Hold music stops, agent resumes normal operation

#### 3. Conversation History Pipeline

**Step 1: Room Discovery**
- User selects search mode (by room or by participant)
- Frontend calls `/rooms` API with optional participant filter
- Backend queries MongoDB for matching rooms
- Available rooms displayed as selectable buttons

**Step 2: History Retrieval**
- User selects room → Frontend calls `/history` API with room/participant/limit params
- Backend queries MongoDB for chat messages
- Messages grouped by room with agent/user separation
- Timeline built by sorting messages chronologically
- Chat bubbles rendered with timestamps and speaker identification

#### 4. Script Management Pipeline

**Step 1: Script Loading**
- Component mounts → Frontend calls `/scripts` and `/scripts/active` APIs
- Backend retrieves all scripts and currently active script from MongoDB
- Scripts displayed in list with active badge

**Step 2: Script Creation/Update**
- User fills form with script name and instructions
- Frontend sends POST/PUT to `/scripts` or `/scripts/{name}`
- Backend validates and stores script in MongoDB
- If `is_active` true, deactivates other scripts
- Script list refreshed

**Step 3: Script Activation**
- User clicks "Activate" on script card
- Frontend sends POST to `/scripts/{name}/activate`
- Backend sets script as active, deactivates others
- Agent uses new script instructions for future conversations

### WebSocket State Synchronization

**Connection Lifecycle**
- WebSocket connects with session_id query parameter
- Heartbeat mechanism: ping every 15s, expects pong within 5s
- On pong timeout, connection closed and reconnection attempted
- Exponential backoff: 1s, 2s, 3s, 4s, 5s (max 5 attempts)
- Reference counting: multiple components can share same connection

**State Events**
- **Frontend → Backend:** `start_listening`, `playback_finished`, `hold`, `resume`
- **Backend → Frontend:** `state_change`, `agent_event`, `connection_established`
- **Agent Process → FastAPI:** HTTP POST to `/ws/emit` (when running as separate process)

**State Machine**
- Idle → Listening (user starts recording)
- Listening → Processing (audio sent for transcription)
- Processing → Speaking (AI response ready)
- Speaking → Idle (audio playback finished)
- Any state → Hold (user clicks hold)
- Hold → Idle (user clicks resume)

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
- `POST /transcribe` - Transcribe audio
- `GET /rooms` - List all rooms (optional participant filter)
- `GET /history` - Get conversation history (room, participant, limit filters)
- `GET /livekit/token` - Generate LiveKit participant token
- `POST /agent/tts` - Generate TTS audio
- `POST /chat/messages` - Save chat message
- `GET /health` - System health check
- `GET /scripts` - List all behavior scripts
- `POST /scripts` - Create new behavior script
- `GET /scripts/active` - Get currently active script
- `PUT /scripts/{name}` - Update existing script
- `DELETE /scripts/{name}` - Delete script
- `POST /scripts/{name}/activate` - Set script as active

### WebSocket Endpoints

- `WS /ws/sync?session_id={id}` - Real-time state synchronization with heartbeat
- `POST /ws/emit` - Agent event forwarding (internal)

## Key Features

### 1. Real-time Voice Conversation
- Low-latency audio streaming via LiveKit with @livekit/components-react
- Browser-based recording with echo cancellation, noise suppression, and auto-gain control
- Chunked audio transmission (50KB chunks) to handle large TTS files within LiveKit data channel limits
- Support for multiple audio formats (WebM, OGG, MP4) with automatic fallback
- LiveKit data channel for real-time transcript and audio chunk delivery

### 2. Hold/Resume Functionality
- Put agent on hold with beautiful hold music (Web Audio API synthesized melody)
- Immediate audio and microphone stop when entering hold state
- State synchronization via LiveKit data channel and WebSocket
- Hold music with gentle pulsing effect using C major 7th chord
- Prevents duplicate hold/resume operations with processing flags

### 3. Behavior Script Management
- Create, edit, delete, and activate custom behavior scripts via UI
- Script instructions define AI agent behavior and conversation flow
- Active script selection with automatic deactivation of others
- MongoDB-based script storage with timestamps
- Real-time script updates without agent restart

### 4. Conversation History & Search
- Search conversation history by room name or participant name
- Load all available rooms with participant filtering
- Timeline view with agent and user messages sorted chronologically
- Grouped history by room with metadata tracking
- Beautiful chat bubble UI with timestamps and speaker identification

### 5. Tab-Based Navigation
- LiveKit Session tab for real-time voice conversations
- Conversation History tab for reviewing past conversations
- Script Manager tab for managing AI behavior scripts
- Lazy loading with React Suspense for performance
- Smooth fade-in animations between tabs

### 6. AI Response Generation
- Multiple model fallback (GLM-5.1 → GLM-4.6V-FlashX → GLM-4.6)
- Context-aware system prompts from active behavior script
- Retry logic for incomplete responses
- Browser TTS fallback when ElevenLabs audio unavailable
- Fallback responses when API fails

### 7. Audio Handling
- Deepgram Nova-2 for accurate speech-to-text transcription
- ElevenLabs Flash v2.5 for natural text-to-speech synthesis
- Base64 encoding with chunking (50KB chunks) for LiveKit data channel
- HTML5 Audio playback with event handling (ended, error)
- Browser Speech Synthesis API as TTS fallback

### 8. State Management
- Conversation states: Idle, Listening, Processing, Speaking, Hold
- WebSocket-based state synchronization with heartbeat (15s interval)
- Cross-process communication (agent → FastAPI via /ws/emit)
- Automatic reconnection with exponential backoff (max 5 attempts)
- Reference counting for WebSocket connection lifecycle

### 9. Data Persistence
- MongoDB for conversation history and script storage
- Duplicate detection (30-second window) for chat messages
- Grouped history by room with agent/user message separation
- Metadata tracking (source, phase, timestamps)
- Script versioning with update timestamps

### 10. WebSocket Service
- Custom WebSocket service with connection pooling
- Heartbeat/ping-pong mechanism for connection health
- Automatic reconnection with configurable backoff
- Event-based message subscription system
- Session-based connection management with reference counting

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
LiveKit data channel has a 64KB limit. Audio is chunked into 50KB segments to safely stay under this limit. Chunks are reassembled on the frontend before playback using an array-based approach to ensure proper ordering.

### Agent Process Separation
The LiveKit agent runs as a separate process (`IS_AGENT_PROCESS=true`). It communicates with FastAPI via HTTP POST to `/ws/emit` for state synchronization.

### Model Fallback
The agent tries multiple AI models in sequence. If all fail, it uses hardcoded fallback responses to ensure the conversation continues.

### Duplicate Prevention
Chat messages are checked against the last 30 seconds of history to prevent duplicate entries in MongoDB.

### Frontend Build Pipeline
The frontend uses Vite for development and production builds:
- **Development**: `npm run dev` - Starts Vite dev server with hot module replacement
- **Build**: `npm run build` - Creates optimized production build in `dist/` directory
- **Preview**: `npm run preview` - Preview production build locally
- **Lint**: `npm run lint` - Runs ESLint for code quality checks

The build process includes:
- React 19 with Babel compilation
- TailwindCSS v4 for styling
- LiveKit components bundling
- Code splitting with lazy loading for performance

## Security Considerations

- API keys are stored in `.env` files (not committed to git)
- LiveKit tokens are generated with limited grants
- WebSocket connections require session_id
- Audio data is transmitted over encrypted WebSocket (wss://)
- MongoDB connection should use authentication in production

## Frontend UI/UX Features

### Modern Design System
- Dark theme with gradient backgrounds and glass-morphism effects
- TailwindCSS v4 for utility-first styling
- Smooth animations and transitions (fade-in, scale effects)
- Responsive design with mobile-friendly layouts
- Custom color palette with blue/green accent gradients

### Interactive Components
- **LiveKitRoom**: Real-time status indicators, animated microphone button, hold/resume toggle with visual feedback
- **ConversationHistory**: Search modes (room/participant), room selection chips, timeline chat bubbles with timestamps
- **ScriptManager**: Form validation, active script badges, success/error notifications, script cards with actions

### User Experience
- Lazy loading with React Suspense for fast initial load
- Session storage for participant name persistence
- Loading states and error handling throughout
- Auto-generated participant names with sessionStorage
- Real-time transcript display during conversation

## Future Enhancements

- Add user authentication and authorization
- Support multiple simultaneous rooms/participants
- Add conversation export functionality (PDF, JSON, CSV)
- Implement voice activity detection (VAD) for automatic recording
- Add sentiment analysis and emotion detection
- Support multiple languages with i18n
- Add conversation analytics dashboard with charts
- Implement script templates and presets
- Add voice cloning for custom TTS voices
- Support file uploads and document analysis
- Add screen sharing and video capabilities
- Implement conversation summarization AI

## License

This project is for demonstration purposes.
# vision-ai-agent
