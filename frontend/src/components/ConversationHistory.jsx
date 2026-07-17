import { useEffect, useState } from "react";
import { Search, MessageSquare, User, Bot, Clock } from "lucide-react";
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
        <div className="max-w-4xl mx-auto">
            <div className="mb-8">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    Conversation History
                </h2>
                <p className="text-slate-600 dark:text-slate-400">
                    Search by room name or participant name to view conversation history
                </p>
            </div>

            {/* Search Mode Toggle */}
            <div className="flex gap-2 mb-6">
                <button
                    onClick={() => setSearchMode("room")}
                    className={`px-4 py-2 rounded-xl font-medium transition-all ${
                        searchMode === "room"
                            ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/25"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                    }`}
                >
                    Search by Room
                </button>
                <button
                    onClick={() => setSearchMode("participant")}
                    className={`px-4 py-2 rounded-xl font-medium transition-all ${
                        searchMode === "participant"
                            ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/25"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                    }`}
                >
                    Search by Participant
                </button>
                <button
                    onClick={loadAllRooms}
                    className="px-4 py-2 rounded-xl font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
                >
                    Load All Rooms
                </button>
            </div>

            {/* Search Form */}
            <form onSubmit={handleSearch} className="flex gap-4 mb-6">
                <div className="flex-1">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        {searchMode === "room" ? "Room name" : "Participant name"}
                    </label>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            value={searchName}
                            onChange={(e) => setSearchName(e.target.value)}
                            placeholder={searchMode === "room" ? "Enter room name (e.g., voice-demo)" : "Enter participant name"}
                            className="w-full pl-10 pr-4 py-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        />
                    </div>
                </div>
                <div className="flex items-end">
                    <button
                        type="submit"
                        className="px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 transform hover:-translate-y-0.5 transition-all duration-200"
                    >
                        {searchMode === "room" ? "Load Room" : "Find rooms"}
                    </button>
                </div>
            </form>

            {loadingRooms && (
                <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                    Searching for matching rooms...
                </div>
            )}
            
            {error && (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 mb-6">
                    {error}
                </div>
            )}

            {searchedName && !loadingRooms && availableRooms.length === 0 && (
                <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                    No rooms were found for {searchedName}
                </div>
            )}

            {/* Available Rooms */}
            {availableRooms.length > 0 && (
                <div className="mb-6">
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-3">
                        {searchMode === "room" ? "Available rooms" : searchedName ? `Rooms found for ${searchedName}` : "All available rooms"}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {availableRooms.map((r) => (
                            <button
                                key={r}
                                onClick={() => setRoom(r)}
                                className={`px-4 py-2 rounded-full font-medium transition-all ${
                                    room === r
                                        ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/25"
                                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                                }`}
                            >
                                {r}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {loading && (
                <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                    Loading history logs...
                </div>
            )}
            
            {!loading && !room && searchedName && (
                <div className="text-center py-16 text-slate-400 italic">
                    Choose a room above to view the chat history
                </div>
            )}
            
            {!loading && !room && !searchedName && (
                <div className="text-center py-16 text-slate-400 italic">
                    Enter a name to look up the room and conversation history
                </div>
            )}
            
            {!loading && room && groupedHistory.rooms.length === 0 && (
                <div className="text-center py-16 text-slate-500 dark:text-slate-400">
                    No stream history recorded for this room
                </div>
            )}

            {/* Conversation Cards */}
            {room && groupedHistory.rooms.length > 0 && (
                <div className="space-y-6">
                    {groupedHistory.rooms.map((roomData) => {
                        const timeline = buildTimeline(roomData);

                        return (
                            <div key={roomData.room} className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
                                {/* Room Header */}
                                <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-800">
                                    <div className="flex items-center gap-3">
                                        <MessageSquare className="w-5 h-5 text-blue-500" />
                                        <span className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                            Active Room
                                        </span>
                                    </div>
                                    <span className="px-4 py-2 bg-blue-500/10 text-blue-500 rounded-full text-sm font-semibold">
                                        #{roomData.room}
                                    </span>
                                </div>

                                {timeline.length === 0 ? (
                                    <div className="p-8 text-center text-slate-400 italic">
                                        Empty room state — no payload items processed
                                    </div>
                                ) : (
                                    <div className="p-6 space-y-4">
                                        {timeline.map((msg) => {
                                            const isAgent = msg._type === "agent";
                                            
                                            return (
                                                <div
                                                    key={msg._key}
                                                    className={`flex ${isAgent ? "justify-start" : "justify-end"}`}
                                                >
                                                    <div className={`max-w-[85%] rounded-2xl p-4 ${
                                                        isAgent
                                                            ? "bg-green-500/10 border border-green-500/20"
                                                            : "bg-blue-500/10 border border-blue-500/20"
                                                    }`}>
                                                        <div className="flex items-center gap-3 mb-2">
                                                            {isAgent ? (
                                                                <Bot className="w-4 h-4 text-green-500" />
                                                            ) : (
                                                                <User className="w-4 h-4 text-blue-500" />
                                                            )}
                                                            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                                                {isAgent ? "System Agent" : "User Session"}
                                                            </span>
                                                            {msg.created_at && (
                                                                <span className="flex items-center gap-1 text-xs text-slate-400">
                                                                    <Clock className="w-3 h-3" />
                                                                    {new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-slate-900 dark:text-white leading-relaxed">
                                                            {msg.text}
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default ConversationHistory;