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
    const holdMusicRef = useRef(null);
    const [isOnHold, setIsOnHold] = useState(false);  // useState for immediate UI re-renders
    const isProcessingHold = useRef(false);  // Prevent duplicate hold/resume operations
    const manuallyStoppedAudio = useRef(false);  // Track if audio was manually stopped (e.g., on Hold)

    // Use our unified WebSocket hook for session sync
    const { connected: wsConnected, lastMessage, sendMessage } = useWebSocket(roomName || "voice-demo");

    // Sync state machine state from WebSocket events
    useEffect(() => {
        if (!lastMessage) return;
        if (lastMessage.type === "state_change") {
            const newState = lastMessage.state.toLowerCase();
            setConversationState(newState);
            
            // Handle Hold state transitions (sync with backend state_change only)
            if (newState === "hold" && !isOnHold) {
                setIsOnHold(true);
                handleHold();
                // Reset processing flag on successful hold
                isProcessingHold.current = false;
            } else if (newState !== "hold" && isOnHold) {
                setIsOnHold(false);
                handleResume();
                // Reset processing flag on successful resume
                isProcessingHold.current = false;
            }
        } else if (lastMessage.type === "connection_established") {
            setConversationState(lastMessage.state.toLowerCase());
        } else if (lastMessage.type === "agent_event") {
            if (lastMessage.event_type === "partial_transcript" || lastMessage.event_type === "final_transcript") {
                setTranscript(lastMessage.text);
            }
        }
    }, [lastMessage, isOnHold]);

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
        if (isOnHold) {
            console.log("[Audio] Agent is on hold, skipping audio playback");
            return;
        }

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
        
        // Reset manually stopped flag when new audio starts
        manuallyStoppedAudio.current = false;

        // Handle audio end event (single listener to prevent duplicates)
        audio.addEventListener('ended', () => {
            // Only send playback_finished if not manually stopped (e.g., on Hold)
            if (!manuallyStoppedAudio.current) {
                console.log("[Audio] Audio ended naturally, sending playback_finished");
                const currentRoom = roomRef.current;
                if (currentRoom && currentRoom.localParticipant) {
                    const payload = JSON.stringify({ type: "playback_finished" });
                    const data = new TextEncoder().encode(payload);
                    currentRoom.localParticipant.publishData(data, { reliable: true });
                }
            } else {
                console.log("[Audio] Audio was manually stopped, skipping playback_finished");
            }
            audioRef.current = null;
        });

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

    // Hold music playback - beautiful phone call hold melody
    const playHoldMusic = () => {
        if (holdMusicRef.current) {
            return; // Already playing
        }

        // Create a beautiful hold melody using Web Audio API
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const masterGain = audioContext.createGain();
        masterGain.connect(audioContext.destination);
        masterGain.gain.value = 0.08; // Low volume
        
        // Create oscillators for a pleasant chord (C major 7th)
        const frequencies = [261.63, 329.63, 392.00, 493.88]; // C4, E4, G4, B4
        const oscillators = [];
        
        frequencies.forEach((freq, index) => {
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();
            
            osc.type = 'sine';
            osc.frequency.value = freq;
            
            // Add slight detune for richness
            osc.detune.value = (index - 1.5) * 5;
            
            // Create gentle pulsing effect
            gain.gain.value = 0.3;
            const lfo = audioContext.createOscillator();
            const lfoGain = audioContext.createGain();
            lfo.frequency.value = 0.5; // 0.5 Hz pulsing
            lfoGain.gain.value = 0.15;
            lfo.connect(lfoGain.gain);
            lfo.start();
            
            osc.connect(gain);
            gain.connect(masterGain);
            osc.start();
            
            oscillators.push({ osc, gain, lfo, lfoGain });
        });
        
        holdMusicRef.current = {
            audioContext,
            masterGain,
            oscillators,
            stop: () => {
                try {
                    oscillators.forEach(({ osc, gain, lfo, lfoGain }) => {
                        lfo.stop();
                        lfoGain.disconnect();
                        osc.stop();
                        gain.disconnect();
                    });
                    masterGain.disconnect();
                    audioContext.close();
                } catch (e) {
                    console.warn("[Hold Music] Error stopping hold music:", e);
                }
            }
        };
        
        console.log("[Hold Music] Started playing beautiful hold melody");
    };

    const stopHoldMusic = () => {
        if (holdMusicRef.current) {
            holdMusicRef.current.stop();
            holdMusicRef.current = null;
            console.log("[Hold Music] Stopped hold tone");
        }
    };

    const handleHold = () => {
        // Prevent duplicate hold operations
        if (isProcessingHold.current || isOnHold) {
            console.log("[Hold] Already processing hold or already on hold, skipping");
            return;
        }
        
        isProcessingHold.current = true;
        console.log("[Hold] Entering hold state");
        
        // IMMEDIATELY stop microphone recording
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            try {
                mediaRecorderRef.current.stop();
                console.log("[Hold] Microphone recording stopped");
            } catch (err) {
                console.warn("[Hold] Error stopping recording:", err);
            }
        }
        
        // IMMEDIATELY stop current audio playback
        if (audioRef.current) {
            try {
                // Mark as manually stopped to prevent duplicate playback_finished events
                manuallyStoppedAudio.current = true;
                // Remove event listeners to prevent duplicate events
                audioRef.current.removeEventListener('ended', null);
                audioRef.current.removeEventListener('error', null);
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
                audioRef.current.src = "";
                audioRef.current.load();
                console.log("[Hold] Audio stopped, reset, and source cleared");
            } catch (err) {
                console.warn("[Hold] Error stopping audio:", err);
            }
            audioRef.current = null;
        }
        
        // Clear queued audio chunks immediately
        audioChunksRef.current = { audioId: null, chunks: [], totalChunks: 0, receivedChunks: 0 };
        console.log("[Hold] Audio chunks cleared");
        
        // Cancel browser TTS if active
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
            console.log("[Hold] Browser TTS cancelled");
        }
        
        // Start hold music
        playHoldMusic();
        
        // Send hold signal to backend via LiveKit data channel ONLY (no WebSocket duplicate)
        const currentRoom = roomRef.current;
        if (currentRoom && currentRoom.localParticipant) {
            const payload = JSON.stringify({ type: "hold" });
            const data = new TextEncoder().encode(payload);
            currentRoom.localParticipant.publishData(data, { reliable: true });
            console.log("[Hold] Hold signal sent via LiveKit data channel");
        }
        
        // Processing flag will be reset by backend state_change confirmation
    };

    const handleResume = () => {
        // Prevent duplicate resume operations
        if (isProcessingHold.current || !isOnHold) {
            console.log("[Resume] Already processing resume or not on hold, skipping");
            return;
        }
        
        isProcessingHold.current = true;
        console.log("[Resume] Resuming from hold state");
        
        // Stop hold music immediately
        stopHoldMusic();
        
        // Send resume signal to backend via LiveKit data channel ONLY (no WebSocket duplicate)
        const currentRoom = roomRef.current;
        if (currentRoom && currentRoom.localParticipant) {
            const payload = JSON.stringify({ type: "resume" });
            const data = new TextEncoder().encode(payload);
            currentRoom.localParticipant.publishData(data, { reliable: true });
            console.log("[Resume] Resume signal sent via LiveKit data channel");
        }
        
        // Processing flag will be reset by backend state_change confirmation
    };

    const handleHoldResumeToggle = () => {
        if (isOnHold) {
            handleResume();
        } else {
            handleHold();
        }
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
        // Don't start recording if on hold
        if (isOnHold) {
            stopRecording();
            return;
        }
        
        if (conversationState === "listening") {
            startRecording();
        } else {
            stopRecording();
        }
    }, [conversationState, isOnHold]);

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
                        // Reset chunk collection for new audio ID (only if not on hold)
                        if (!isOnHold) {
                            audioChunksRef.current = { audioId: data.audio_id, chunks: [], totalChunks: 0, receivedChunks: 0 };
                            console.log("[Audio] New audio ID received, chunk collection reset");
                        } else {
                            console.log("[Audio] Agent on hold, ignoring new audio");
                        }
                    } else {
                        // Fallback to browser TTS if no audio available (only if not on hold)
                        if (!isOnHold) {
                            speakBrowserTTS(data.text);
                        } else {
                            console.log("[Audio] Agent on hold, skipping TTS");
                        }
                    }
                } else if (data.type === "audio_chunk") {
                    // Skip audio chunks if on hold
                    if (isOnHold) {
                        console.log("[Audio] Agent on hold, skipping audio chunk");
                        return;
                    }
                    
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
                        console.log("[Audio] All chunks received, playing audio");
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

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
            stopHoldMusic();
        };
    }, []);

    const statusLabel =
        conversationState === "listening"
            ? "Listening"
            : conversationState === "processing"
              ? "Processing"
              : conversationState === "speaking"
                ? "Speaking"
                : conversationState === "hold"
                  ? "On Hold"
                  : "Idle";

    const handleMicToggle = () => {
        if (connectionState !== ConnectionState.Connected) {
            return;
        }

        if (isOnHold) {
            // Don't allow mic toggle while on hold
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

            <div style={{ marginBottom: "16px", display: "flex", gap: "12px", alignItems: "center" }}>
                <button
                    type="button"
                    onClick={handleMicToggle}
                    disabled={conversationState === "processing" || conversationState === "speaking" || conversationState === "hold" || connectionState !== ConnectionState.Connected}
                    style={{
                        padding: "14px 28px",
                        borderRadius: "999px",
                        border: "none",
                        cursor: conversationState === "processing" || conversationState === "speaking" || conversationState === "hold" ? "not-allowed" : "pointer",
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
                                : conversationState === "hold"
                                    ? "On Hold"
                                    : "Tap to Talk"}
                </button>
                
                <button
                    type="button"
                    onClick={handleHoldResumeToggle}
                    disabled={connectionState !== ConnectionState.Connected}
                    style={{
                        padding: "14px 28px",
                        borderRadius: "999px",
                        border: "none",
                        cursor: connectionState !== ConnectionState.Connected ? "not-allowed" : "pointer",
                        background: isOnHold
                            ? "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)"
                            : "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
                        color: "white",
                        fontWeight: 700,
                        fontSize: "16px",
                        boxShadow: isOnHold
                            ? "0 4px 20px rgba(34, 197, 94, 0.4)"
                            : "0 4px 20px rgba(245, 158, 11, 0.4)",
                        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                        transform: isOnHold ? "scale(1.05)" : "scale(1)"
                    }}
                >
                    {isOnHold ? "▶ Resume" : "⏸ Hold"}
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