import React, { useState, useEffect, useRef } from 'react';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';
import { MapPin, AlertTriangle, Power, LogOut } from 'lucide-react';
import { Capacitor, registerPlugin } from '@capacitor/core';

const BackgroundGeolocation = registerPlugin("BackgroundGeolocation");

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
    const [shuttleNumber, setShuttleNumber] = useState(null);

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

        socket.on('shuttle_info', (data) => {
            setShuttleNumber(data.shuttleNumber);
        });

        return () => {
            socket.off('force_stop_sharing');
            socket.off('connect');
            socket.off('shuttle_info');
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

        // 2. WAKE GPS: Try to get a fresh position (only needed for web, Capacitor watcher takes care of this)
        if (!Capacitor.isNativePlatform()) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    handleLocationUpdate(pos.coords);
                },
                (err) => {
                    console.log("Worker Tick GPS Poll failed/throttled:", err.code);
                },
                { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
            );
        }
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

    const showPersistentNotification = async () => {
        if ('serviceWorker' in navigator && 'Notification' in window) {
            if (Notification.permission === 'granted') {
                const reg = await navigator.serviceWorker.ready;
                reg.showNotification('Shuttle Live Location Active', {
                    body: 'Your live location is being transmitted in the background.',
                    icon: '/app-icon.svg',
                    vibrate: [200, 100, 200],
                    tag: 'live-location',
                    renotify: true,
                    requireInteraction: true,
                });
            }
        }
    };

    const clearPersistentNotification = async () => {
        if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.ready;
            const notifications = await reg.getNotifications({ tag: 'live-location' });
            notifications.forEach(notification => notification.close());
        }
    };

    const startSharing = async () => {
        if (!socket || !user) return;
        
        if ('Notification' in window && Notification.permission !== 'granted') {
            await Notification.requestPermission();
        }

        setStatus('ONLINE');
        setIsSharing(true);
        setErrorMsg('');
        setStartTime(Date.now());
        setElapsed('00:00');
        setSentCount(0);
        
        showPersistentNotification();

        if (audioRef.current) {
            audioRef.current.play().catch(console.error);
        }

        if (Capacitor.isNativePlatform()) {
            try {
                const id = await BackgroundGeolocation.addWatcher(
                    {
                        backgroundMessage: "Your live location is being transmitted in the background.",
                        backgroundTitle: "Shuttle Live Tracking",
                        requestPermissions: true,
                        stale: false,
                        distanceFilter: 0
                    },
                    (pos, err) => {
                        if (err) {
                            console.error("Capacitor GPS Watch Error:", err);
                            setErrorMsg("GPS Error: " + err.message);
                        } else if (pos) {
                            handleLocationUpdate({ latitude: pos.latitude, longitude: pos.longitude });
                        }
                    }
                );
                setWatchId(id);
            } catch (err) {
                console.error("Failed to start Capacitor watch:", err);
                setErrorMsg("Capacitor GPS Error: " + err.message);
            }
        } else {
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

    const handleStopSharing = () => {
        const confirmed = window.confirm("Are you sure you want to stop sharing your live location?");
        if (confirmed) {
            stopSharing();
        }
    };

    const stopSharing = () => {
        if (watchId) {
            if (Capacitor.isNativePlatform()) {
                BackgroundGeolocation.removeWatcher({ id: watchId });
            } else {
                navigator.geolocation.clearWatch(watchId);
            }
        }
        if (socket) socket.emit('stop_sharing');
        setWatchId(null);
        setIsSharing(false);
        setStartTime(null);
        setShuttleNumber(null);
        if (status !== 'OUT_OF_BOUNDS') setStatus('OFFLINE');
        clearPersistentNotification();
    };

    // Auto-fill email
    useEffect(() => {
        const savedEmail = localStorage.getItem('rememberedDriverEmail');
        if (savedEmail) setEmail(savedEmail);
    }, []);

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
                localStorage.setItem('rememberedDriverEmail', email); // Save email
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
            <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-blue-900 to-blue-800 dark:from-gray-950 dark:via-gray-900 dark:to-indigo-950 flex flex-col items-center justify-center p-4 transition-colors duration-500">
                <div className="mb-8 text-center">
                    <div className="bg-white/10 backdrop-blur-md w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4 border border-white/20 shadow-2xl">
                        <User size={40} className="text-white" />
                    </div>
                    <h1 className="text-3xl font-black text-white tracking-tight">DRIVER PORTAL</h1>
                    <p className="text-blue-200 text-xs mt-1 font-bold uppercase tracking-[0.3em]">Access Authorized Only</p>
                </div>

                <div className="bg-white/10 dark:bg-black/20 backdrop-blur-2xl p-8 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.3)] w-full max-w-md border border-white/20 relative overflow-hidden">
                    {/* Decorative glow inside */}
                    <div className="absolute -top-10 -right-10 w-32 h-32 bg-blue-400/20 rounded-full blur-3xl"></div>

                    <h2 className="text-2xl font-bold mb-6 text-center text-white relative z-10">
                        {isLoginMode ? 'Welcome Back' : 'Join the Fleet'}
                    </h2>

                    {authError && (
                        <div className={`p-4 rounded-2xl mb-6 text-sm font-medium flex items-center gap-2 border animate-in fade-in slide-in-from-top-2 duration-300 relative z-10 ${
                            authError.includes('wait') 
                            ? 'bg-green-500/10 border-green-500/30 text-green-400' 
                            : 'bg-red-500/10 border-red-500/30 text-red-400'
                        }`}>
                            {authError.includes('wait') ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
                            {authError}
                        </div>
                    )}

                    <form onSubmit={handleAuthSubmit} className="space-y-5 relative z-10">
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-blue-100/70 uppercase tracking-wider ml-1">Fleet Email</label>
                            <div className="relative group">
                                <input
                                    type="email"
                                    required
                                    className="w-full bg-white/5 border border-white/10 text-white px-4 py-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 transition-all placeholder-white/20"
                                    placeholder="driver@vit.ac.in"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-blue-100/70 uppercase tracking-wider ml-1">Security Key</label>
                            <input
                                type="password"
                                required
                                className="w-full bg-white/5 border border-white/10 text-white px-4 py-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400/50 transition-all placeholder-white/20"
                                placeholder="••••••••"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={authLoading}
                            className="w-full group relative flex items-center justify-center gap-2 bg-white text-blue-900 font-black py-4 rounded-2xl hover:bg-blue-50 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl disabled:opacity-50 mt-4"
                        >
                            {authLoading ? (
                                <RefreshCw className="animate-spin" size={20} />
                            ) : (
                                <>
                                    <span>{isLoginMode ? 'INITIALIZE SESSION' : 'SUBMIT APPLICATION'}</span>
                                </>
                            )}
                        </button>
                    </form>

                    <div className="mt-8 text-center relative z-10">
                        <button
                            type="button"
                            onClick={() => { setIsLoginMode(!isLoginMode); setAuthError(''); }}
                            className="text-blue-100/60 hover:text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 mx-auto"
                        >
                            {isLoginMode ? "Don't have an account? Sign Up" : "Already registered? Sign In"}
                        </button>
                    </div>
                    
                    <div className="mt-6 pt-6 border-t border-white/10 text-center relative z-10">
                        <button
                            type="button"
                            onClick={() => window.location.href = '/'}
                            className="text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest transition-colors"
                        >
                            ← Abort and Return
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // --- RENDER DASHBOARD (LOGGED IN) ---
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center p-4 transition-colors duration-500">
            <div className="bg-white dark:bg-gray-900 rounded-[2.5rem] shadow-2xl w-full max-w-md flex flex-col overflow-hidden border border-gray-100 dark:border-gray-800">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-8 text-white flex justify-between items-center relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-10 -mt-10 blur-2xl"></div>
                    <div className="relative z-10">
                        <h2 className="text-2xl font-black tracking-tight">{shuttleNumber ? `Shuttle ${shuttleNumber}` : 'Driver Module'}</h2>
                        <p className="text-xs text-blue-100/80 font-medium">{user.email}</p>
                    </div>

                    <button onClick={logout} className="relative z-10 p-3 bg-white/20 backdrop-blur-md rounded-2xl hover:bg-white/30 transition-colors shadow-lg group">
                        <LogOut size={22} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                </div>

                <div className="p-8 flex flex-col space-y-8">
                    {/* Status Indicator */}
                    <div className="flex flex-col items-center justify-center py-6">
                        <div className={`w-40 h-40 rounded-[3rem] flex items-center justify-center mb-6 transition-all duration-700 relative ${
                             status === 'ONLINE' ? 'bg-green-500/10 text-green-500 ring-[12px] ring-green-500/5 shadow-[0_0_40px_rgba(34,197,94,0.2)]' :
                             status === 'OUT_OF_BOUNDS' ? 'bg-red-500/10 text-red-500 ring-[12px] ring-red-500/5' :
                             'bg-gray-100 dark:bg-gray-800 text-gray-300 dark:text-gray-600 ring-[12px] ring-gray-100/50 dark:ring-gray-800/50'
                        }`}>
                            {status === 'ONLINE' ? (
                                <>
                                    <MapPin className="w-16 h-16 animate-bounce" />
                                    <span className="absolute inset-0 rounded-[3rem] border-4 border-green-500 animate-ping opacity-20"></span>
                                </>
                            ) :
                                status === 'OUT_OF_BOUNDS' ? <AlertTriangle className="w-16 h-16" /> :
                                    <Power className="w-16 h-16" />}
                        </div>
                        <h3 className={`text-3xl font-black tracking-tighter uppercase transition-colors ${
                            status === 'ONLINE' ? 'text-green-500' :
                            status === 'OUT_OF_BOUNDS' ? 'text-red-500' :
                            'text-gray-300 dark:text-gray-700'
                        }`}>
                            {status === 'OUT OF ZONE' ? 'OUT OF ZONE' : status}
                        </h3>
                        <div className="mt-3 flex flex-col items-center">
                            {status === 'ONLINE' ? (
                                <div className="flex items-center gap-3 bg-gray-100 dark:bg-gray-800 px-4 py-2 rounded-full">
                                    <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></div>
                                    <span className="text-sm font-black text-gray-700 dark:text-gray-300">{elapsed}</span>
                                    {sentCount > 0 && <span className="text-[10px] bg-blue-500 text-white px-2 py-0.5 rounded-full font-bold">SENT {sentCount}</span>}
                                </div>
                            ) : (
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Protocol Stood Down</p>
                            )}
                        </div>
                    </div>

                    {/* Error Box */}
                    {errorMsg && (
                        <div className="bg-red-500/10 border-l-4 border-red-500 p-5 rounded-r-2xl animate-shake">
                            <p className="text-sm text-red-500 font-black flex items-center gap-2">
                                <AlertTriangle size={16} /> {errorMsg}
                            </p>
                        </div>
                    )}

                    {/* Main Action Button */}
                    <button
                        onClick={isSharing ? handleStopSharing : startSharing}
                        className={`w-full py-6 rounded-3xl font-black text-xl shadow-[0_15px_30px_rgba(0,0,0,0.1)] transform transition-all active:scale-95 flex items-center justify-center gap-4 ${isSharing
                            ? 'bg-white dark:bg-gray-900 border-4 border-red-500 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/5'
                            : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-indigo-500/25'
                            }`}
                    >
                        {isSharing ? (
                            <>
                                <StopCircle className="animate-pulse" />
                                STOP TRANSMISSION
                            </>
                        ) : (
                            <>
                                <Power />
                                BEGIN MISSION
                            </>
                        )}
                    </button>

                    {/* Debug Terminal */}
                    <div className="bg-gray-950 text-emerald-400 p-5 font-mono text-[10px] w-full overflow-hidden rounded-2xl border border-emerald-500/20 shadow-inner relative">
                        <div className="absolute top-2 right-3 flex gap-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-red-500/50"></div>
                            <div className="w-1.5 h-1.5 rounded-full bg-yellow-500/50"></div>
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500/50"></div>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 opacity-80">
                            <p className="flex justify-between"><span>LINK:</span> <span>{socket?.connected ? 'STABLE' : 'DROPPED'}</span></p>
                            <p className="flex justify-between"><span>POWER:</span> <span>{wakeLock ? 'BOOST' : 'CRUISE'}</span></p>
                            <p className="col-span-2 border-t border-emerald-500/10 pt-1 mt-1 truncate">
                                GPS COORDS: {location ? `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}` : 'ACQUIRING...'}
                            </p>
                            <p className="col-span-2 flex justify-between">
                                <span>TIMESTAMP:</span> <span>{lastSentTime || '---'}</span>
                            </p>
                            <p className="col-span-2 opacity-40 text-[8px] tracking-tighter">DRIVER_ID: {user.email}</p>
                        </div>
                    </div>
                </div>
            </div>
            {/* Footer */}
            <p className="text-center text-[10px] font-black text-gray-400 dark:text-gray-600 mt-6 uppercase tracking-[0.4em]">
                VIT Fleet Command • v2.5.0-Final
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
