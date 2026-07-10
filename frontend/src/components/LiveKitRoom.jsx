import { useEffect, useRef, useState } from "react";
import {
    LiveKitRoom,
    VideoConference,
    RoomAudioRenderer,
    useRoomContext,
} from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import "@livekit/components-styles";
import { getLiveKitToken, transcribeAudio } from "../services/api";
import useWebSocket from "../hooks/useWebSocket";
import AgentBot from "./AgentBot";

function getSupportedMimeType() {
    const types = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
    ];
    return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function RoomMessageListener({ roomName, participantName }) {
    const room = useRoomContext();
    const [messages, setMessages] = useState([]);
    const [conversationState, setConversationState] = useState("idle");
    const [transcript, setTranscript] = useState("");
    const [connectionState, setConnectionState] = useState(ConnectionState.Disconnected);

    const mediaRecorderRef = useRef(null);
    const streamRef = useRef(null);
    const chunksRef = useRef([]);
    const mimeTypeRef = useRef("");
    const audioRef = useRef(null);
    const audioChunksRef = useRef({ audioId: null, chunks: [], totalChunks: 0, receivedChunks: 0 });
    const roomRef = useRef(null);

    // Use our unified WebSocket hook for session sync
    const { connected: wsConnected, lastMessage, sendMessage } = useWebSocket(roomName || "voice-demo");

    // Sync state machine state from WebSocket events
    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === "state_change") {
            setConversationState(lastMessage.state.toLowerCase());
        } else if (lastMessage.type === "connection_established") {
            setConversationState(lastMessage.state.toLowerCase());
        } else if (lastMessage.type === "agent_event") {
            if (lastMessage.event_type === "partial_transcript" || lastMessage.event_type === "final_transcript") {
                setTranscript(lastMessage.text);
            }
        }
    }, [lastMessage]);

    // Handle connection state of the LiveKit room
    useEffect(() => {
        if (!room) return;

        roomRef.current = room;

        const updateConnectionState = () => {
            setConnectionState(room.state);
        };

        updateConnectionState();
        room.on("connectionStateChanged", updateConnectionState);

        return () => {
            room.off("connectionStateChanged", updateConnectionState);
            roomRef.current = null;
        };
    }, [room]);

    // Helper to play base64-encoded ElevenLabs audio
    const playBase64Audio = (base64Audio) => {
        if (audioRef.current) {
            try {
                audioRef.current.pause();
            } catch (err) {
                console.warn("[Audio] Error pausing audio:", err);
            }
            audioRef.current = null;
        }

        const audioUrl = `data:audio/mpeg;base64,${base64Audio}`;
        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        audio.onended = () => {
            console.log("[Audio] Playback finished naturally.");
            // Send via LiveKit data channel instead of WebSocket
            const currentRoom = roomRef.current;
            if (currentRoom && currentRoom.localParticipant) {
                const payload = JSON.stringify({ type: "playback_finished" });
                const data = new TextEncoder().encode(payload);
                currentRoom.localParticipant.publishData(data, { reliable: true });
            }
            audioRef.current = null;
        };

        audio.onerror = (e) => {
            console.error("[Audio] Playback error:", e);
            // Send via LiveKit data channel instead of WebSocket
            const currentRoom = roomRef.current;
            if (currentRoom && currentRoom.localParticipant) {
                const payload = JSON.stringify({ type: "playback_finished" });
                const data = new TextEncoder().encode(payload);
                currentRoom.localParticipant.publishData(data, { reliable: true });
            }
            audioRef.current = null;
        };

        audio.play().catch((err) => {
            console.error("[Audio] Failed to play audio:", err);
            // Send via LiveKit data channel instead of WebSocket
            const currentRoom = roomRef.current;
            if (currentRoom && currentRoom.localParticipant) {
                const payload = JSON.stringify({ type: "playback_finished" });
                const data = new TextEncoder().encode(payload);
                currentRoom.localParticipant.publishData(data, { reliable: true });
            }
            audioRef.current = null;
        });
    };

    // Recording start function
    const startRecording = async () => {
        if (mediaRecorderRef.current) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });

            streamRef.current = stream;
            const mimeType = getSupportedMimeType();
            mimeTypeRef.current = mimeType || "audio/webm";
            const recorderOptions = mimeType ? { mimeType } : undefined;
            const recorder = new MediaRecorder(stream, recorderOptions);

            mediaRecorderRef.current = recorder;
            chunksRef.current = [];

            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunksRef.current.push(event.data);
                }
            };

            recorder.onerror = (event) => {
                console.error("[ERROR] MediaRecorder error:", event.error || event);
                // Send via LiveKit data channel instead of WebSocket
                const currentRoom = roomRef.current;
                if (currentRoom && currentRoom.localParticipant) {
                    const payload = JSON.stringify({ type: "playback_finished" });
                    const data = new TextEncoder().encode(payload);
                    currentRoom.localParticipant.publishData(data, { reliable: true });
                }
            };

            recorder.onstop = async () => {
                const audioBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
                
                // Stop all tracks immediately to release the hardware mic and stop all packet flows
                if (streamRef.current) {
                    streamRef.current.getTracks().forEach((track) => track.stop());
                    streamRef.current = null;
                }
                mediaRecorderRef.current = null;

                if (!audioBlob.size || audioBlob.size < 200) {
                    // Send via LiveKit data channel instead of WebSocket
                    const currentRoom = roomRef.current;
                    if (currentRoom && currentRoom.localParticipant) {
                        const payload = JSON.stringify({ type: "playback_finished" });
                        const data = new TextEncoder().encode(payload);
                        currentRoom.localParticipant.publishData(data, { reliable: true });
                    }
                    return;
                }

                try {
                    const result = await transcribeAudio(audioBlob, false, roomName, participantName);
                    const text = result?.transcript?.trim();

                    if (!text || text.length < 2) {
                        // Send via LiveKit data channel instead of WebSocket
                        const currentRoom = roomRef.current;
                        if (currentRoom && currentRoom.localParticipant) {
                            const payload = JSON.stringify({ type: "playback_finished" });
                            const data = new TextEncoder().encode(payload);
                            currentRoom.localParticipant.publishData(data, { reliable: true });
                        }
                        return;
                    }

                    setMessages((prev) => [
                        ...prev,
                        {
                            text,
                            from: "user",
                            timestamp: new Date(),
                        },
                    ]);

                    // Publish the transcript to the LiveKit room via data channel
                    if (room && room.localParticipant) {
                        const payload = JSON.stringify({ type: "user_transcript", text });
                        const data = new TextEncoder().encode(payload);
                        await room.localParticipant.publishData(data, { reliable: true });
                    }
                } catch (error) {
                    console.error("[ERROR] Failed to transcribe audio:", error);
                    // Send via LiveKit data channel instead of WebSocket
                    const currentRoom = roomRef.current;
                    if (currentRoom && currentRoom.localParticipant) {
                        const payload = JSON.stringify({ type: "playback_finished" });
                        const data = new TextEncoder().encode(payload);
                        currentRoom.localParticipant.publishData(data, { reliable: true });
                    }
                }
            };

            recorder.start();
        } catch (error) {
            console.error("[ERROR] Failed to start recording:", error);
            // Send via LiveKit data channel instead of WebSocket
            const currentRoom = roomRef.current;
            if (currentRoom && currentRoom.localParticipant) {
                const payload = JSON.stringify({ type: "playback_finished" });
                const data = new TextEncoder().encode(payload);
                currentRoom.localParticipant.publishData(data, { reliable: true });
            }
        }
    };

    // Recording stop function
    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop();
        }
    };

    // React to conversation state changes
    useEffect(() => {
        if (conversationState === "listening") {
            startRecording();
        } else {
            stopRecording();
        }
    }, [conversationState]);

    // Listen to data channel messages from the LiveKit room (agent response)
    useEffect(() => {
        if (!room || connectionState !== ConnectionState.Connected) {
            return;
        }

        const handleDataReceived = (payload, participant) => {
            if (participant?.identity === room.localParticipant?.identity) {
                return;
            }

            const speakBrowserTTS = (text) => {
                if (!window.speechSynthesis) {
                    console.error("[ERROR] Browser TTS not supported.");
                    const currentRoom = roomRef.current;
                    if (currentRoom && currentRoom.localParticipant) {
                        const payload = JSON.stringify({ type: "playback_finished" });
                        const data = new TextEncoder().encode(payload);
                        currentRoom.localParticipant.publishData(data, { reliable: true });
                    }
                    return;
                }
                
                window.speechSynthesis.cancel();
                
                const utterance = new SpeechSynthesisUtterance(text);
                const voices = window.speechSynthesis.getVoices();
                const englishVoices = voices.filter(v => v.lang.startsWith('en'));
                if (englishVoices.length > 0) {
                    utterance.voice = englishVoices[0];
                }
                
                utterance.onend = () => {
                    const currentRoom = roomRef.current;
                    if (currentRoom && currentRoom.localParticipant) {
                        const payload = JSON.stringify({ type: "playback_finished" });
                        const data = new TextEncoder().encode(payload);
                        currentRoom.localParticipant.publishData(data, { reliable: true });
                    }
                };
                
                utterance.onerror = (e) => {
                    console.error("[ERROR] Browser TTS failed:", e);
                    const currentRoom = roomRef.current;
                    if (currentRoom && currentRoom.localParticipant) {
                        const payload = JSON.stringify({ type: "playback_finished" });
                        const data = new TextEncoder().encode(payload);
                        currentRoom.localParticipant.publishData(data, { reliable: true });
                    }
                };
                
                window.speechSynthesis.speak(utterance);
            };

            try {
                let data;
                if (payload instanceof Uint8Array || payload instanceof ArrayBuffer) {
                    const bytes = payload instanceof ArrayBuffer ? new Uint8Array(payload) : payload;
                    data = JSON.parse(new TextDecoder().decode(bytes));
                } else if (typeof payload === "string") {
                    data = JSON.parse(payload);
                } else {
                    data = payload;
                }

                if (data.type === "agent_message" && data.text) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            text: data.text,
                            from: "agent",
                            timestamp: new Date(),
                        },
                    ]);
                    
                    if (data.has_audio) {
                        // Reset chunk collection for new audio ID
                        audioChunksRef.current = { audioId: data.audio_id, chunks: [], totalChunks: 0, receivedChunks: 0 };
                    } else {
                        // Fallback to browser TTS if no audio available
                        speakBrowserTTS(data.text);
                    }
                } else if (data.type === "audio_chunk") {
                    const { audio_id, chunk, index, total_chunks } = data;
                    const chunksRef = audioChunksRef.current;
                    
                    // Only process chunks for the current audio response
                    if (!chunksRef.audioId || chunksRef.audioId !== audio_id) {
                        return;
                    }

                    // Initialize the array if we haven't yet (totalChunks will be 0 initially)
                    if (chunksRef.totalChunks === 0) {
                        chunksRef.totalChunks = total_chunks;
                        // Use Array.from to create an array with actual undefined values, not empty slots
                        chunksRef.chunks = Array.from({ length: total_chunks });
                        chunksRef.receivedChunks = 0;
                    }

                    if (data.index >= 0 && data.index < chunksRef.totalChunks) {
                        // Only increment if we haven't received this specific chunk yet
                        if (chunksRef.chunks[data.index] === undefined) {
                            chunksRef.chunks[data.index] = data.chunk;
                            chunksRef.receivedChunks++;
                        }
                    }
                    
                    // Check if all chunks received
                    if (chunksRef.receivedChunks === chunksRef.totalChunks) {
                        // All chunks are guaranteed to be populated now
                        const fullAudio = chunksRef.chunks.join("");
                        playBase64Audio(fullAudio);
                        // Clear audioId to prevent replay
                        chunksRef.audioId = null;
                        chunksRef.totalChunks = 0;
                        chunksRef.receivedChunks = 0;
                    }
                }
            } catch (error) {
                console.error("[ERROR] Failed to parse data channel message:", error);
            }
        };

        room.on("dataReceived", handleDataReceived);

        return () => {
            room.off("dataReceived", handleDataReceived);
        };
    }, [room, connectionState]);

    const statusLabel =
        conversationState === "listening"
            ? "Listening"
            : conversationState === "processing"
              ? "Processing"
              : conversationState === "speaking"
                ? "Speaking"
                : "Idle";

    const handleMicToggle = () => {
        if (connectionState !== ConnectionState.Connected) {
            return;
        }

        if (conversationState === "listening") {
            stopRecording();
        } else if (conversationState === "idle") {
            sendMessage({ type: "start_listening" });
        }
    };

    return (
        <div className="agent-panel">
            <div className="agent-panel-header">
                <div className="agent-panel-title">Agent Conversation Window</div>
                <div className={`status-pill ${conversationState === "listening" ? "" : "offline"}`}>
                    <span className={`status-dot ${conversationState === "listening" ? "" : "offline"}`} />
                    {connectionState !== ConnectionState.Connected ? "Connecting" : statusLabel}
                </div>
            </div>

            <div style={{ marginBottom: "16px" }}>
                <button
                    type="button"
                    onClick={handleMicToggle}
                    disabled={conversationState === "processing" || conversationState === "speaking" || connectionState !== ConnectionState.Connected}
                    style={{
                        padding: "14px 28px",
                        borderRadius: "999px",
                        border: "none",
                        cursor: conversationState === "processing" || conversationState === "speaking" ? "not-allowed" : "pointer",
                        background: conversationState === "listening" 
                            ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)" 
                            : "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                        color: "white",
                        fontWeight: 700,
                        fontSize: "16px",
                        boxShadow: conversationState === "listening" 
                            ? "0 4px 20px rgba(239, 68, 68, 0.4)" 
                            : "0 4px 20px rgba(59, 130, 246, 0.4)",
                        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                        transform: conversationState === "listening" ? "scale(1.05)" : "scale(1)"
                    }}
                >
                    {conversationState === "listening"
                        ? "Stop & Send"
                        : conversationState === "processing"
                            ? "Processing..."
                            : conversationState === "speaking"
                                ? "Agent Speaking"
                                : "Tap to Talk"}
                </button>
            </div>

            {transcript && (
                <div className="agent-chat-item user" style={{ marginBottom: "12px", animation: "fadeIn 0.3s ease" }}>
                    <strong>Latest transcript</strong>
                    <div className="bubble-text">{transcript}</div>
                </div>
            )}

            <div className="agent-chat-list">
                {messages.map((msg, idx) => (
                    <div key={idx} className={`agent-chat-item ${msg.from === "agent" ? "agent" : "user"}`}>
                        <strong>{msg.from === "agent" ? "Agent" : "You"}</strong>
                        <div className="bubble-text">{msg.text}</div>
                        <span className="meta">{msg.timestamp.toLocaleTimeString()}</span>
                    </div>
                ))}
                {messages.length === 0 && (
                    <div className="agent-empty">No messages yet. Hold the microphone button to speak and the conversation will appear here.</div>
                )}
            </div>
        </div>
    );
}

