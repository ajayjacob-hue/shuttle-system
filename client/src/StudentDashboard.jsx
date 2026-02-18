import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext'; // Import Auth
import { calculateETA } from './utils/eta';
import L from 'leaflet';

import { Bus, Navigation, Crosshair, RefreshCw, LogOut } from 'lucide-react';

// Fix Leaflet's default icon issue
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

const VIT_VELLORE = [12.9692, 79.1559];

const createBusIcon = () => new L.DivIcon({
    className: 'custom-bus-icon',
    html: `
    <div style="
      background-color: #2563eb;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 3px solid white;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    ">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg>
    </div>
  `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18]
});

// Helper component to control map movement programmatically
const MapController = ({ centerOn, zoom, trigger }) => {
    const map = useMap();
    useEffect(() => {
        if (centerOn) {
            map.flyTo(centerOn, zoom, {
                animate: true,
                duration: 1.5 // Slower, smoother animation
            });
        }
    }, [centerOn, zoom, trigger, map]);
    return null;
};

const StudentDashboard = () => {
    const { user, login, logout } = useAuth();
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [otpSent, setOtpSent] = useState(false);
    const [authLoading, setAuthLoading] = useState(false);
    const [authError, setAuthError] = useState('');

    const socket = useSocket();
    const [drivers, setDrivers] = useState({}); // Keyed by DRIVER ID now (e.g. "Bus 1"), NOT socket.id
    const [selectedBus, setSelectedBus] = useState(null); // This is now a driverId string
    const [now, setNow] = useState(Date.now());
    const [mapCenterTarget, setMapCenterTarget] = useState(null);
    const [userLoc, setUserLoc] = useState(null);
    const [etas, setEtas] = useState({}); // Keyed by driverId
    const [routes, setRoutes] = useState([]);

    // Update 'now' every second to force UI refresh for "seconds ago" timer
    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (!socket || !user || user.role !== 'student') return; // Auth Guard
        socket.emit('join_role', 'student');

        const handleMove = (data) => {
            // data: { socketId, driverId, lat, lng ... }
            if (!data.driverId) return;

            setDrivers(prev => ({
                ...prev,
                [data.driverId]: {
                    ...data,
                    lastUpdated: Date.now()
                }
            }));
        };

        const handleOffline = (data) => {
            // data: { socketId }
            // We need to find which driverId had this socketId
            setDrivers(prev => {
                const updated = { ...prev };
                let removedId = null;

                // Find key where socketId matches
                Object.keys(updated).forEach(dId => {
                    if (updated[dId].socketId === data.socketId) {
                        delete updated[dId];
                        removedId = dId;
                    }
                });

                // If we removed the currently selected bus, deselect it
                if (removedId && selectedBus === removedId) {
                    setSelectedBus(null);
                }

                return updated;
            });
        };

        socket.on('initial_drivers', (driversMap) => {
            // driversMap is keyed by socketId from server
            // We need to transform it to be keyed by driverId
            const transformed = {};
            Object.values(driversMap).forEach(d => {
                if (d.driverId) {
                    transformed[d.driverId] = { ...d, lastUpdated: Date.now() };
                }
            });
            setDrivers(prev => ({ ...prev, ...transformed }));
        });

        socket.on('routes_update', (updatedRoutes) => {
            setRoutes(updatedRoutes);
        });

        socket.on('shuttle_moved', handleMove);
        socket.on('driver_offline', handleOffline);

        return () => {
            socket.off('shuttle_moved', handleMove);
            socket.off('driver_offline', handleOffline);
            socket.off('initial_drivers');
            socket.off('routes_update');
        };
    }, [socket, selectedBus, user]);

    // Calculate ETAs periodically or when locations change
    useEffect(() => {
        if (!userLoc) return;

        const updateEtas = async () => {
            const newEtas = {};
            const promises = Object.values(drivers).map(async (driver) => {
                if (driver.lat && driver.lng) {
                    try {
                        const time = await calculateETA(
                            { lat: driver.lat, lng: driver.lng },
                            userLoc
                        );
                        newEtas[driver.driverId] = time;
                    } catch (e) {
                        console.error("ETA Calc Error", e);
                    }
                }
            });

            await Promise.all(promises);
            setEtas(prev => ({ ...prev, ...newEtas }));
        };

        // Debounce slightly to avoid rapid updates
        const timer = setTimeout(updateEtas, 1000);
        return () => clearTimeout(timer);
    }, [drivers, userLoc]);

    // Get User Location on Mount
    useEffect(() => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    setUserLoc(loc);
                    // Initial center on user
                    setMapCenterTarget({ pos: [loc.lat, loc.lng], zoom: 17, trigger: Date.now() });
                },
                (err) => console.error("Location access denied", err),
                { enableHighAccuracy: true }
            );
        }
    }, []);

    const activeBuses = Object.values(drivers);

    const handleFocusShuttle = (driver) => {
        setSelectedBus(driver.driverId);
        setMapCenterTarget({
            pos: [driver.lat, driver.lng],
            zoom: 18,
            trigger: Date.now()
        });
    };

    const handleFocusUser = () => {
        if (userLoc) {
            setSelectedBus(null); // Deselect bus when focusing on self
            setMapCenterTarget({
                pos: [userLoc.lat, userLoc.lng],
                zoom: 17,
                trigger: Date.now()
            });
        } else {
            alert("Waiting for your location...");
        }
    };

    // --- AUTH LOGIC ---
    const handleSendOtp = async (e) => {
        e.preventDefault();
        setAuthLoading(true);
        setAuthError('');
        const VITE_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
        try {
            const res = await fetch(`${VITE_API_URL}/api/auth/student/login-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            setOtpSent(true);
        } catch (err) {
            setAuthError(err.message);
        } finally {
            setAuthLoading(false);
        }
    };

    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        setAuthLoading(true);
        setAuthError('');
        const VITE_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
        try {
            const res = await fetch(`${VITE_API_URL}/api/auth/student/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, otp })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            login(data.token, data.user);
        } catch (err) {
            setAuthError(err.message);
        } finally {
            setAuthLoading(false);
        }
    };

    // --- RENDER AUTH SCREEN ---
    if (!user || user.role !== 'student') {
        return (
            <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
                <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md">
                    <h2 className="text-2xl font-bold mb-6 text-center text-blue-900">Student Login</h2>
                    {authError && <div className="bg-red-100 text-red-700 p-3 rounded mb-4 text-sm">{authError}</div>}

                    {!otpSent ? (
                        <form onSubmit={handleSendOtp} className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-gray-700">Student Email</label>
                                <input
                                    type="email"
                                    required
                                    className="w-full border p-2 rounded"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    placeholder="yourname@vit.ac.in"
                                />
                            </div>
                            <button type="submit" disabled={authLoading} className="w-full bg-blue-600 text-white font-bold py-2 rounded hover:bg-blue-700">
                                {authLoading ? 'Sending OTP...' : 'Send OTP'}
                            </button>
                        </form>
                    ) : (
                        <form onSubmit={handleVerifyOtp} className="space-y-4">
                            <div className="text-center text-sm text-gray-500 mb-2">OTP sent to {email}</div>
                            <div>
                                <label className="block text-sm font-bold text-gray-700">Enter OTP</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full border p-2 rounded text-center letter-spacing-2 text-xl"
                                    value={otp}
                                    onChange={e => setOtp(e.target.value)}
                                    placeholder="123456"
                                />
                            </div>
                            <button type="submit" disabled={authLoading} className="w-full bg-green-600 text-white font-bold py-2 rounded hover:bg-green-700">
                                {authLoading ? 'Verifying...' : 'Verify & Login'}
                            </button>
                            <button type="button" onClick={() => setOtpSent(false)} className="w-full text-blue-500 text-sm hover:underline">
                                Change Email
                            </button>
                        </form>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col md:flex-row h-[100dvh] w-full bg-gray-100 overflow-hidden relative">

            {/* 1. MAP CONTAINER */}
            <div className="flex-1 relative order-1 md:order-2 h-full w-full z-0">
                <MapContainer center={VIT_VELLORE} zoom={17} style={{ height: "100%", width: "100%", zIndex: 0 }} zoomControl={false} attributionControl={false}>
                    <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    />

                    {/* Controls Overlay */}
                    <div className="absolute bottom-6 right-4 z-[400] flex flex-col gap-2">
                        {/* Recenter on User */}
                        <button
                            onClick={handleFocusUser}
                            className="bg-white p-3 rounded-full shadow-lg text-gray-700 hover:text-blue-600 hover:bg-gray-50 transition-colors"
                            title="Center on Me"
                        >
                            <Crosshair size={24} />
                        </button>
                    </div>

                    {/* Programmatic Map Controller */}
                    {mapCenterTarget && (
                        <MapController centerOn={mapCenterTarget.pos} zoom={mapCenterTarget.zoom} trigger={mapCenterTarget.trigger} />
                    )}

                    {/* User Location Marker */}
                    {userLoc && (
                        <Marker position={[userLoc.lat, userLoc.lng]} icon={L.divIcon({
                            className: 'user-location-marker',
                            html: `<div style="background-color: #2563eb; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.3);"></div>`,
                            iconSize: [20, 20],
                            iconAnchor: [10, 10]
                        })}>
                            <Popup>You are here</Popup>
                        </Marker>
                    )}

                    {/* Routes */}
                    {routes.map(r => (
                        <Polyline
                            key={r.id}
                            positions={r.waypoints}
                            pathOptions={{ color: r.color, opacity: 0.6, weight: 5 }}
                        />
                    ))}

                    {activeBuses.map((driver) => (
                        <Marker
                            key={driver.driverId}
                            position={[driver.lat, driver.lng]}
                            icon={createBusIcon()}
                            eventHandlers={{
                                click: () => handleFocusShuttle(driver),
                            }}
                        >
                            <Popup direction="top" offset={[0, -20]} opacity={1}>
                                <div className="font-sans text-center">
                                    <strong className="text-blue-900 block mb-1">Shuttle {driver.driverId.slice(-3)}</strong>
                                    <button
                                        onClick={() => handleFocusShuttle(driver)}
                                        className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded mt-1 hover:bg-blue-200"
                                    >
                                        Focus
                                    </button>
                                </div>
                            </Popup>
                        </Marker>
                    ))}
                </MapContainer>
            </div>

            {/* 2. INFO PANEL / SIDEBAR */}
            <div
                className={`
                    bg-white shadow-2xl z-20 flex flex-col transition-all duration-300
                    w-full h-[45vh] rounded-t-3xl order-2 
                    md:w-96 md:h-full md:rounded-none md:order-1 md:static
                `}
            >
                {/* Header */}
                <div className="p-5 border-b bg-white md:bg-blue-900 md:text-white rounded-t-3xl md:rounded-none flex justify-between items-center sticky top-0 z-10">
                    <div>
                        <h1 className="font-bold text-lg flex items-center gap-2 text-gray-800 md:text-white">
                            <Bus size={20} className="text-blue-600 md:text-white" /> VIT Shuttle
                        </h1>
                        <p className="text-xs text-gray-500 md:text-blue-200 mt-1">Live Tracking System v2.3</p>
                        <p className={`text-[10px] uppercase font-bold mt-1 ${socket?.connected ? 'text-green-600 md:text-green-300' : 'text-red-500 animate-pulse'}`}>
                            {socket?.connected ? '● Server Connected' : '○ Connecting...'}
                        </p>
                    </div>

                    <button onClick={logout} className="p-2 ml-2 bg-gray-100 text-gray-700 md:bg-blue-800 md:text-white rounded hover:bg-gray-200 md:hover:bg-blue-700">
                        <LogOut size={16} />
                    </button>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50 md:bg-white">
                    {activeBuses.length === 0 ? (
                        <div className="text-center py-10 text-gray-400">
                            <Bus className="mx-auto mb-2 opacity-50" size={32} />
                            <p>No shuttles active</p>
                            <p className="text-xs mt-2">Waiting for drivers...</p>
                        </div>
                    ) : (
                        activeBuses.map(bus => (
                            <button
                                key={bus.driverId}
                                onClick={() => handleFocusShuttle(bus)}
                                className={`w-full text-left p-4 rounded-xl border transition-all shadow-sm ${selectedBus === bus.driverId
                                    ? 'bg-blue-600 text-white border-blue-600 ring-4 ring-blue-100'
                                    : 'bg-white hover:bg-gray-50 border-gray-100 text-gray-700'
                                    }`}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-3 h-3 rounded-full ${selectedBus === bus.driverId ? 'bg-white' : 'bg-green-500'}`}></div>
                                        <div>
                                            <span className="font-bold text-lg block leading-none">Shuttle {bus.driverId.slice(-3)}</span>
                                            {etas[bus.driverId] && (
                                                <span className={`text-xs font-bold ${selectedBus === bus.driverId ? 'text-blue-100' : 'text-blue-600'}`}>
                                                    ETA: {etas[bus.driverId]}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <Navigation size={16} className={selectedBus === bus.driverId ? 'text-white' : 'text-gray-400'} />
                                </div>
                                <div className={`mt-2 text-xs flex justify-between ${selectedBus === bus.driverId ? 'text-blue-100' : 'text-gray-500'}`}>
                                    <span>
                                        Last Update: {(() => {
                                            const diff = Math.floor((now - (bus.lastUpdated || Date.now())) / 1000);
                                            if (diff < 5) return 'just now';
                                            if (diff < 60) return `${diff}s ago`;
                                            return `${Math.floor(diff / 60)}m ago`;
                                        })()}
                                    </span>
                                    <span>Click to focus</span>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};
export default StudentDashboard;
