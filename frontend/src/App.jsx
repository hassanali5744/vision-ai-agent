import { useState, lazy, Suspense, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "./contexts/ThemeContext";
import Sidebar from "./components/Sidebar";
import TopNavigation from "./components/TopNavigation";
import "./App.css";

const LiveKitSession = lazy(() => import("./components/LiveKitRoom"));
const ConversationHistory = lazy(() => import("./components/ConversationHistory"));
const ScriptManager = lazy(() => import("./components/ScriptManager"));

// Notification System
function NotificationSystem({ notifications, removeNotification }) {
    return (
        <div className="notification-container">
            <AnimatePresence>
                {notifications.map((notification) => (
                    <motion.div
                        key={notification.id}
                        initial={{ opacity: 0, x: 100 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 100 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        className={`notification ${notification.type} ${notification.exiting ? 'exiting' : ''}`}
                    >
                        <div className="notification-icon">
                            {notification.type === 'success' ? '✓' : notification.type === 'agent-join' ? '🤖' : 'ℹ'}
                        </div>
                        <div className="notification-content">
                            <div className="notification-title">{notification.title}</div>
                            <div className="notification-message">{notification.message}</div>
                        </div>
                        <button
                            className="notification-close"
                            onClick={() => removeNotification(notification.id)}
                        >
                            ✕
                        </button>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}

// Particle Effects
function ParticleEffects() {
    const particles = Array.from({ length: 20 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        size: Math.random() * 8 + 4,
        delay: Math.random() * 10,
    }));

    return (
        <div className="particles-container">
            {particles.map((particle) => (
                <motion.div
                    key={particle.id}
                    className="particle"
                    style={{
                        left: `${particle.left}%`,
                        width: `${particle.size}px`,
                        height: `${particle.size}px`,
                    }}
                    animate={{
                        y: ["100vh", "-100vh"],
                        rotate: [0, 720],
                        opacity: [0, 0.6, 0.6, 0],
                    }}
                    transition={{
                        duration: 15 + Math.random() * 7,
                        repeat: Infinity,
                        delay: particle.delay,
                        ease: "linear",
                    }}
                />
            ))}
        </div>
    );
}

// Confetti Effect
function ConfettiEffect({ active }) {
    if (!active) return null;

    const confetti = Array.from({ length: 50 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        color: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][Math.floor(Math.random() * 5)],
        delay: Math.random() * 0.5,
        size: Math.random() * 10 + 5,
    }));

    return (
        <div className="confetti-container">
            <AnimatePresence>
                {confetti.map((item) => (
                    <motion.div
                        key={item.id}
                        className="confetti"
                        style={{
                            left: `${item.left}%`,
                            backgroundColor: item.color,
                            width: `${item.size}px`,
                            height: `${item.size}px`,
                        }}
                        initial={{ y: "-100vh", rotate: 0, opacity: 1 }}
                        animate={{ y: "100vh", rotate: 720, opacity: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{
                            duration: 3,
                            delay: item.delay,
                            ease: "easeOut",
                        }}
                    />
                ))}
            </AnimatePresence>
        </div>
    );
}

function App() {
    const [activeTab, setActiveTab] = useState("livekit");
    const [notifications, setNotifications] = useState([]);
    const [showConfetti, setShowConfetti] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const { isDarkMode, toggleDarkMode } = useTheme();

    const getPageTitle = () => {
        switch (activeTab) {
            case 'livekit': return 'Live Session';
            case 'history': return 'Conversation History';
            case 'scripts': return 'Script Manager';
            case 'analytics': return 'Analytics';
            case 'settings': return 'Settings';
            case 'profile': return 'Profile';
            default: return 'Dashboard';
        }
    };

    const addNotification = (type, title, message) => {
        const id = Date.now();
        setNotifications((prev) => [...prev, { id, type, title, message }]);
        
        setTimeout(() => {
            removeNotification(id);
        }, 5000);
    };

    const removeNotification = (id) => {
        setNotifications((prev) => 
            prev.map((n) => 
                n.id === id ? { ...n, exiting: true } : n
            )
        );
        
        setTimeout(() => {
            setNotifications((prev) => prev.filter((n) => n.id !== id));
        }, 300);
    };

    const triggerConfetti = () => {
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 3000);
    };

    useEffect(() => {
        window.addNotification = addNotification;
        window.triggerConfetti = triggerConfetti;
    }, []);

    return (
        <div className="flex min-h-screen">
            <ParticleEffects />
            <ConfettiEffect active={showConfetti} />
            <NotificationSystem 
                notifications={notifications} 
                removeNotification={removeNotification} 
            />
            
            <Sidebar 
                activeTab={activeTab} 
                setActiveTab={setActiveTab}
                isCollapsed={isCollapsed}
                setIsCollapsed={setIsCollapsed}
            />
            
            <motion.div 
                className={`flex-1 transition-all duration-300 ${
                    isCollapsed ? 'ml-20' : 'ml-64'
                }`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
            >
                <TopNavigation 
                    title={getPageTitle()}
                    isDarkMode={isDarkMode}
                    toggleDarkMode={toggleDarkMode}
                    isCollapsed={isCollapsed}
                />
                
                <main className="pt-20 px-6 pb-6">
                    <Suspense fallback={
                        <div className="loading-container">
                            <div className="loading-spinner"></div>
                            <div className="loading-text">Loading...</div>
                        </div>
                    }>
                        <AnimatePresence mode="wait">
                            {activeTab === "livekit" ? (
                                <motion.div
                                    key="livekit"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                    transition={{ duration: 0.3 }}
                                >
                                    <LiveKitSession />
                                </motion.div>
                            ) : activeTab === "history" ? (
                                <motion.div
                                    key="history"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                    transition={{ duration: 0.3 }}
                                >
                                    <ConversationHistory />
                                </motion.div>
                            ) : activeTab === "scripts" ? (
                                <motion.div
                                    key="scripts"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                    transition={{ duration: 0.3 }}
                                >
                                    <ScriptManager />
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="placeholder"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                    transition={{ duration: 0.3 }}
                                    className="flex items-center justify-center h-96 text-slate-500 dark:text-slate-400"
                                >
                                    <p>Coming soon...</p>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </Suspense>
                </main>
            </motion.div>
        </div>
    );
}

export default App;