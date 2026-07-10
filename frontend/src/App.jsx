import { useState, lazy, Suspense } from "react";
import "./App.css";

const LiveKitSession = lazy(() => import("./components/LiveKitRoom"));
const ConversationHistory = lazy(() => import("./components/ConversationHistory"));
const ScriptManager = lazy(() => import("./components/ScriptManager"));

function App() {
    const [activeTab, setActiveTab] = useState("livekit");

    return (
        <div className="app-container">
            <div className="page-header">
                <div className="badge">
                    <span /> Studio-ready voice experience
                </div>
                <div className="agent-avatar-wrap">
                    <img
                        src="/app.jpg"
                        alt="AI Agent"
                        className="agent-avatar"
                        onError={(e) => {
                            e.currentTarget.style.visibility = "hidden";
                        }}
                    />
                </div>
                <h1 className="main-title">AI Voice Assistant</h1>

                <p className="subtitle">
                    Join a LiveKit room for real-time voice conversation with AI, or review your conversation history.
                </p>
            </div>

            <div className="tabs-container">
                <button
                    className={`tab-btn ${activeTab === "livekit" ? "active" : ""}`}
                    onClick={() => setActiveTab("livekit")}
                >
                    LiveKit Session
                </button>

                <button
                    className={`tab-btn ${activeTab === "history" ? "active" : ""}`}
                    onClick={() => setActiveTab("history")}
                >
                    Conversation History
                </button>

                <button
                    className={`tab-btn ${activeTab === "scripts" ? "active" : ""}`}
                    onClick={() => setActiveTab("scripts")}
                >
                    Script Manager
                </button>
            </div>

            <div className="tab-content">
                <Suspense fallback={<div className="loading">Loading...</div>}>
                    {activeTab === "livekit" ? (
                        <div className="fade-in">
                            <LiveKitSession />
                        </div>
                    ) : activeTab === "history" ? (
                        <div className="fade-in">
                            <ConversationHistory />
                        </div>
                    ) : (
                        <div className="fade-in">
                            <ScriptManager />
                        </div>
                    )}
                </Suspense>
            </div>
        </div>
    );
}

export default App;