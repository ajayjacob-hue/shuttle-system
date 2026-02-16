import React, { useState, useEffect, useRef } from 'react';
import { useSocket } from './SocketContext';
import { MapPin, AlertTriangle, Power, Bus, RefreshCw } from 'lucide-react';

const DriverDashboard = () => {
    const socket = useSocket();
    const [isSharing, setIsSharing] = useState(false);
    const [status, setStatus] = useState('OFFLINE'); // OFFLINE, ONLINE, OUT_OF_BOUNDS
    const [location, setLocation] = useState(null);
    const [watchId, setWatchId] = useState(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [startTime, setStartTime] = useState(null);
    const [lastSentTime, setLastSentTime] = useState(null);

    // Persist Bus Selection
    const [myBusId, setMyBusId] = useState(localStorage.getItem('shuttle_driver_id') || 'Bus 1');

    useEffect(() => {
        localStorage.setItem('shuttle_driver_id', myBusId);
    }, [myBusId]);

    const BUS_OPTIONS = ['Bus 1', 'Bus 2', 'Bus 3', 'Bus 4', 'Bus 5', 'Bus 6', 'Bus 7', 'Bus 8', 'Bus 9', 'Bus 10'];

    // Timer effect
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
        if (!socket) return;

        socket.emit('join_role', 'driver');

        socket.on('force_stop_sharing', (data) => {
            stopSharing();
            setStatus('OUT_OF_BOUNDS');
            setErrorMsg(data.reason || 'Geofence violation');
        });

        // Re-emit last location on reconnect
        socket.on('connect', () => {
            if (isSharing && location) {
                socket.emit('join_role', 'driver');
                socket.emit('update_location', {
                    driverId: myBusId,
                    lat: location.lat,
                    lng: location.lng
                });
            }
        });

        return () => {
            socket.off('force_stop_sharing');
            socket.off('connect');
            // Don't stop sharing on unmount automatically to survive refreshes if we want, 
            // but for now, cleanup is safer.
            // stopSharing(); 
        };
    }, [socket, isSharing, location, myBusId]);

    const [sentCount, setSentCount] = useState(0);

    // BACKGROUND ALIVE HACK (Video + Heartbeat)
    const videoRef = useRef(null);
    const [wakeLock, setWakeLock] = useState(null);

    useEffect(() => {
        let heartbeatInterval;

        if (isSharing) {
            // 1. WAKE LOCK (Screen)
            const requestWakeLock = async () => {
                if ('wakeLock' in navigator) {
                    try {
                        const lock = await navigator.wakeLock.request('screen');
                        setWakeLock(lock);
                        console.log("Wake Lock active");
                    } catch (err) {
                        console.error("WakeLock failed:", err);
                    }
                }
            };
            requestWakeLock();

            // Re-acquire wake lock if visibility changes
            const handleVisChange = async () => {
                if (document.visibilityState === 'visible' && isSharing) {
                    await requestWakeLock();
                }
            };
            document.addEventListener('visibilitychange', handleVisChange);


            // 2. VIDEO HACK (Prevents Tab Freezing)
            if (videoRef.current) {
                videoRef.current.play().catch(e => console.log("Video autoplay blocked:", e));
            }

            // 3. SOCKET HEARTBEAT (Prevents connection closing & keeps alive)
            // Send a 'ping' every 10 seconds to keep the socket active
            heartbeatInterval = setInterval(() => {
                if (socket?.connected) {
                    // Send a dummy update if real GPS hasn't fired in a while
                    // This keeps the socket "hot"
                    socket.emit('ping_keepalive');
                }
            }, 10000);

            return () => {
                if (wakeLock) wakeLock.release();
                if (videoRef.current) {
                    videoRef.current.pause();
                }
                clearInterval(heartbeatInterval);
                document.removeEventListener('visibilitychange', handleVisChange);
            };
        }
    }, [isSharing, socket]);

    const startSharing = () => {
        if (!socket) return;
        setStatus('ONLINE');
        setIsSharing(true);
        setErrorMsg('');
        setStartTime(Date.now());
        setElapsed('00:00');
        setSentCount(0);

        if (!watchId) {
            // PRIMARY: Watch Position
            // IMPORTANT: 'enableHighAccuracy: true' is CRITICAL for persistent background tracking on many devices
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
                    timeout: 10000
                }
            );
            setWatchId(id);
        }
    };

    // Helper to deduplicate logic
    const handleLocationUpdate = ({ latitude, longitude }) => {
        const newLocation = { lat: latitude, lng: longitude };
        setLocation(newLocation);
        setLastSentTime(new Date().toLocaleTimeString());

        if (socket && socket.connected) {
            // DIRECT EMIT: Don't rely on React state effects which might throttle
            socket.emit('update_location', {
                driverId: myBusId,
                lat: latitude,
                lng: longitude
            });
            setSentCount(prev => prev + 1);
        }
    };

    const stopSharing = () => {
        if (watchId) navigator.geolocation.clearWatch(watchId);
        if (socket) socket.emit('stop_sharing');
        setWatchId(null);
        setIsSharing(false);
        setStartTime(null);
        if (status !== 'OUT_OF_BOUNDS') setStatus('OFFLINE');
    };

    return (
        <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col overflow-hidden">
                {/* Header */}
                <div className="bg-blue-600 p-6 text-white shadow-md">
                    <h2 className="text-xl font-bold opacity-90 mb-2">Driver Portal</h2>

                    {/* Bus Selector */}
                    <div className="flex items-center gap-3">
                        <div className="relative w-full">
                            <select
                                value={myBusId}
                                onChange={(e) => setMyBusId(e.target.value)}
                                disabled={isSharing}
                                className="w-full bg-blue-700 text-white font-bold text-xl py-2 px-4 rounded-lg appearance-none border border-blue-500 focus:outline-none focus:ring-2 focus:ring-white/50 disabled:opacity-50"
                            >
                                {BUS_OPTIONS.map(opt => (
                                    <option key={opt} value={opt} className="bg-white text-gray-900">{opt}</option>
                                ))}
                            </select>
                            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
                                <svg className="w-5 h-5 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                        </div>

                        <span className={`text-xs font-bold uppercase shrink-0 ${socket?.connected ? 'text-green-300' : 'text-red-300 animate-pulse'}`}>
                            {socket?.connected ? 'Connected' : '...'}
                        </span>
                    </div>
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
                            <p>ID: {myBusId}</p>
                        </div>
                    </div>
                </div>
            </div>
            {/* Footer Info */}
            <p className="text-center text-xs text-gray-300 mt-4">
                VIT Shuttle System v2.0 (Persistent)
            </p>

            {/* Hidden Video for Background Keep-Alive - Base64 Safe Version */}
            <video
                ref={videoRef}
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
