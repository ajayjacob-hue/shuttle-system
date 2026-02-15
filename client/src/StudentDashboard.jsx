import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useSocket } from './SocketContext';
import { Bus, Navigation, Map as MapIcon, Users } from 'lucide-react';

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
    const [sidebarOpen, setSidebarOpen] = useState(true);

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

    const activeBuses = Object.values(drivers);

    return (
        <div className="flex h-screen w-full bg-gray-100 overflow-hidden">
            {/* Sidebar */}
            <div className={`transition-all duration-300 ease-in-out ${sidebarOpen ? 'w-80' : 'w-0'} bg-white shadow-xl z-20 flex flex-col relative`}>
                <div className="p-5 border-b bg-blue-900 text-white flex justify-between items-center">
                    <div>
                        <h1 className="font-bold text-lg flex items-center gap-2">
                            <Bus size={20} /> VIT Shuttle
                        </h1>
                        <p className="text-xs text-blue-200 mt-1">Live Tracking System</p>
                        <p className="text-[10px] text-blue-300 mt-1">
                            Server Connected. Drivers: {activeBuses.length}
                        </p>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Active Shuttles ({activeBuses.length})
                    </h3>

                    {activeBuses.length === 0 ? (
                        <div className="text-center py-10 text-gray-400">
                            <Bus className="mx-auto mb-2 opacity-50" size={32} />
                            <p>No shuttles active</p>
                        </div>
                    ) : (
                        activeBuses.map(bus => (
                            <button
                                key={bus.socketId}
                                onClick={() => setSelectedBus(bus.socketId)}
                                className={`w-full text-left p-3 rounded-lg border transition-all ${selectedBus === bus.socketId
                                    ? 'bg-blue-50 border-blue-500 shadow-sm'
                                    : 'hover:bg-gray-50 border-gray-100'
                                    }`}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-2 h-2 rounded-full ${selectedBus === bus.socketId ? 'bg-blue-500' : 'bg-green-500'}`}></div>
                                        <span className="font-semibold text-gray-700">Shuttle {bus.driverId.slice(-3)}</span>
                                    </div>
                                    <Navigation size={14} className="text-gray-400" />
                                </div>
                                <div className="mt-2 text-xs text-gray-500 flex justify-between">
                                    <span>Last Update: just now</span>
                                    <span>~ 2 mins away</span>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 relative">
                {/* Mobile Toggle */}
                <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className="absolute top-4 left-4 z-[1000] bg-white p-2 rounded-md shadow-md hover:bg-gray-50"
                >
                    <MapIcon size={20} className="text-gray-700" />
                </button>

                <MapContainer center={VIT_VELLORE} zoom={15} style={{ height: "100%", width: "100%" }} zoomControl={false}>
                    <TileLayer
                        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    />

                    {activeBuses.map((driver) => (
                        <Marker
                            key={driver.socketId}
                            position={[driver.lat, driver.lng]}
                            icon={createBusIcon()}
                        >
                            <Popup direction="top" offset={[0, -20]} opacity={1}>
                                <div className="font-sans text-center">
                                    <strong className="text-blue-900 block mb-1">Shuttle {driver.driverId}</strong>
                                    <span className="text-xs text-gray-500">Live Location</span>
                                </div>
                            </Popup>
                        </Marker>
                    ))}

                    {/* Fly to selected bus */}
                    {selectedBus && drivers[selectedBus] && (
                        <MapRecenter center={[drivers[selectedBus].lat, drivers[selectedBus].lng]} />
                    )}
                </MapContainer>
            </div>
        </div>
    );
};

export default StudentDashboard;
