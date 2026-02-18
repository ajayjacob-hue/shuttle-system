import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { SocketProvider } from './SocketContext';
import DriverDashboard from './DriverDashboard';
import StudentDashboard from './StudentDashboard';
import AdminLogin from './AdminLogin';
import AdminDashboard from './AdminDashboard';

// Landing Page Component
const Landing = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md text-center">
        <h1 className="text-3xl font-bold mb-8 text-blue-900">VIT Shuttle Portal</h1>

        <div className="space-y-4">
          <button
            onClick={() => navigate('/driver')}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition"
          >
            Login as Driver
          </button>

          <button
            onClick={() => navigate('/student')}
            className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-4 rounded-lg transition"
          >
            View as Student
          </button>

          <div className="pt-4 border-t border-gray-100">
            <button
              onClick={() => navigate('/admin')}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              Admin Access
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

function App() {
  return (
    <SocketProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/driver" element={<DriverDashboard />} />
          <Route path="/student" element={<StudentDashboard />} />
          <Route path="/admin" element={<AdminLogin />} />
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
        </Routes>

        {/* Global Back Button (hidden on landing) */}
        {window.location.pathname !== '/' && (
          <a href="/" className="fixed bottom-4 left-4 bg-gray-800 text-white px-3 py-1 rounded-full text-xs opacity-50 hover:opacity-100 z-[9999]">
            Home
          </a>
        )}
      </BrowserRouter>
    </SocketProvider>
  );
}

export default App;
