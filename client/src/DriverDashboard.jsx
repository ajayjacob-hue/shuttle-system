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

    const startSharing = () => {
        if (!socket) return;
        setStatus('ONLINE');
        setIsSharing(true);
        setErrorMsg('');
        setStartTime(Date.now());
        setElapsed('00:00');

        const id = navigator.geolocation.watchPosition(
            (pos) => {
                const { latitude, longitude } = pos.coords;
                setLocation({ lat: latitude, lng: longitude });

                socket.emit('update_location', {
                    driverId: 'bus-01', // Mock driver ID
                    lat: latitude,
                    lng: longitude
                });
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
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
                {/* Header */}
                <div className="bg-blue-900 p-6 text-white flex justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-bold">Driver Portal</h2>
                        <p className="text-blue-200 text-sm">Shuttle ID: BUS-01</p>
                    </div>
                    <Bus className="w-10 h-10 text-white opacity-80" />
                </div>

                <div className="p-8 space-y-8">
                    {/* Status Indicator */}
                    <div className="flex flex-col items-center">
                        <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-4 transition-all duration-500 ${status === 'ONLINE' ? 'bg-green-100 text-green-600 ring-4 ring-green-50' :
                            status === 'OUT_OF_BOUNDS' ? 'bg-red-100 text-red-600 ring-4 ring-red-50' :
                                'bg-gray-100 text-gray-400'
                            }`}>
                            {status === 'ONLINE' ? <MapPin className="w-12 h-12 animate-bounce" /> :
                                status === 'OUT_OF_BOUNDS' ? <AlertTriangle className="w-12 h-12" /> :
                                    <Power className="w-12 h-12" />}
                        </div>
                        <h3 className={`text-xl font-bold tracking-wider ${status === 'ONLINE' ? 'text-green-600' :
                            status === 'OUT_OF_BOUNDS' ? 'text-red-500' :
                                'text-gray-500'
                            }`}>
                            {status === 'OUT_OF_BOUNDS' ? 'OUT OF ZONE' : status}
                        </h3>
                        {status === 'ONLINE' && <p className="text-gray-400 font-mono mt-1">{elapsed}</p>}
                    </div>

                    {/* Error Box */}
                    {errorMsg && (
                        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r">
                            <p className="text-sm text-red-700 font-semibold">{errorMsg}</p>
                        </div>
                    )}

                    {/* Main Action Button */}
                    <button
                        onClick={isSharing ? stopSharing : startSharing}
                        className={`w-full py-5 rounded-xl font-bold text-lg shadow-lg transform transition active:scale-95 ${isSharing
                            ? 'bg-white border-2 border-red-500 text-red-500 hover:bg-red-50'
                            : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-xl'
                            }`}
                    >
                        {isSharing ? 'STOP SHARING' : 'START SHARING LIVE LOCATION'}
                    </button>

                    {/* Debug Info */}
                    <div className="text-center">
                        <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Current Coordinates</p>
                        <p className="font-mono text-gray-600">
                            {location ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}` : '--.-----, --.-----'}
                        </p>
                        <p className="text-xs text-gray-400 mt-2">
                            Last Sent: {location ? new Date().toLocaleTimeString() : 'Waiting...'}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DriverDashboard;
