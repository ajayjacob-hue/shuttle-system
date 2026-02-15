import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useSocket } from './SocketContext';
import { Bus, Navigation } from 'lucide-react';

const VIT_VELLORE = [12.9692, 79.1559];

// Custom Bus Icon
const createBusIcon = () => L.divIcon({
    className: 'custom-bus-icon',
    html: `
        <div class="bus-marker-container">
            <div class="bus-marker-ring"></div>
            <div class="bus-marker-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.3-.1-.6-.2-.9l-2-7A2.7 2.7 0 0 0 17 4H7a2.7 2.7 0 0 0-2.8 2.1l-2 7C2 13.6 2 14 2 14.5c0 .4.1.8.2 1.2l.8 2.8H18Z"/><path d="M6 22v-2"/><path d="M18 22v-2"/></svg>
            </div>
        </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20]
});

// Component to recenter map
const MapRecenter = ({ center }) => {
    const map = useMap();
    useEffect(() => {
        if (center) map.flyTo(center, 16);
    }, [center, map]);
    return null;
};

const StudentDashboard = () => {
    const socket = useSocket();
    const [drivers, setDrivers] = useState({});
    const [selectedBus, setSelectedBus] = useState(null);

    useEffect(() => {
        if (!socket) return;
        socket.emit('join_role', 'student');

        const handleMove = (data) => {
            setDrivers(prev => ({ ...prev, [data.socketId]: data }));
        };

        const handleOffline = (data) => {
            setDrivers(prev => {
                const updated = { ...prev };
                delete updated[data.socketId];
                return updated;
            });
            if (selectedBus === data.socketId) setSelectedBus(null);
        };

        socket.on('initial_drivers', (list) => {
            const map = {};
            list.forEach(d => map[d.socketId] = d);
            setDrivers(map);
        });

        socket.on('shuttle_moved', handleMove);
        socket.on('driver_offline', handleOffline);

        return () => {
            socket.off('shuttle_moved', handleMove);
            socket.off('driver_offline', handleOffline);
            socket.off('initial_drivers');
        };
    }, [socket, selectedBus]);

    // User Location State
    const [userLoc, setUserLoc] = useState(null);

    // Get User Location on Mount
    useEffect(() => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                },
                (err) => console.error("Location access denied", err),
                { enableHighAccuracy: true }
            );
        }
    }, []);

    const activeBuses = Object.values(drivers);

    return (
        <div className="flex flex-col md:flex-row h-[100dvh] w-full bg-gray-100 overflow-hidden relative">

            {/* 1. MAP CONTAINER (Order 1 on Mobile, Order 2 on Desktop) */}
            <div className="flex-1 relative order-1 md:order-2 h-full w-full z-0">
                <MapContainer center={VIT_VELLORE} zoom={17} style={{ height: "100%", width: "100%", zIndex: 0 }} zoomControl={false} attributionControl={false}>
                    {/* Detailed OSM Tiles */}
                    <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    />

                    {/* User Location Marker */}
                    {userLoc && (
                        <>
                            <Marker position={[userLoc.lat, userLoc.lng]} icon={L.divIcon({
                                className: 'user-location-marker',
                                html: `<div style="background-color: #2563eb; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.3);"></div>`,
                                iconSize: [20, 20],
                                iconAnchor: [10, 10]
                            })}>
                                <Popup>You are here</Popup>
                            </Marker>
                            {/* Auto-center on user only initially or if tracking is enabled (here just once via generic Recenter if needed, but better handling separately) */}
                            {!selectedBus && <MapRecenter center={[userLoc.lat, userLoc.lng]} zoom={16} />}
                        </>
                    )}

                    {activeBuses.map((driver) => (
                        <Marker
                            key={driver.socketId}
                            position={[driver.lat, driver.lng]}
                            icon={createBusIcon()}
                            eventHandlers={{
                                click: () => {
                                    setSelectedBus(driver.socketId);
                                },
                            }}
                        >
                            <Popup direction="top" offset={[0, -20]} opacity={1}>
                                <div className="font-sans text-center">
                                    <strong className="text-blue-900 block mb-1">Shuttle {driver.driverId}</strong>
                                    <span className="text-xs text-gray-500">Live Location</span>
                                </div>
                            </Popup>
                        </Marker>
                    ))}

                    {/* Fly to selected bus - Overrides user location center if a bus is selected */}
                    {selectedBus && drivers[selectedBus] && (
                        <MapRecenter center={[drivers[selectedBus].lat, drivers[selectedBus].lng]} zoom={18} />
                    )}
                </MapContainer>
            </div>

            {/* 2. INFO PANEL / SIDEBAR (Order 2 on Mobile, Order 1 on Desktop) */}
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
                        <p className="text-xs text-gray-500 md:text-blue-200 mt-1">Live Tracking System</p>
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
                                key={bus.socketId}
                                onClick={() => setSelectedBus(bus.socketId)}
                                className={`w-full text-left p-4 rounded-xl border transition-all shadow-sm ${selectedBus === bus.socketId
                                    ? 'bg-blue-600 text-white border-blue-600 ring-4 ring-blue-100'
                                    : 'bg-white hover:bg-gray-50 border-gray-100 text-gray-700'
                                    }`}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-3 h-3 rounded-full ${selectedBus === bus.socketId ? 'bg-white' : 'bg-green-500'}`}></div>
                                        <span className="font-bold text-lg">Shuttle {bus.driverId.slice(-3)}</span>
                                    </div>
                                    <Navigation size={16} className={selectedBus === bus.socketId ? 'text-white' : 'text-gray-400'} />
                                </div>
                                <div className={`mt-2 text-xs flex justify-between ${selectedBus === bus.socketId ? 'text-blue-100' : 'text-gray-500'}`}>
                                    <span>Last Update: just now</span>
                                    <span>~ 2 mins away</span>
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
