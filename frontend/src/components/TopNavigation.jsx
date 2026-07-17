import { Bell, Moon, Sun, Search } from 'lucide-react';

export default function TopNavigation({ title, isDarkMode, toggleDarkMode, isCollapsed }) {
  return (
    <header className={`fixed top-0 right-0 h-16 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200 dark:border-slate-800 transition-all duration-300 z-40 ${
      isCollapsed ? 'left-20' : 'left-64'
    }`}>
      <div className="flex items-center justify-between h-full px-6">
        {/* Page Title */}
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">{title}</h1>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-4">
          {/* Search */}
          <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search..."
              className="bg-transparent border-none outline-none text-sm text-slate-900 dark:text-white placeholder-slate-400 w-40"
            />
          </div>

          {/* Notifications */}
          <button className="relative p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-600 dark:text-slate-400">
            <Bell className="w-5 h-5" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
          </button>

          {/* Dark Mode Toggle */}
          <button
            onClick={toggleDarkMode}
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-600 dark:text-slate-400"
          >
            {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>

          {/* User Avatar */}
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-semibold cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all">
            U
          </div>
        </div>
      </div>
    </header>
  );
}
