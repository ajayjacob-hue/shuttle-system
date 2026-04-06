import React, { useState, useEffect, useRef } from 'react';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';
import { MapPin, AlertTriangle, Power, LogOut } from 'lucide-react';
import { API_URL } from './config';
import { Capacitor, registerPlugin, CapacitorHttp } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

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
    const [showGpsModal, setShowGpsModal] = useState(false);
    const [showBatteryGuide, setShowBatteryGuide] = useState(false);

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
                    // Fail silently
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
                        // Fail silently
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
                audioRef.current.play().catch(e => {});
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

    const startSharing = async (showModal = true) => {
        if (!socket || !user) return;

            // 1. Check Permissions & GPS Status
            try {
                const perm = await Geolocation.checkPermissions();
                if (perm.location !== 'granted') {
                    const req = await Geolocation.requestPermissions();
                    if (req.location !== 'granted') {
                        setErrorMsg("Location permission denied. Cannot start tracking.");
                        return;
                    }
                }

                // Request Notification Permission for Android 13+ (for background notification)
                if (Capacitor.getPlatform() === 'android') {
                    const notifPerm = await Geolocation.requestPermissions(); // Re-using permission check for general safety
                }

                // Test if GPS is actually ON by trying a quick poll
                await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 3000 });
            } catch (err) {
                // On Android, if GPS is OFF, getCurrentPosition throws an error
                if (showModal) setShowGpsModal(true);
                return;
            }

        setShowGpsModal(false); // Close modal if GPS check passes successfully
        
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
            audioRef.current.play().catch(() => {});
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
                            setErrorMsg("GPS Error: " + err.message);
                        } else if (pos) {
                            handleLocationUpdate({ latitude: pos.latitude, longitude: pos.longitude });
                        }
                    }
                );
                setWatchId(id);
            } catch (err) {
                setErrorMsg("Capacitor GPS Error: " + err.message);
            }
        } else {
            if (!watchId) {
                const id = navigator.geolocation.watchPosition(
                    (pos) => {
                        handleLocationUpdate(pos.coords);
                    },
                    (err) => {
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

    const emitLocation = async (lat, lng) => {
        if (!user) return;
        const data = { driverId: user.email, lat, lng };

        if (socket && socket.connected) {
            socket.emit('update_location', data);
            setSentCount(prev => prev + 1);
        } else {
            // FALLBACK TO HTTP IN BACKGROUND (When socket is suspended)
            try {
                // USE NATIVE HTTP BRIDGE TO BYPASS BACKGROUND THROTTLING
                await CapacitorHttp.post({
                    url: `${API_URL}/api/driver/location`,
                    headers: { 'Content-Type': 'application/json' },
                    data: data
                });
                setSentCount(prev => prev + 1);
                setLastSentTime(new Date().toLocaleTimeString() + " (Fixed)");
            } catch (err) {
                // Fallback fail
            }
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

    const stopSharing = async () => {
        if (watchId) {
            if (Capacitor.isNativePlatform()) {
                BackgroundGeolocation.removeWatcher({ id: watchId });
            } else {
                navigator.geolocation.clearWatch(watchId);
            }
        }
        
        // Reliability: Always call the stop API and emit on socket if possible
        const data = { driverId: user.email };
        
        if (socket && socket.connected) {
            socket.emit('stop_sharing', data);
        }

        // Use Native HTTP to ensure stop signal reaches the server (even if socket is disconnected)
        try {
            await CapacitorHttp.post({
                url: `${API_URL}/api/driver/stop`,
                headers: { 'Content-Type': 'application/json' },
                data: data
            });
        } catch (err) {
            // Error handling
        }

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

        try {
            const res = await fetch(`${API_URL}${endpoint}`, {
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
                    
                    <div className="mt-6 pt-4 border-t border-gray-100 text-center">
                        <button
                            type="button"
                            onClick={() => window.location.href = '/'}
                            className="text-gray-400 hover:text-gray-600 underline text-sm"
                        >
                            Back to Home
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
                        <h2 className="text-xl font-bold opacity-90">{shuttleNumber ? `Shuttle ${shuttleNumber}` : 'Driver Portal'}</h2>
                        <p className="text-xs text-blue-200">{user.email}</p>
                    </div>

                    <button onClick={logout} className="p-2 bg-blue-700 rounded hover:bg-blue-800">
                        <LogOut size={20} />
                    </button>
                </div>

                {/* Battery Optimization Banner */}
                {Capacitor.isNativePlatform() && !isSharing && (
                    <div className="bg-yellow-50 p-4 border-b border-yellow-100 flex items-start gap-3">
                        <AlertTriangle className="text-yellow-600 shrink-0 mt-0.5" size={18} />
                        <div className="flex-1">
                            <p className="text-xs font-bold text-yellow-800">Background Tracking Tip</p>
                            <p className="text-[10px] text-yellow-700 mt-1">
                                For permanent background tracking, ensure battery optimization is set to 
                                <span className="font-bold"> "Unrestricted"</span> in App Info.
                            </p>
                            <button 
                                onClick={() => setShowBatteryGuide(true)}
                                className="text-[10px] text-blue-600 font-bold mt-1 underline"
                            >
                                View Step-by-Step Guide
                            </button>
                        </div>
                    </div>
                )}

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
                        onClick={isSharing ? handleStopSharing : startSharing}
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

            {/* GPS DISBLED MODAL */}
            {showGpsModal && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[10000] p-6">
                    <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="bg-red-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-2">
                            <AlertTriangle className="text-red-600 w-10 h-10" />
                        </div>
                        <h3 className="text-2xl font-bold text-gray-900">Location Turned Off</h3>
                        <p className="text-gray-500 text-sm">
                            Your device's GPS (Location Services) is turned off. We need it to track the shuttle position.
                        </p>
                        <button 
                            onClick={() => { setShowGpsModal(false); setTimeout(() => startSharing(false), 500); }}
                            className="w-full bg-blue-600 text-white font-bold py-3 rounded-2xl shadow-lg active:scale-95 transition-all"
                        >
                            I've Turned It On
                        </button>
                    </div>
                </div>
            )}

            {/* BATTERY GUIDE MODAL */}
            {showBatteryGuide && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[10000] p-6">
                    <div className="bg-white rounded-3xl p-8 max-w-sm w-full space-y-6 shadow-2xl overflow-y-auto max-h-[80vh]">
                        <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                             Unrestricted Access
                        </h3>
                        <div className="space-y-4 text-sm text-gray-600">
                            <p>To ensure location doesn't stop in the background:</p>
                            <ol className="list-decimal pl-5 space-y-3">
                                <li>Long-press the <strong>Shuttle App icon</strong> on your home screen.</li>
                                <li>Tap <strong>"App Info"</strong> (or the 'i' icon).</li>
                                <li>Go to <strong>"Battery"</strong> or "Battery Usage".</li>
                                <li>Select <strong>"Unrestricted"</strong> (it may be on 'Optimized').</li>
                                <li>Also ensure <strong>"Background Location"</strong> is set to "Allow all the time" in Permissions.</li>
                            </ol>
                        </div>
                        <button 
                            onClick={() => setShowBatteryGuide(false)}
                            className="w-full bg-gray-100 text-gray-800 font-bold py-3 rounded-2xl active:scale-95 transition-all"
                        >
                            Got it, I'll do this
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DriverDashboard;
