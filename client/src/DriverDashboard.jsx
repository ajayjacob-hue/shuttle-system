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
    const [myBusId, setMyBusId] = useState('Connecting...');

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
        if (isSharing && socket && location && myBusId !== 'Connecting...') {
            socket.emit('update_location', {
                driverId: myBusId,
                lat: location.lat,
                lng: location.lng
            });
            setSentCount(prev => prev + 1);
        }
    }, [isSharing, socket, location, myBusId]);


    const startSharing = () => {
        if (!socket) return;
        setStatus('ONLINE');
        setIsSharing(true);
        setErrorMsg('');
        setStartTime(Date.now());
        setElapsed('00:00');
        setSentCount(0);

        // The watchPosition is now handled by a useEffect, but we still need to set watchId
        // to be able to clear it later. The useEffect above will start watching.
        // We need to ensure the watchId is set correctly from that useEffect.
        // For now, we'll rely on the useEffect to manage the watch, and this function
        // primarily toggles the `isSharing` state which then triggers the emit effect.
        // The actual watchId setting is implicitly handled by the new useEffect.
        // To make it explicit, we could pass a setter to the useEffect or return the id.
        // For simplicity, let's assume the useEffect handles the watch lifecycle.
        // If we need to clear it, we'd need the ID.
        // Re-introducing watchPosition here to manage watchId directly.
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
                <div className="bg-blue-600 p-6 text-white flex justify-between items-center shadow-md">
                    <div>
                        <h2 className="text-xl font-bold opacity-90">Driver Portal</h2>
                        <div className="flex items-baseline gap-2">
                            <p className="text-blue-100 text-2xl font-black tracking-tight">{myBusId}</p>
                            <span className={`text-xs font-bold uppercase ${socket?.connected ? 'text-green-300' : 'text-red-300 animate-pulse'}`}>
                                {socket?.connected ? 'Connected' : 'Reconnecting...'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="p-8 flex flex-col space-y-8">
                    {/* Status Indicator */}
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
                        {status === 'OUT_OF_BOUNDS' ? 'OUT OF ZONE' : status}
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

                {/* Main Action Button - Smaller & Cleaner */}
                <button
                    onClick={isSharing ? stopSharing : startSharing}
                    className={`w-full py-4 rounded-2xl font-bold text-xl shadow-lg transform transition-all active:scale-95 hover:-translate-y-1 flex items-center justify-center gap-3 ${isSharing
                        ? 'bg-white border-2 border-red-500 text-red-500 hover:bg-red-50 shadow-red-100'
                        : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200'
                        }`}
                >
                    {isSharing ? 'STOP SHARING' : 'START SHARING'}
                </button>

                {/* Debug Info Overlay */}
                <div className="bg-black/80 text-green-400 p-4 font-mono text-xs w-full overflow-hidden">
                    <p>STATUS : {socket?.connected ? 'CONNECTED' : 'DISCONNECTED'}</p>
                    <p>GPS    : {location ? `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}` : 'Signal Lost / Waiting...'}</p>
                    <p>SENT   : {sentCount} packets</p>
                    <p>BUS ID : {myBusId}</p>
                    <p>FREQ   : Realtime (On Change)</p>
                </div>

                {/* Footer Info */}
                <p className="text-center text-xs text-gray-300 mt-4">
                    VIT Shuttle System v1.2
                </p>
            </div>
        </div>

    );
};

export default DriverDashboard;
