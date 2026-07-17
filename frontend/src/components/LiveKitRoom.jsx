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

    // Hold music playback - beautiful mountain bird chirping with fast music
    const playHoldMusic = () => {
        if (holdMusicRef.current) {
            return; // Already playing
        }

        // Create beautiful mountain-inspired hold music with bird chirping
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const masterGain = audioContext.createGain();
        masterGain.connect(audioContext.destination);
        masterGain.gain.value = 0.07;
        
        // Fast-paced uplifting melody (mountain-inspired)
        const melody = [
            { freq: 523.25, duration: 0.3 },  // C5
            { freq: 587.33, duration: 0.3 },  // D5
            { freq: 659.25, duration: 0.3 },  // E5
            { freq: 783.99, duration: 0.4 },  // G5
            { freq: 698.46, duration: 0.3 },  // F5
            { freq: 659.25, duration: 0.3 },  // E5
            { freq: 587.33, duration: 0.3 },  // D5
            { freq: 523.25, duration: 0.4 },  // C5
            { freq: 587.33, duration: 0.3 },  // D5
            { freq: 659.25, duration: 0.3 },  // E5
            { freq: 783.99, duration: 0.3 },  // G5
            { freq: 880.00, duration: 0.5 },  // A5
            { freq: 783.99, duration: 0.3 },  // G5
            { freq: 659.25, duration: 0.3 },  // E5
            { freq: 523.25, duration: 0.6 },  // C5
        ];
        
        // Bird chirping frequencies (high-pitched, quick sounds)
        const birdChirps = [
            { freq: 1567.98, duration: 0.08 },  // G6
            { freq: 1760.00, duration: 0.06 },  // A6
            { freq: 1975.53, duration: 0.07 },  // B6
            { freq: 2093.00, duration: 0.05 },  // C7
            { freq: 2349.32, duration: 0.08 },  // D7
        ];
        
        // Harmonic pad (mountain atmosphere)
        const padFrequencies = [261.63, 329.63, 392.00]; // C4, E4, G4 (C major)
        const padOscillators = [];
        
        // Create atmospheric pad
        padFrequencies.forEach((freq) => {
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();
            
            osc.type = 'sine';
            osc.frequency.value = freq;
            
            gain.gain.setValueAtTime(0, audioContext.currentTime);
            gain.gain.linearRampToValueAtTime(0.12, audioContext.currentTime + 1.5);
            
            osc.connect(gain);
            gain.connect(masterGain);
            osc.start();
            
            padOscillators.push({ osc, gain });
        });
        
        // Play fast melody
        let noteIndex = 0;
        const playNextNote = () => {
            if (!holdMusicRef.current) return;
            
            const note = melody[noteIndex];
            const osc = audioContext.createOscillator();
            const noteGain = audioContext.createGain();
            
            osc.type = 'triangle';
            osc.frequency.value = note.freq;
            
            noteGain.gain.setValueAtTime(0, audioContext.currentTime);
            noteGain.gain.linearRampToValueAtTime(0.18, audioContext.currentTime + 0.05);
            noteGain.gain.linearRampToValueAtTime(0.12, audioContext.currentTime + note.duration - 0.05);
            noteGain.gain.linearRampToValueAtTime(0, audioContext.currentTime + note.duration);
            
            osc.connect(noteGain);
            noteGain.connect(masterGain);
            osc.start();
            osc.stop(audioContext.currentTime + note.duration);
            
            noteIndex = (noteIndex + 1) % melody.length;
            
            if (holdMusicRef.current) {
                setTimeout(playNextNote, note.duration * 1000);
            }
        };
        
        // Play bird chirps randomly
        const playBirdChirp = () => {
            if (!holdMusicRef.current) return;
            
            const chirp = birdChirps[Math.floor(Math.random() * birdChirps.length)];
            const osc = audioContext.createOscillator();
            const chirpGain = audioContext.createGain();
            
            osc.type = 'sine';
            osc.frequency.value = chirp.freq;
            
            // Quick chirp envelope
            chirpGain.gain.setValueAtTime(0, audioContext.currentTime);
            chirpGain.gain.linearRampToValueAtTime(0.08, audioContext.currentTime + 0.01);
            chirpGain.gain.linearRampToValueAtTime(0, audioContext.currentTime + chirp.duration);
            
            osc.connect(chirpGain);
            chirpGain.connect(masterGain);
            osc.start();
            osc.stop(audioContext.currentTime + chirp.duration);
            
            // Schedule next chirp (random timing between 0.5-2 seconds)
            if (holdMusicRef.current) {
                setTimeout(playBirdChirp, 500 + Math.random() * 1500);
            }
        };
        
        // Start both melody and chirps
        const melodyTimeout = setTimeout(playNextNote, 300);
        const chirpTimeout = setTimeout(playBirdChirp, 800);
        
        holdMusicRef.current = {
            audioContext,
            masterGain,
            padOscillators,
            melodyTimeout,
            chirpTimeout,
            stop: () => {
                try {
                    clearTimeout(melodyTimeout);
                    clearTimeout(chirpTimeout);
                    padOscillators.forEach(({ osc, gain }) => {
                        gain.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.8);
                        osc.stop(audioContext.currentTime + 0.8);
                        gain.disconnect();
                    });
                    masterGain.disconnect();
                    audioContext.close();
                } catch (e) {
                    console.warn("[Hold Music] Error stopping hold music:", e);
                }
            }
        };
        
        console.log("[Hold Music] Started playing mountain bird chirping music");
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
                    // Show typing indicator before agent message
                    setConversationState("speaking");
                    
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
                {conversationState === "processing" && (
                    <div className="agent-chat-item agent typing-message">
                        <strong>Agent</strong>
                        <div className="typing-indicator">
                            <div className="typing-dot"></div>
                            <div className="typing-dot"></div>
                            <div className="typing-dot"></div>
                        </div>
                    </div>
                )}
                {messages.map((msg, idx) => (
                    <div key={idx} className={`agent-chat-item ${msg.from === "agent" ? "agent" : "user"} bounce-in`}>
                        <strong>{msg.from === "agent" ? "Agent" : "You"}</strong>
                        <div className="bubble-text">{msg.text}</div>
                        <span className="meta">{msg.timestamp.toLocaleTimeString()}</span>
                    </div>
                ))}
                {messages.length === 0 && conversationState !== "processing" && (
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
    const [connectionProgress, setConnectionProgress] = useState(0);
    const progressIntervalRef = useRef(null);

    const handleJoin = async (e) => {
        e.preventDefault();
        if (!roomName.trim() || !participantName.trim()) {
            setError("Room and Participant names are required.");
            return;
        }

        sessionStorage.setItem("livekit-participant-name", participantName.trim());
        setLoading(true);
        setError("");
        setConnectionProgress(0);
        
        // Simulate connection progress
        progressIntervalRef.current = setInterval(() => {
            setConnectionProgress((prev) => {
                if (prev >= 90) return prev;
                return prev + Math.random() * 15;
            });
        }, 300);

        try {
            const data = await getLiveKitToken(roomName, participantName.trim());
            setConnectionProgress(100);
            setToken(data.token);
            setServerUrl(
                data.server_url ||
                    import.meta.env.VITE_LIVEKIT_URL ||
                    "ws://localhost:7880"
            );
            
            // Trigger confetti celebration on successful connection
            if (window.triggerConfetti) {
                window.triggerConfetti();
            }
            
            // Show success notification
            if (window.addNotification) {
                window.addNotification('success', 'Welcome!', `You've joined room "${roomName}" successfully!`);
            }
            
            if (data.agent_dispatched === false) {
                console.log(`Agent "${data.agent_name}" is already active in room "${roomName}".`);
                // Show agent already present notification
                if (window.addNotification) {
                    window.addNotification('agent-join', 'Agent Active', `Agent "${data.agent_name}" is already in the room`);
                }
            } else {
                console.log(`Dispatched agent "${data.agent_name}" to room "${roomName}".`);
                // Show agent join notification
                if (window.addNotification) {
                    setTimeout(() => {
                        window.addNotification('agent-join', 'Agent Joined', `Agent "${data.agent_name}" has joined the conversation`);
                    }, 1000);
                }
            }
            setConnected(true);
        } catch (err) {
            console.error(err);
            setError(
                err.response?.data?.detail ||
                    "Failed to fetch LiveKit token. Ensure the backend is running and configured."
            );
        } finally {
            clearInterval(progressIntervalRef.current);
            setLoading(false);
        }
    };

    // Cleanup interval on unmount
    useEffect(() => {
        return () => {
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
            }
        };
    }, []);

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
        <div className="max-w-2xl mx-auto">
            <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl p-8">
                <div className="mb-8">
                    <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Join LiveKit Session
                    </h2>
                    <p className="text-slate-600 dark:text-slate-400">
                        Connect to a live room with high-fidelity voice capabilities
                    </p>
                </div>
                
                <form onSubmit={handleJoin} className="space-y-6">
                    <div>
                        <label htmlFor="room-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Room Name
                        </label>
                        <input
                            id="room-name"
                            type="text"
                            value={roomName}
                            onChange={(e) => setRoomName(e.target.value)}
                            placeholder="Enter room name"
                            disabled={loading}
                            className="w-full px-4 py-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                    </div>

                    <div>
                        <label htmlFor="participant-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Your Name
                        </label>
                        <input
                            id="participant-name"
                            type="text"
                            value={participantName}
                            onChange={(e) => setParticipantName(e.target.value)}
                            placeholder="Enter participant name"
                            disabled={loading}
                            className="w-full px-4 py-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                    </div>

                    {error && (
                        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm">
                            {error}
                        </div>
                    )}

                    {loading ? (
                        <div className="flex flex-col items-center gap-4 py-8">
                            <div className="w-10 h-10 border-3 border-slate-200 dark:border-slate-700 border-t-blue-500 rounded-full animate-spin"></div>
                            <div className="text-slate-900 dark:text-white font-medium">Connecting to LiveKit...</div>
                            <div className="text-slate-500 dark:text-slate-400 text-sm">Establishing secure connection</div>
                            <div className="w-full max-w-xs h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-300"
                                    style={{ width: `${Math.min(connectionProgress, 100)}%` }}
                                ></div>
                            </div>
                            <div className="text-blue-500 font-semibold">
                                {Math.round(Math.min(connectionProgress, 100))}%
                            </div>
                        </div>
                    ) : (
                        <button 
                            type="submit" 
                            className="w-full py-4 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 transform hover:-translate-y-0.5 transition-all duration-200"
                        >
                            Join Session
                        </button>
                    )}

                    <div className="pt-6 border-t border-slate-200 dark:border-slate-800">
                        <AgentBot />
                    </div>
                </form>
            </div>
        </div>
    );
}

export default LiveKitSession;