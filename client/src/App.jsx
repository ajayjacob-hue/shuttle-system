import React, { useState } from 'react';
import { SocketProvider } from './SocketContext';
import DriverDashboard from './DriverDashboard';
import StudentDashboard from './StudentDashboard';

function App() {
  // Load saved view from localStorage (default to landing)
  const [view, setViewState] = useState(localStorage.getItem('shuttle_last_role') || 'landing');

  const setView = (role) => {
    localStorage.setItem('shuttle_last_role', role);
    setViewState(role);
  };

  if (view === 'landing') {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md text-center">
          <h1 className="text-3xl font-bold mb-8 text-blue-900">VIT Shuttle Portal</h1>

          <div className="space-y-4">
            <button
              onClick={() => setView('driver')}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition"
            >
              Login as Driver
            </button>

            <button
              onClick={() => setView('student')}
              className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-4 rounded-lg transition"
            >
              View as Student
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <SocketProvider>
      {view === 'driver' ? <DriverDashboard /> : <StudentDashboard />}

      {/* Back Button for Demo */}
      <button
        onClick={() => setView('landing')}
        className="fixed bottom-4 left-4 bg-gray-800 text-white px-3 py-1 rounded-full text-xs opacity-50 hover:opacity-100 z-50"
      >
        Back to Home
      </button>
    </SocketProvider>
  );
}

export default App;
