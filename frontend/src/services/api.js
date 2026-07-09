import axios from "axios";

const API = axios.create({
    baseURL: "http://localhost:8000",
    timeout: 30000, // 30 second timeout for transcription
});

// Add response interceptor for better error logging
API.interceptors.response.use(
    (response) => {
        console.log(`[DEBUG] API Response: ${response.config.url} - Status: ${response.status}`);
        return response;
    },
    (error) => {
        console.error(`[ERROR] API Error: ${error.config?.url} -`, error.message);
        if (error.response) {
            console.error(`[ERROR] Response data:`, error.response.data);
            console.error(`[ERROR] Response status:`, error.response.status);
        }
        return Promise.reject(error);
    }
);

export const transcribeAudio = async (audioBlob, reply = false, roomName = "voice-demo", participantName = "guest") => {
    try {
        if (!audioBlob || audioBlob.size === 0) {
            console.error("[ERROR] transcribeAudio: Empty audio blob received");
            return { transcript: "", error: "Empty audio" };
        }

        const blobType = audioBlob.type || "audio/webm";
        const extension = blobType.includes("ogg")
            ? "ogg"
            : blobType.includes("mp4")
              ? "mp4"
              : blobType.includes("wav")
                ? "wav"
                : "webm";
        const fileName = audioBlob.name || `recording_${Date.now()}.${extension}`;

        const formData = new FormData();
        formData.append("audio", audioBlob, fileName);

        console.log(
            `[DEBUG] transcribeAudio: Sending ${audioBlob.size} bytes to /transcribe?reply=${reply}`
        );
        console.log(`[DEBUG] transcribeAudio: Blob type: ${blobType}, filename: ${fileName}`);
        
        // Make the request
        const response = await API.post(`/transcribe?reply=${reply}&room=${encodeURIComponent(roomName)}&participant=${encodeURIComponent(participantName)}`, formData, {
            headers: {
                "Content-Type": "multipart/form-data",
            },
        });
        
        console.log(`[DEBUG] transcribeAudio: Backend response:`, response.data);
        
        // Ensure we return a consistent format
        if (response.data && typeof response.data === 'object') {
            return {
                transcript: response.data.transcript || response.data.text || "",
                ...response.data
            };
        }
        
        return { transcript: "", error: "Invalid response format" };
        
    } catch (error) {
        console.error("[ERROR] transcribeAudio API call failed:", error.message);
        
        // Provide more detailed error information
        if (error.response) {
            console.error("[ERROR] Response status:", error.response.status);
            console.error("[ERROR] Response data:", error.response.data);
            
            // Handle specific HTTP errors
            if (error.response.status === 413) {
                console.error("[ERROR] Audio file too large");
                return { transcript: "", error: "File too large" };
            } else if (error.response.status === 415) {
                console.error("[ERROR] Unsupported audio format");
                return { transcript: "", error: "Unsupported format" };
            } else if (error.response.status === 500) {
                console.error("[ERROR] Server error during transcription");
                return { transcript: "", error: "Server error" };
            }
        } else if (error.code === 'ECONNABORTED') {
            console.error("[ERROR] Request timeout");
            return { transcript: "", error: "Timeout" };
        } else if (error.request) {
            console.error("[ERROR] No response received from server");
            return { transcript: "", error: "No response" };
        }
        
        // Return empty transcript on error
        return { transcript: "", error: error.message };
    }
};

export const saveChatMessage = async ({ room, participant, speaker, text, metadata = {} }) => {
    try {
        const response = await API.post("/chat/messages", {
            room,
            participant,
            speaker,
            text,
            metadata,
        });
        return response.data;
    } catch (error) {
        console.error("[ERROR] saveChatMessage failed:", error.message);
        return { success: false, error: error.message };
    }
};

export const getHistory = async ({ room = "", participant = "", limit = 100 } = {}) => {
    try {
        const response = await API.get("/history", {
            params: { room, participant, limit },
        });
        return response.data;
    } catch (error) {
        console.error("[ERROR] getHistory failed:", error.message);
        return { success: false, grouped_history: { rooms: [] } };
    }
};

export const getRooms = async () => {
    try {
        const response = await API.get("/rooms");
        return response.data.rooms || [];
    } catch (error) {
        console.error("[ERROR] getRooms failed:", error.message);
        return [];
    }
};

export const getLiveKitToken = async (roomName, participantName) => {
    try {
        console.log(`[DEBUG] getLiveKitToken: Requesting token for room "${roomName}", participant "${participantName}"`);
        
        const response = await API.get("/livekit/token", {
            params: {
                room: roomName,
                identity: participantName,
            },
        });
        
        console.log(`[DEBUG] getLiveKitToken: Token received successfully`);
        return response.data;
        
    } catch (error) {
        console.error("[ERROR] getLiveKitToken failed:", error.message);
        
        if (error.response) {
            console.error("[ERROR] Response status:", error.response.status);
            console.error("[ERROR] Response data:", error.response.data);
        }
        
        throw error;
    }
};

// Optional: Add a function to test the transcription API
export const testTranscription = async () => {
    try {
        // Create a silent audio blob for testing
        const sampleAudio = new Blob([new Uint8Array(1000)], { type: 'audio/webm' });
        const result = await transcribeAudio(sampleAudio, false);
        console.log("[DEBUG] Test transcription result:", result);
        return result;
    } catch (error) {
        console.error("[ERROR] Test transcription failed:", error);
        throw error;
    }
};

export default API;