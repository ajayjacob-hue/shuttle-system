import React, { useState, useEffect, useRef } from 'react';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';
import { MapPin, AlertTriangle, Power, LogOut } from 'lucide-react';

const DriverDashboard = () => {
    const { user, login, logout } = useAuth();
    const [isLoginMode, setIsLoginMode] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [authError, setAuthError] = useState('');
    const [authLoading, setAuthLoading] = useState(false);

    // Dashboard State
    const socket = useSocket();
    const [isSharing, setIsSharing] = useState(false);
    const [status, setStatus] = useState('OFFLINE'); // OFFLINE, ONLINE, OUT_OF_BOUNDS
    const [location, setLocation] = useState(null);
    const [watchId, setWatchId] = useState(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [startTime, setStartTime] = useState(null);
    const [lastSentTime, setLastSentTime] = useState(null);

    // We use a ref for location to access it inside the worker callback without closure stale state
    const locationRef = useRef(null);
    useEffect(() => {
        locationRef.current = location;
    }, [location]);

    // Timer effect for UI display
    const [elapsed, setElapsed] = useState('00:00');
    useEffect(() => {
        let interval;
        if (isSharing && startTime) {
            interval = setInterval(() => {
                const diff = Math.floor((Date.now() - startTime) / 1000);
                const mins = Math.floor(diff / 60).toString().padStart(2, '0');
                const secs = (diff % 60).toString().padStart(2, '0');
                setElapsed(`${mins}:${secs}`);
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [isSharing, startTime]);


    useEffect(() => {
        if (!socket || !user || user.role !== 'driver') return;

        // Always identify as driver
        socket.emit('join_role', 'driver');

        socket.on('force_stop_sharing', (data) => {
            stopSharing();
            setStatus('OUT_OF_BOUNDS');
            setErrorMsg(data.reason || 'Geofence violation');
        });

        // Re-emit last location on reconnect
        socket.on('connect', () => {
            console.log("Socket reconnected!");
            if (isSharing) {
                socket.emit('join_role', 'driver');
                if (locationRef.current) {
                    emitLocation(locationRef.current.lat, locationRef.current.lng);
                }
            }
        });

        return () => {
            socket.off('force_stop_sharing');
            socket.off('connect');
        };
    }, [socket, isSharing, user]);

    const [sentCount, setSentCount] = useState(0);


    // --- BACKGROUND WORKER & AUDIO HACK ---
    const workerRef = useRef(null);
    const audioRef = useRef(null);
    const [wakeLock, setWakeLock] = useState(null);

    // Initialize Worker Once
    useEffect(() => {
        // Timestamp to bust cache
        workerRef.current = new Worker('/locationWorker.js?v=' + Date.now());

        workerRef.current.onmessage = (e) => {
            if (e.data === 'tick') {
                handleWorkerTick();
            }
        };

        return () => {
            workerRef.current.terminate();
        };
    }, []);

    // The core logic that runs every 2 seconds from the worker
    const handleWorkerTick = () => {
        if (!isSharing) return;

        // 1. HEARTBEAT: Send what we have immediately. 
        if (locationRef.current && socket?.connected && user) {
            socket.emit('update_location', {
                driverId: user.email, // Use EMAIL as the unique Driver ID
                lat: locationRef.current.lat,
                lng: locationRef.current.lng
            });
        } else if (socket?.connected) {
            socket.emit('ping_keepalive');
        }

        // 2. WAKE GPS: Try to get a fresh position
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                handleLocationUpdate(pos.coords);
            },
            (err) => {
                console.log("Worker Tick GPS Poll failed/throttled:", err.code);
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
        );
    };


    useEffect(() => {
        if (isSharing) {
            workerRef.current.postMessage('start');
            const requestWakeLock = async () => {
                if ('wakeLock' in navigator) {
                    try {
                        const lock = await navigator.wakeLock.request('screen');
                        setWakeLock(lock);
                    } catch (err) {
                        console.error("WakeLock failed:", err);
                    }
                }
            };
            requestWakeLock();

            const handleVisChange = async () => {
                if (document.visibilityState === 'visible' && isSharing) {
                    await requestWakeLock();
                }
            };
            document.addEventListener('visibilitychange', handleVisChange);

            if (audioRef.current) {
                audioRef.current.play().catch(e => console.log("Audio autoplay blocked:", e));
            }

            return () => {
                if (wakeLock) wakeLock.release();
                if (audioRef.current) {
                    audioRef.current.pause();
                    audioRef.current.currentTime = 0;
                }
                document.removeEventListener('visibilitychange', handleVisChange);
                workerRef.current.postMessage('stop');
            };
        }
    }, [isSharing]);

    const startSharing = () => {
        if (!socket || !user) return;
        setStatus('ONLINE');
        setIsSharing(true);
        setErrorMsg('');
        setStartTime(Date.now());
        setElapsed('00:00');
        setSentCount(0);

        if (audioRef.current) {
            audioRef.current.play().catch(console.error);
        }

        if (!watchId) {
            const id = navigator.geolocation.watchPosition(
                (pos) => {
                    handleLocationUpdate(pos.coords);
                },
                (err) => {
                    console.error("GPS Watch Error:", err);
                    setErrorMsg("GPS Error: " + err.message);
                },
                {
                    enableHighAccuracy: true,
                    maximumAge: 0,
                    timeout: 5000
                }
            );
            setWatchId(id);
        }
    };

    const emitLocation = (lat, lng) => {
        if (socket && socket.connected && user) {
            socket.emit('update_location', {
                driverId: user.email,
                lat: lat,
                lng: lng
            });
            setSentCount(prev => prev + 1);
        }
    };

    const handleLocationUpdate = ({ latitude, longitude }) => {
        const newLocation = { lat: latitude, lng: longitude };
        setLocation(newLocation);
        locationRef.current = newLocation;
        setLastSentTime(new Date().toLocaleTimeString());
        emitLocation(latitude, longitude);
    };

    const stopSharing = () => {
        if (watchId) navigator.geolocation.clearWatch(watchId);
        if (socket) socket.emit('stop_sharing');
        setWatchId(null);
        setIsSharing(false);
        setStartTime(null);
        if (status !== 'OUT_OF_BOUNDS') setStatus('OFFLINE');
    };

    const handleAuthSubmit = async (e) => {
        e.preventDefault();
        setAuthError('');
        setAuthLoading(true);

        const endpoint = isLoginMode ? '/api/auth/driver/login' : '/api/auth/driver/signup';
        const VITE_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'; // Fallback

        try {
            const res = await fetch(`${VITE_API_URL}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();

            if (!res.ok) throw new Error(data.message || 'Authentication failed');

            if (isLoginMode) {
                login(data.token, data.user);
            } else {
                setAuthError(data.message); // "Please wait for approval"
                setIsLoginMode(true); // Switch to login
            }
        } catch (err) {
            setAuthError(err.message);
        } finally {
            setAuthLoading(false);
        }
    };

    // --- RENDER AUTH SCREEN ---
    if (!user || user.role !== 'driver') {
        return (
            <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
                <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md">
                    <h2 className="text-2xl font-bold mb-6 text-center text-blue-900">
                        {isLoginMode ? 'Driver Login' : 'Driver Signup'}
                    </h2>

                    {authError && (
                        <div className={`p-3 rounded mb-4 text-sm ${authError.includes('wait') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {authError}
                        </div>
                    )}

                    <form onSubmit={handleAuthSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-bold text-gray-700">Email</label>
                            <input
                                type="email"
                                required
                                className="w-full border p-2 rounded"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-700">Password</label>
                            <input
                                type="password"
                                required
                                className="w-full border p-2 rounded"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={authLoading}
                            className="w-full bg-blue-600 text-white font-bold py-2 rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                            {authLoading ? 'Processing...' : (isLoginMode ? 'Login' : 'Sign Up')}
                        </button>
                    </form>

                    <div className="mt-4 text-center">
                        <button
                            type="button"
                            onClick={() => { setIsLoginMode(!isLoginMode); setAuthError(''); }}
                            className="text-blue-500 hover:underline text-sm"
                        >
                            {isLoginMode ? 'Need an account? Sign Up' : 'Already have an account? Login'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // --- RENDER DASHBOARD (LOGGED IN) ---
    return (
        <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col overflow-hidden">
                {/* Header */}
                <div className="bg-blue-600 p-6 text-white shadow-md flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-bold opacity-90">Driver Portal</h2>
                        <p className="text-xs text-blue-200">{user.email}</p>
                    </div>

                    <button onClick={logout} className="p-2 bg-blue-700 rounded hover:bg-blue-800">
                        <LogOut size={20} />
                    </button>
                </div>

                <div className="p-8 flex flex-col space-y-8">
                    {/* Status Indicator */}
                    <div className="flex flex-col items-center justify-center py-4">
                        <div className={`w-32 h-32 rounded-full flex items-center justify-center mb-4 transition-all duration-700 ${status === 'ONLINE' ? 'bg-green-50 text-green-500 ring-8 ring-green-50/50 shadow-green-200 shadow-lg' :
                            status === 'OUT_OF_BOUNDS' ? 'bg-red-50 text-red-500 ring-8 ring-red-50/50' :
                                'bg-gray-50 text-gray-300 ring-8 ring-gray-100'
                            }`}>
                            {status === 'ONLINE' ? <MapPin className="w-14 h-14 animate-bounce" /> :
                                status === 'OUT_OF_BOUNDS' ? <AlertTriangle className="w-14 h-14" /> :
                                    <Power className="w-14 h-14" />}
                        </div>
                        <h3 className={`text-2xl font-bold tracking-widest uppercase transition-colors ${status === 'ONLINE' ? 'text-green-600' :
                            status === 'OUT_OF_BOUNDS' ? 'text-red-500' :
                                'text-gray-400'
                            }`}>
                            {status === 'OUT OF ZONE' ? 'OUT OF ZONE' : status}
                        </h3>
                        <p className="text-sm font-medium text-gray-400 mt-2 h-6 flex items-center gap-2">
                            {status === 'ONLINE' ? (
                                <>
                                    <span>Live: {elapsed}</span>
                                    {sentCount > 0 && <span className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-500">Sent: {sentCount}</span>}
                                </>
                            ) : 'Ready to start'}
                        </p>
                    </div>

                    {/* Error Box */}
                    {errorMsg && (
                        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r animate-pulse">
                            <p className="text-sm text-red-700 font-bold">{errorMsg}</p>
                        </div>
                    )}

                    {/* Main Action Button */}
                    <button
                        onClick={isSharing ? stopSharing : startSharing}
                        className={`w-full py-6 rounded-2xl font-bold text-xl shadow-lg transform transition-all active:scale-95 hover:-translate-y-1 flex items-center justify-center gap-3 ${isSharing
                            ? 'bg-white border-4 border-red-500 text-red-500 hover:bg-red-50 shadow-red-100'
                            : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:shadow-xl shadow-blue-200'
                            }`}
                    >
                        {isSharing ? (
                            <>
                                <span className="relative flex h-3 w-3">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                                </span>
                                STOP SHARING
                            </>
                        ) : 'START SHARING'}
                    </button>

                    {/* Debug Info Overlay */}
                    <div className="bg-black/90 text-green-400 p-4 font-mono text-[10px] w-full overflow-hidden rounded-xl border border-green-900/50 shadow-inner">
                        <div className="grid grid-cols-2 gap-2">
                            <p>STATUS: {socket?.connected ? <span className="text-green-400">CONN</span> : <span className="text-red-500">DISC</span>}</p>
                            <p>MODE: {wakeLock ? '⚡ AWAKE' : '💤 NORMAL'}</p>
                            <p className="col-span-2 truncate">GPS: {location ? `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}` : 'WAITING...'}</p>
                            <p>LAST SENT: {lastSentTime || 'NEVER'}</p>
                            <p>ID: {user.email}</p>
                        </div>
                    </div>
                </div>
            </div>
            {/* Footer Info */}
            <p className="text-center text-xs text-gray-300 mt-4">
                VIT Shuttle System v2.3 (Auth Enabled)
            </p>

            {/* Hidden Video element for audio/media playback keep-alive */}
            <video
                ref={audioRef} // Reusing ref name for simplicity
                playsInline
                muted
                loop
                style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 }}
                src="data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAAAz5tb292AAAAbG12aGQAAAAA629nAAAAAADrb2cAAAH0AAAAEAAAAAAABAAAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACHBhc3AAAAABAAAAAQAAAAABAAAAAQAAAF91ZHRhAAAAW21ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAAYXQ3NwAAACBlbHN0AAAAAAAAAAEAAAH0AAAAAAABAAAAAQAAAAABTG1kYXQAAAAAAAAAIxe4wA33/w=="
            />
        </div>
    );
};

export default DriverDashboard;
