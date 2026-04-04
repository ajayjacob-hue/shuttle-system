import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { SocketProvider } from './SocketContext';
import { AuthProvider } from './AuthContext';
import DriverDashboard from './DriverDashboard';
import StudentDashboard from './StudentDashboard';
import AdminDashboard from './AdminDashboard';
import InstallPrompt from './InstallPrompt';
import { ThemeProvider, useTheme } from './ThemeContext';
import { Bus, User, ShieldCheck, Sun, Moon } from 'lucide-react';

// Landing Page Component
const Landing = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 dark:from-gray-950 dark:via-gray-900 dark:to-black flex items-center justify-center p-4 transition-colors duration-500">
      <div className="bg-white/10 dark:bg-black/20 backdrop-blur-xl p-10 rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.3)] w-full max-w-md text-center border border-white/20 relative overflow-hidden">
        {/* Decorative background glow */}
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-blue-500 rounded-full blur-3xl opacity-20 dark:opacity-10"></div>
        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-indigo-500 rounded-full blur-3xl opacity-20 dark:opacity-10"></div>
        
        <div className="bg-white/10 dark:bg-white/5 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner border border-white/10 relative z-10 backdrop-blur-md">
           <Bus size={44} className="text-white drop-shadow-md" />
        </div>
        
        <h1 className="text-4xl font-extrabold mb-2 text-white tracking-tight relative z-10 drop-shadow-sm">VIT Shuttle</h1>
        <p className="text-blue-200 dark:text-blue-400 mb-10 text-sm font-medium relative z-10">Real-time campus transit tracking</p>

        <div className="space-y-4 relative z-10">
          <button
            onClick={() => navigate('/driver')}
            className="w-full group relative flex items-center justify-center gap-3 bg-white dark:bg-gray-800 text-blue-900 dark:text-blue-100 font-bold py-4 px-6 rounded-2xl hover:bg-blue-50 dark:hover:bg-gray-700 transition-all shadow-lg hover:shadow-xl hover:-translate-y-1 overflow-hidden"
          >
            <div className="absolute inset-0 bg-blue-50 dark:bg-blue-900/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <User size={20} className="relative z-10" />
            <span className="relative z-10 tracking-wide">Login as Driver</span>
          </button>

          <button
            onClick={() => navigate('/student')}
            className="w-full group relative flex items-center justify-center gap-3 bg-blue-500/20 dark:bg-blue-500/10 text-white font-bold py-4 px-6 rounded-2xl hover:bg-blue-500/30 dark:hover:bg-blue-500/20 border border-blue-400/30 dark:border-blue-500/20 transition-all shadow-lg hover:shadow-xl hover:-translate-y-1 overflow-hidden"
          >
            <div className="absolute inset-0 bg-blue-400/20 dark:bg-blue-400/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <Bus size={20} className="relative z-10" />
            <span className="relative z-10 tracking-wide">Track Shuttles</span>
          </button>

          <div className="pt-8">
            <button
              onClick={() => navigate('/admin')}
              className="flex items-center justify-center gap-2 mx-auto text-xs font-semibold text-blue-300 dark:text-gray-500 hover:text-white dark:hover:text-blue-400 transition-colors uppercase tracking-wider"
            >
              <ShieldCheck size={16} /> Admin Control Panel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ThemeToggle = () => {
    const { isDark, toggleTheme } = useTheme();
    return (
        <button
            onClick={toggleTheme}
            className="fixed top-4 right-4 z-[9999] p-3 rounded-full bg-white/20 dark:bg-black/40 backdrop-blur-md shadow-lg border border-gray-200/20 text-gray-800 dark:text-blue-300 hover:scale-110 transition-transform"
            title="Toggle Dark Mode"
        >
            {isDark ? <Sun size={20} /> : <Moon size={20} />}
        </button>
    );
};

function App() {
  return (
    <ThemeProvider>
      <SocketProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/driver" element={<DriverDashboard />} />
            <Route path="/student" element={<StudentDashboard />} />
            <Route path="/admin" element={<AdminDashboard />} />
          </Routes>

          {/* Global Back Button (hidden on landing) */}
          {window.location.pathname !== '/' && (
            <a href="/" className="fixed bottom-4 left-4 bg-gray-800 dark:bg-blue-600 text-white px-4 py-2 rounded-full font-bold text-xs opacity-60 hover:opacity-100 transition-all z-[9999] shadow-lg border border-white/10">
              HOME
            </a>
          )}
          
          <InstallPrompt />
          <ThemeToggle />
        </BrowserRouter>
      </AuthProvider>
    </SocketProvider>
    </ThemeProvider>
  );
}

export default App;
