import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from './SocketContext';

const AdminLogin = () => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();
    const socket = useSocket();

    const handleLogin = (e) => {
        e.preventDefault();
        if (!socket) return;

        socket.emit('admin_login', password, (response) => {
            if (response.success) {
                // Store auth state locally (session storage is fine for prototype)
                sessionStorage.setItem('admin_auth', 'true');
                navigate('/admin/dashboard');
            } else {
                setError('Invalid Password');
            }
        });
    };

    return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
            <div className="bg-gray-800 p-8 rounded-xl shadow-2xl w-full max-w-sm border border-gray-700">
                <h2 className="text-2xl font-bold text-white mb-6 text-center">Admin Access</h2>
                <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                        <label className="block text-gray-400 text-sm font-bold mb-2">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-gray-700 text-white border border-gray-600 rounded p-3 focus:outline-none focus:border-blue-500"
                            placeholder="Enter admin password"
                        />
                    </div>
                    {error && <p className="text-red-500 text-sm text-center">{error}</p>}
                    <button
                        type="submit"
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded transition-colors"
                    >
                        Login
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/')}
                        className="w-full text-gray-500 hover:text-gray-300 text-sm mt-2"
                    >
                        Cancel
                    </button>
                </form>
            </div>
        </div>
    );
};

export default AdminLogin;
