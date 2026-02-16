import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useSocket } from './SocketContext';
import L from 'leaflet';

import { Bus, Navigation, Crosshair, RefreshCw } from 'lucide-react';

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
    const socket = useSocket();
    const [drivers, setDrivers] = useState({}); // Keyed by DRIVER ID now (e.g. "Bus 1"), NOT socket.id
    const [selectedBus, setSelectedBus] = useState(null); // This is now a driverId string
    const [now, setNow] = useState(Date.now());
    const [mapCenterTarget, setMapCenterTarget] = useState(null);
    const [userLoc, setUserLoc] = useState(null);

    // Update 'now' every second to force UI refresh for "seconds ago" timer
    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (!socket) return;
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

        socket.on('shuttle_moved', handleMove);
        socket.on('driver_offline', handleOffline);

        return () => {
            socket.off('shuttle_moved', handleMove);
            socket.off('driver_offline', handleOffline);
            socket.off('initial_drivers');
        };
    }, [socket, selectedBus]);

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
                                    <strong className="text-blue-900 block mb-1">Shuttle {driver.driverId}</strong>
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
                        <p className="text-xs text-gray-500 md:text-blue-200 mt-1">Live Tracking System v2.0</p>
                        <p className={`text-[10px] uppercase font-bold mt-1 ${socket?.connected ? 'text-green-600 md:text-green-300' : 'text-red-500 animate-pulse'}`}>
                            {socket?.connected ? '● Server Connected' : '○ Connecting...'}
                        </p>
                    </div>
                    <div className="text-[10px] bg-green-100 text-green-700 md:bg-blue-800 md:text-blue-100 px-2 py-1 rounded-full">
                        {activeBuses.length} Active
                    </div>
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
                                        <span className="font-bold text-lg">Shuttle {bus.driverId.slice(-3)}</span>
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
