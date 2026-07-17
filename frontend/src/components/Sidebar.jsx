import { useState } from 'react';
import { 
  Mic, 
  MessageSquare, 
  FileText, 
  BarChart3, 
  Settings, 
  User,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Menu,
  X
} from 'lucide-react';

const menuItems = [
  { id: 'livekit', label: 'Live Session', icon: Mic },
  { id: 'history', label: 'Conversation History', icon: MessageSquare },
  { id: 'scripts', label: 'Script Manager', icon: FileText },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'profile', label: 'Profile', icon: User },
];

export default function Sidebar({ activeTab, setActiveTab, isCollapsed, setIsCollapsed }) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800"
      >
        <Menu className="w-5 h-5 text-slate-600 dark:text-slate-400" />
      </button>

      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={`fixed left-0 top-0 h-full bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-r border-slate-200 dark:border-slate-800 transition-all duration-300 z-50 ${
          isCollapsed ? 'w-20' : 'w-64'
        } ${isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
          {!isCollapsed && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <span className="font-semibold text-slate-900 dark:text-white">Voice AI</span>
            </div>
          )}
          <button
            onClick={() => {
              setIsCollapsed(!isCollapsed);
              setIsMobileOpen(false);
            }}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-600 dark:text-slate-400"
          >
            {isMobileOpen ? <X className="w-5 h-5" /> : isCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setIsMobileOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                  isActive
                    ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/25'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className={`w-5 h-5 ${isCollapsed ? 'mx-auto' : ''}`} />
                {!isCollapsed && <span className="font-medium">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* User Profile (Bottom) */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-200 dark:border-slate-800">
          {!isCollapsed && (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-semibold">
                U
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-900 dark:text-white">User</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Pro Plan</p>
              </div>
            </div>
          )}
          {isCollapsed && (
            <div className="w-10 h-10 mx-auto rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-semibold">
              U
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
