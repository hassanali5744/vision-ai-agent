import { useEffect, useState } from "react";
import axios from "axios";

function ConversationHistory() {
    const [groupedHistory, setGroupedHistory] = useState({ rooms: [] });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [room, setRoom] = useState("");
    const [searchName, setSearchName] = useState("");
    const [searchedName, setSearchedName] = useState("");
    const [availableRooms, setAvailableRooms] = useState([]);
    const [loadingRooms, setLoadingRooms] = useState(false);
    const [searchMode, setSearchMode] = useState("room");

    const loadRoomsForParticipant = async (name) => {
        const normalized = name.trim();
        if (!normalized) {
            setAvailableRooms([]);
            setRoom("");
            setGroupedHistory({ rooms: [] });
            return;
        }

        setLoadingRooms(true);
        setError("");
        try {
            const response = await axios.get("http://localhost:8000/rooms", {
                params: { participant: normalized },
            });
            const rooms = response.data.rooms || [];
            setAvailableRooms(rooms);

            if (rooms.length === 1) {
                setRoom(rooms[0]);
            } else {
                setRoom("");
                setGroupedHistory({ rooms: [] });
            }
        } catch (err) {
            console.error("Failed to load rooms:", err);
            setError("Unable to find rooms for that name. Please try again.");
            setAvailableRooms([]);
            setRoom("");
            setGroupedHistory({ rooms: [] });
        } finally {
            setLoadingRooms(false);
        }
    };

    const loadAllRooms = async () => {
        setLoadingRooms(true);
        setError("");
        try {
            const response = await axios.get("http://localhost:8000/rooms");
            const rooms = response.data.rooms || [];
            setAvailableRooms(rooms);
            if (rooms.length === 1) {
                setRoom(rooms[0]);
            } else {
                setRoom("");
                setGroupedHistory({ rooms: [] });
            }
        } catch (err) {
            console.error("Failed to load all rooms:", err);
            setError("Unable to load rooms. Please try again.");
            setAvailableRooms([]);
            setRoom("");
            setGroupedHistory({ rooms: [] });
        } finally {
            setLoadingRooms(false);
        }
    };

    useEffect(() => {
        const loadHistory = async () => {
            if (!room || !room.trim()) {
                setGroupedHistory({ rooms: [] });
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                const response = await axios.get("http://localhost:8000/history", {
                    params: {
                        room: room.trim(),
                        participant: searchMode === "participant" ? searchedName || "" : "",
                        limit: 100,
                    },
                });
                setGroupedHistory(response.data.grouped_history || { rooms: [] });
                setError("");
            } catch (err) {
                setError("Unable to load conversation history. Please try again.");
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        loadHistory();
    }, [room, searchedName, searchMode]);

    const handleSearch = (e) => {
        e.preventDefault();
        const normalizedInput = searchName.trim();
        
        if (searchMode === "room") {
            if (!normalizedInput) {
                setError("Please enter a room name.");
                setAvailableRooms([]);
                setRoom("");
                setGroupedHistory({ rooms: [] });
                return;
            }
            setRoom(normalizedInput);
            setSearchedName("");
        } else {
            if (!normalizedInput) {
                setError("Please enter a name to find the room.");
                setAvailableRooms([]);
                setRoom("");
                setGroupedHistory({ rooms: [] });
                return;
            }
            setSearchedName(normalizedInput);
            loadRoomsForParticipant(normalizedInput);
        }
    };

    const buildTimeline = (roomData) => {
        const agentMsgs = (roomData.agent_messages || []).map((msg, i) => ({
            ...msg,
            _type: "agent",
            _key: `agent-${i}`,
        }));
        const userMsgs = (roomData.user_messages || []).map((msg, i) => ({
            ...msg,
            _type: "user",
            _key: `user-${i}`,
        }));

        return [...agentMsgs, ...userMsgs].sort((a, b) => {
            const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
            const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
            return tA - tB;
        });
    };

    return (
        <div style={{
            fontFamily: "Inter, system-ui, sans-serif",
            maxWidth: "900px",
            margin: "24px auto",
            padding: "32px",
            background: "linear-gradient(180deg, rgba(10, 18, 34, 0.98) 0%, rgba(8, 15, 28, 0.98) 100%)",
            border: "1px solid rgba(148, 163, 184, 0.18)",
            borderRadius: "24px",
            boxShadow: "0 32px 80px -20px rgba(2, 8, 23, 0.85), 0 0 40px rgba(96, 165, 250, 0.05)",
            backdropFilter: "blur(20px)"
        }}>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "24px", color: "#f8fafc", fontWeight: 700, letterSpacing: "-0.02em" }}>Conversation History</h3>
            <p style={{ margin: "0 0 28px 0", fontSize: "15px", color: "#cbd5e1", lineHeight: "1.6" }}>Search by room name or participant name to view conversation history.</p>

            <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" }}>
                <button
                    onClick={() => setSearchMode("room")}
                    style={{
                        padding: "10px 20px",
                        borderRadius: "999px",
                        border: searchMode === "room" ? "1px solid #60a5fa" : "1px solid rgba(148, 163, 184, 0.18)",
                        backgroundColor: searchMode === "room" ? "rgba(59, 130, 246, 0.2)" : "rgba(15, 23, 42, 0.7)",
                        color: "#f8fafc",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: 600,
                        transition: "all 0.3s ease",
                        boxShadow: searchMode === "room" ? "0 0 20px rgba(96, 165, 250, 0.2)" : "none"
                    }}
                >
                    Search by Room
                </button>
                <button
                    onClick={() => setSearchMode("participant")}
                    style={{
                        padding: "10px 20px",
                        borderRadius: "999px",
                        border: searchMode === "participant" ? "1px solid #60a5fa" : "1px solid rgba(148, 163, 184, 0.18)",
                        backgroundColor: searchMode === "participant" ? "rgba(59, 130, 246, 0.2)" : "rgba(15, 23, 42, 0.7)",
                        color: "#f8fafc",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: 600,
                        transition: "all 0.3s ease",
                        boxShadow: searchMode === "participant" ? "0 0 20px rgba(96, 165, 250, 0.2)" : "none"
                    }}
                >
                    Search by Participant
                </button>
                <button
                    onClick={loadAllRooms}
                    style={{
                        padding: "10px 20px",
                        borderRadius: "999px",
                        border: "1px solid rgba(148, 163, 184, 0.18)",
                        backgroundColor: "rgba(15, 23, 42, 0.7)",
                        color: "#cbd5e1",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: 600,
                        transition: "all 0.3s ease"
                    }}
                >
                    Load All Rooms
                </button>
            </div>

            <form onSubmit={handleSearch} style={{ display: "flex", gap: "14px", flexWrap: "wrap", marginBottom: "24px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: "260px", flex: 1 }}>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "#e2e8f0", letterSpacing: "0.02em" }}>
                        {searchMode === "room" ? "Room name" : "Participant name"}
                    </span>
                    <input
                        value={searchName}
                        onChange={(e) => setSearchName(e.target.value)}
                        placeholder={searchMode === "room" ? "Enter room name (e.g., voice-demo)" : "Enter participant name"}
                        style={{
                            padding: "12px 16px",
                            borderRadius: "12px",
                            border: "1px solid rgba(148, 163, 184, 0.18)",
                            backgroundColor: "rgba(15, 23, 42, 0.8)",
                            fontSize: "15px",
                            outline: "none",
                            color: "#f8fafc",
                            transition: "all 0.3s ease"
                        }}
                    />
                </div>
                <button
                    type="submit"
                    style={{
                        alignSelf: "flex-end",
                        padding: "12px 24px",
                        borderRadius: "12px",
                        border: "none",
                        background: "linear-gradient(135deg, #3b82f6, #2563eb)",
                        color: "#fff",
                        cursor: "pointer",
                        fontWeight: 700,
                        fontSize: "15px",
                        boxShadow: "0 4px 20px rgba(59, 130, 246, 0.3)",
                        transition: "all 0.3s ease"
                    }}
                >
                    {searchMode === "room" ? "Load Room" : "Find rooms"}
                </button>
            </form>

            {loadingRooms && <p style={{ color: "#cbd5e1", fontSize: "15px" }}>Searching for matching rooms...</p>}
            {error && <p style={{ color: "#fecaca", backgroundColor: "rgba(127, 29, 29, 0.2)", padding: "14px 18px", borderRadius: "12px", fontSize: "15px", border: "1px solid rgba(248, 113, 113, 0.3)", boxShadow: "0 0 20px rgba(239, 68, 68, 0.15)" }}>{error}</p>}

            {searchedName && !loadingRooms && availableRooms.length === 0 && (
                <p style={{ color: "#cbd5e1", fontSize: "15px", marginBottom: "20px" }}>No rooms were found for {searchedName}.</p>
            )}

            {availableRooms.length > 0 && (
                <div style={{ marginBottom: "24px" }}>
                    <p style={{ fontSize: "14px", color: "#cbd5e1", marginBottom: "12px", fontWeight: 500 }}>
                        {searchMode === "room" ? "Available rooms" : searchedName ? `Rooms found for ${searchedName}` : "All available rooms"}
                    </p>
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                        {availableRooms.map((r) => (
                            <button
                                key={r}
                                onClick={() => setRoom(r)}
                                style={{
                                    padding: "10px 18px",
                                    borderRadius: "9999px",
                                    border: room === r ? "1px solid #60a5fa" : "1px solid rgba(148, 163, 184, 0.18)",
                                    backgroundColor: room === r ? "rgba(59, 130, 246, 0.2)" : "rgba(15, 23, 42, 0.7)",
                                    color: "#f8fafc",
                                    cursor: "pointer",
                                    fontSize: "14px",
                                    fontWeight: 600,
                                    transition: "all 0.3s ease",
                                    boxShadow: room === r ? "0 0 20px rgba(96, 165, 250, 0.2)" : "none"
                                }}
                            >
                                {r}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {loading && <p style={{ color: "#cbd5e1", fontSize: "15px" }}>Loading history logs...</p>}
            {!loading && !room && searchedName && <p style={{ color: "#9ca3af", fontStyle: "italic", textAlign: "center", margin: "48px 0", fontSize: "15px" }}>Choose a room above to view the chat history.</p>}
            {!loading && !room && !searchedName && <p style={{ color: "#9ca3af", fontStyle: "italic", textAlign: "center", margin: "48px 0", fontSize: "15px" }}>Enter a name to look up the room and conversation history.</p>}
            {!loading && room && groupedHistory.rooms.length === 0 && <p style={{ color: "#cbd5e1", textAlign: "center", margin: "48px 0", fontSize: "15px" }}>No stream history recorded for this room.</p>}

            {room && (
                <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
                    {groupedHistory.rooms.map((roomData) => {
                        const timeline = buildTimeline(roomData);

                        return (
                            <div key={roomData.room} style={{ display: "flex", flexDirection: "column" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                                    <span style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#94a3b8" }}>Active Room</span>
                                    <span style={{ fontSize: "14px", fontWeight: 700, color: "#bfdbfe", backgroundColor: "rgba(59, 130, 246, 0.2)", padding: "6px 14px", borderRadius: "9999px", boxShadow: "0 0 20px rgba(96, 165, 250, 0.2)" }}>#{roomData.room}</span>
                                </div>

                                {timeline.length === 0 && (
                                    <p style={{ color: "#9ca3af", fontStyle: "italic", fontSize: "15px", padding: "16px 0" }}>Empty room state — no payload items processed.</p>
                                )}

                                <div style={{ display: "flex", flexDirection: "column", gap: "14px", background: "rgba(15, 23, 42, 0.5)", borderRadius: "16px", padding: "20px", border: "1px solid rgba(148, 163, 184, 0.18)" }}>
                                    {timeline.map((msg) => {
                                        const isAgent = msg._type === "agent";
                                        const bubbleBg = isAgent ? "rgba(34, 197, 94, 0.18)" : "rgba(15, 23, 42, 0.95)";
                                        const bubbleBorder = isAgent ? "rgba(74, 222, 128, 0.4)" : "rgba(148, 163, 184, 0.25)";
                                        const titleColor = isAgent ? "#dcfce7" : "#e2e8f0";

                                        return (
                                            <div
                                                key={msg._key}
                                                style={{
                                                    display: "flex",
                                                    justifyContent: isAgent ? "flex-start" : "flex-end",
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        borderRadius: "12px",
                                                        border: `1px solid ${bubbleBorder}`,
                                                        padding: "14px 16px",
                                                        backgroundColor: bubbleBg,
                                                        maxWidth: "85%",
                                                        boxShadow: isAgent ? "0 0 20px rgba(52, 211, 153, 0.15)" : "0 2px 8px rgba(0,0,0,0.1)",
                                                        transition: "all 0.3s ease"
                                                    }}
                                                >
                                                    <div style={{
                                                        fontSize: "11px",
                                                        marginBottom: "8px",
                                                        display: "flex",
                                                        justifyContent: "space-between",
                                                        alignItems: "center",
                                                        gap: "16px",
                                                        color: "#94a3b8"
                                                    }}>
                                                        <span style={{ fontWeight: 700, color: titleColor, textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.04em" }}>
                                                            {isAgent ? "🤖 System Agent" : "👤 User Session"}
                                                        </span>
                                                        <span>{msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ""}</span>
                                                    </div>

                                                    <div style={{ fontSize: "15px", color: "#f8fafc", lineHeight: "1.6", wordBreak: "break-word" }}>
                                                        {msg.text}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default ConversationHistory;