function LiveKitSession() {
    const [roomName, setRoomName] = useState("voice-demo");
    const [participantName, setParticipantName] = useState(() => {
        const saved = sessionStorage.getItem("livekit-participant-name");
        if (saved) return saved;
        const generated = "user-" + Math.floor(Math.random() * 1000);
        sessionStorage.setItem("livekit-participant-name", generated);
        return generated;
    });
    const [token, setToken] = useState("");
    const [serverUrl, setServerUrl] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [connected, setConnected] = useState(false);

    const handleJoin = async (e) => {
        e.preventDefault();
        if (!roomName.trim() || !participantName.trim()) {
            setError("Room and Participant names are required.");
            return;
        }

        sessionStorage.setItem("livekit-participant-name", participantName.trim());
        setLoading(true);
        setError("");
        try {
            const data = await getLiveKitToken(roomName, participantName.trim());
            setToken(data.token);
            setServerUrl(
                data.server_url ||
                    import.meta.env.VITE_LIVEKIT_URL ||
                    "ws://localhost:7880"
            );
            if (data.agent_dispatched === false) {
                console.log(`Agent "${data.agent_name}" is already active in room "${roomName}".`);
            } else {
                console.log(`Dispatched agent "${data.agent_name}" to room "${roomName}".`);
            }
            setConnected(true);
        } catch (err) {
            console.error(err);
            setError(
                err.response?.data?.detail ||
                    "Failed to fetch LiveKit token. Ensure the backend is running and configured."
            );
        } finally {
            setLoading(false);
        }
    };

    const handleDisconnect = () => {
        setToken("");
        setConnected(false);
    };

    if (connected && token && serverUrl) {
        return (
            <div className="livekit-room-container">
                <div className="livekit-header">
                    <h3>Room: {roomName} | Participant: {participantName}</h3>
                    <button className="disconnect-btn" onClick={handleDisconnect}>
                        Leave Room
                    </button>
                </div>
                <div className="livekit-video-wrapper">
                    <LiveKitRoom
                        video={false}
                        audio={false}
                        token={token}
                        serverUrl={serverUrl}
                        connect={true}
                        data-lk-theme="default"
                        onDisconnected={handleDisconnect}
                        onConnected={() => console.log(`Connected as ${participantName}`)}
                    >
                        <RoomMessageListener roomName={roomName} participantName={participantName} />
                        <VideoConference />
                        <RoomAudioRenderer />
                    </LiveKitRoom>
                </div>
            </div>
        );
    }

    return (
        <div className="livekit-setup-card">
            <h2>Join LiveKit WebRTC Session</h2>
            <p className="subtitle">Connect to a live room with high-fidelity video & audio capabilities.</p>
            
            <form onSubmit={handleJoin} className="setup-form">
                <div className="form-group">
                    <label htmlFor="room-name">Room Name</label>
                    <input
                        id="room-name"
                        type="text"
                        value={roomName}
                        onChange={(e) => setRoomName(e.target.value)}
                        placeholder="Enter room name"
                        disabled={loading}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="participant-name">Your Name</label>
                    <input
                        id="participant-name"
                        type="text"
                        value={participantName}
                        onChange={(e) => setParticipantName(e.target.value)}
                        placeholder="Enter participant name"
                        disabled={loading}
                    />
                </div>

                {error && <div className="error-message">{error}</div>}

                <button type="submit" className="join-btn" disabled={loading}>
                    {loading ? "Generating token..." : "Connect Now"}
                </button>

                <hr />

                <AgentBot />
            </form>
        </div>
    );
}

export default LiveKitSession;