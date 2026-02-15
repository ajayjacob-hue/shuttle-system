import React, { useState, useEffect } from 'react';
import { useSocket } from './SocketContext';
import { MapPin, AlertTriangle, Power, Bus } from 'lucide-react';

const DriverDashboard = () => {
    const socket = useSocket();
    const [isSharing, setIsSharing] = useState(false);
    const [status, setStatus] = useState('OFFLINE'); // OFFLINE, ONLINE, OUT_OF_BOUNDS
    const [location, setLocation] = useState(null);
    const [watchId, setWatchId] = useState(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [startTime, setStartTime] = useState(null);
    const [myBusId, setMyBusId] = useState('Bus 1');
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

        return () => {
            socket.off('force_stop_sharing');
            stopSharing();
        };
    }, [socket]);

    const [sentCount, setSentCount] = useState(0);

    // Effect to emit location when sharing and location updates
    useEffect(() => {
        if (isSharing && socket && location) {
            socket.emit('update_location', {
                driverId: myBusId,
                lat: location.lat,
                lng: location.lng
            });
            setSentCount(prev => prev + 1);
        }
    }, [isSharing, socket, location, myBusId]);

    // WAKE LOCK & BACKGROUND AUDIO HACK
    // Keeps the browser active when switching apps (e.g. for payments)
    const [wakeLock, setWakeLock] = useState(null);
    useEffect(() => {
        if (isSharing) {
            // 1. Request Screen Wake Lock
            const requestWakeLock = async () => {
                if ('wakeLock' in navigator) {
                    try {
                        const lock = await navigator.wakeLock.request('screen');
                        setWakeLock(lock);
                        console.log('Wake Lock active');
                    } catch (err) {
                        console.error(`Wake Lock failed: ${err.name}, ${err.message}`);
                    }
                }
            };
            requestWakeLock();

            // 2. Play silent audio loop to keep background thread alive
            // (Browser throttles JS in background unless media is playing)
            const audio = new Audio('https://github.com/anars/blank-audio/raw/master/10-seconds-of-silence.mp3');
            audio.loop = true;
            audio.play().catch(e => console.log("Audio play failed (interaction needed):", e));

            return () => {
                if (wakeLock) wakeLock.release();
                audio.pause();
                audio.src = "";
            };
        }
    }, [isSharing]);


    const startSharing = () => {
        if (!socket) return;
        setStatus('ONLINE');
        setIsSharing(true);
        setErrorMsg('');
        setStartTime(Date.now());
        setElapsed('00:00');
        setSentCount(0);

        // Start watching logic is handled by useEffect in original code or re-added here?
        // In previous steps I relied on a separate useEffect for watchPosition or assumed it was there.
        // Let's ensure watchPosition is active.
        // Actually, looking at the full file view from previous steps, there was a watchPosition inside startSharing but I might have removed it or it's in a useEffect.
        // Let's stick to the pattern:
        // 1. Join role 'driver'
        // 2. Select ID
        // 3. Start Sharing -> triggers isSharing=true -> triggers useEffect that emits data

        // We need to ensure we track location if not already tracking.
        if (!watchId) {
            const id = navigator.geolocation.watchPosition(
                (pos) => {
                    const { latitude, longitude } = pos.coords;
                    setLocation({ lat: latitude, lng: longitude });
                },
                (err) => {
                    console.error(err);
                    setErrorMsg('GPS Error: ' + err.message);
                    setStatus('OFFLINE');
                    setIsSharing(false);
                },
                { enableHighAccuracy: true }
            );
            setWatchId(id);
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
                        {/* ... existing status UI ... */}
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
                        <p className="text-sm font-medium text-gray-400 mt-2 h-6">
                            {status === 'ONLINE' ? `Live for: ${elapsed}` : 'Ready to start'}
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
                            <p>SENT: {sentCount}</p>
                            <p>ID: {myBusId}</p>
                        </div>
                    </div>
                </div>
            </div>
            {/* Footer Info */}
            <p className="text-center text-xs text-gray-300 mt-4">
                VIT Shuttle System v1.3
            </p>
        </div>
    );
};

export default DriverDashboard;
