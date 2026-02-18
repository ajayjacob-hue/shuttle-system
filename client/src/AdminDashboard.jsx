import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useSocket } from './SocketContext';
import L from 'leaflet';
import { Bus, Trash2, Save, StopCircle, Plus, Edit3 } from 'lucide-react';

// Reusing icon logic (could be refactored to shared utility)
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
    <div style="background-color: #2563eb; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg>
    </div>
  `,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
});

// Component to handle map clicks for drawing routes
const RouteDrawer = ({ isEditing, onAddPoint }) => {
    useMapEvents({
        click(e) {
            if (isEditing) {
                onAddPoint([e.latlng.lat, e.latlng.lng]);
            }
        },
    });
    return null;
};

const AdminDashboard = () => {
    const socket = useSocket();
    const [drivers, setDrivers] = useState({});
    const [routes, setRoutes] = useState([]);

    // Editor State
    const [isEditing, setIsEditing] = useState(false);
    const [currentRoutePoints, setCurrentRoutePoints] = useState([]);
    const [routeName, setRouteName] = useState('');
    const [routeColor, setRouteColor] = useState('#ff0000');
    const [snapToRoads, setSnapToRoads] = useState(true);

    useEffect(() => {
        if (!socket) return;

        // ensure we join admin room
        socket.emit('join_role', 'admin');

        // Initial Data Handlers
        socket.on('initial_drivers', (driversMap) => {
            const transformed = {};
            Object.values(driversMap).forEach(d => {
                if (d.driverId) transformed[d.driverId] = d;
            });
            setDrivers(prev => ({ ...prev, ...transformed }));
        });

        socket.on('routes_update', (updatedRoutes) => {
            setRoutes(updatedRoutes);
        });

        socket.on('shuttle_moved', (data) => {
            setDrivers(prev => ({
                ...prev,
                [data.driverId]: { ...data, lastUpdated: Date.now() }
            }));
        });

        socket.on('driver_offline', (data) => {
            setDrivers(prev => {
                const updated = { ...prev };
                Object.keys(updated).forEach(dId => {
                    if (updated[dId].socketId === data.socketId) delete updated[dId];
                });
                return updated;
            });
        });

        return () => {
            socket.off('initial_drivers');
            socket.off('routes_update');
            socket.off('shuttle_moved');
            socket.off('driver_offline');
        };
    }, [socket]);


    // Action Handlers
    const fetchRouteSegment = async (start, end) => {
        try {
            // OSRM requires lon,lat
            const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.code === 'Ok' && data.routes && data.routes[0]) {
                // OSRM returns [lon, lat], Leaflet needs [lat, lon]
                return data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
            }
        } catch (err) {
            console.error("OSRM Fetch Error", err);
        }
        return null; // Fallback or failure
    };

    const handleAddPoint = async (point) => {
        // If we have a previous point, try to route to the new one
        if (currentRoutePoints.length > 0 && snapToRoads) {
            const lastPoint = currentRoutePoints[currentRoutePoints.length - 1];
            const segment = await fetchRouteSegment(lastPoint, point);

            if (segment) {
                // Add the segment points (excluding the first one since it overlaps with lastPoint)
                // actually OSRM includes start/end, so we might want to slice(1)
                const newPoints = segment.slice(1);
                setCurrentRoutePoints(prev => [...prev, ...newPoints]);
            } else {
                // Fallback: Straight line
                setCurrentRoutePoints(prev => [...prev, point]);
            }
        } else {
            // First point or snap disabled
            setCurrentRoutePoints(prev => [...prev, point]);
        }
    };

    const handleSaveRoute = () => {
        if (!routeName || currentRoutePoints.length < 2) {
            alert("Route needs a name and at least 2 points");
            return;
        }
        const newRoute = {
            id: Date.now().toString(),
            name: routeName,
            color: routeColor,
            waypoints: currentRoutePoints
        };
        socket.emit('save_route', newRoute);
        // Reset
        setIsEditing(false);
        setCurrentRoutePoints([]);
        setRouteName('');
    };

    const handleDeleteRoute = (id) => {
        if (confirm("Delete this route?")) {
            socket.emit('delete_route', id);
        }
    };

    const handleForceStop = (socketId) => {
        if (confirm("Force stop this driver?")) {
            socket.emit('admin_force_stop', socketId);
        }
    };

    return (
        <div className="flex flex-col md:flex-row h-screen w-full bg-gray-100">
            {/* Sidebar Controls */}
            <div className="w-full md:w-80 bg-white shadow-xl z-10 flex flex-col h-[40vh] md:h-full overflow-hidden">
                <div className="p-4 bg-gray-800 text-white shadow-md">
                    <h1 className="text-xl font-bold flex items-center gap-2">
                        <Edit3 size={20} /> Admin Panel
                    </h1>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    {/* Active Shuttles */}
                    <div>
                        <h2 className="text-sm font-bold text-gray-500 uppercase mb-2">Active Shuttles ({Object.keys(drivers).length})</h2>
                        {Object.keys(drivers).length === 0 ? <p className="text-sm text-gray-400 italic">No active drivers</p> : (
                            <div className="space-y-2">
                                {Object.values(drivers).map(d => (
                                    <div key={d.driverId} className="flex items-center justify-between p-3 bg-gray-50 rounded border border-gray-200">
                                        <div>
                                            <p className="font-bold text-sm">{d.driverId}</p>
                                            <p className="text-xs text-green-600">Online</p>
                                        </div>
                                        <button
                                            onClick={() => handleForceStop(d.socketId)}
                                            className="text-red-500 hover:bg-red-50 p-2 rounded-full"
                                            title="Force Stop"
                                        >
                                            <StopCircle size={18} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Routes Management */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <h2 className="text-sm font-bold text-gray-500 uppercase">Routes</h2>
                            {!isEditing && (
                                <button
                                    onClick={() => setIsEditing(true)}
                                    className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded flex items-center gap-1 hover:bg-blue-200"
                                >
                                    <Plus size={12} /> New
                                </button>
                            )}
                        </div>

                        {isEditing ? (
                            <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 space-y-3">
                                <p className="text-xs text-blue-800 font-bold">Creating New Route</p>
                                <input
                                    type="text"
                                    placeholder="Route Name (e.g. Main Loop)"
                                    className="w-full p-2 text-sm border rounded"
                                    value={routeName}
                                    onChange={e => setRouteName(e.target.value)}
                                />
                                <div className="flexItems-center gap-2">
                                    <label className="text-xs">Color:</label>
                                    <input
                                        type="color"
                                        value={routeColor}
                                        onChange={e => setRouteColor(e.target.value)}
                                        className="h-8 w-16 p-0 border-0"
                                    />
                                </div>
                                <div className="flex items-center gap-2 bg-white/50 p-2 rounded">
                                    <input
                                        type="checkbox"
                                        id="snapToRoads"
                                        checked={snapToRoads}
                                        onChange={e => setSnapToRoads(e.target.checked)}
                                        className="rounded text-blue-600 focus:ring-blue-500"
                                    />
                                    <label htmlFor="snapToRoads" className="text-xs text-gray-700 cursor-pointer select-none">
                                        Snap to Roads (OSRM)
                                    </label>
                                </div>
                                <p className="text-xs text-blue-600 italic">Click map to add points ({currentRoutePoints.length})</p>
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleSaveRoute}
                                        className="flex-1 bg-blue-600 text-white py-1 rounded text-sm hover:bg-blue-700"
                                    >
                                        Save
                                    </button>
                                    <button
                                        onClick={() => { setIsEditing(false); setCurrentRoutePoints([]); }}
                                        className="flex-1 bg-gray-300 text-gray-700 py-1 rounded text-sm hover:bg-gray-400"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {routes.map(r => (
                                    <div key={r.id} className="flex items-center justify-between p-2 bg-white rounded border border-gray-100 shadow-sm">
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: r.color }}></div>
                                            <span className="text-sm font-medium">{r.name}</span>
                                        </div>
                                        <button
                                            onClick={() => handleDeleteRoute(r.id)}
                                            className="text-gray-400 hover:text-red-500"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Map Area */}
            <div className="flex-1 relative h-[60vh] md:h-full">
                <MapContainer center={VIT_VELLORE} zoom={16} style={{ height: "100%", width: "100%" }}>
                    <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution='&copy; OpenStreetMap contributors'
                    />

                    <RouteDrawer isEditing={isEditing} onAddPoint={handleAddPoint} />

                    {/* Render Saved Routes */}
                    {routes.map(r => (
                        <Polyline
                            key={r.id}
                            positions={r.waypoints}
                            pathOptions={{ color: r.color, opacity: 0.7, weight: 6 }}
                        />
                    ))}

                    {/* Render Route Being Drawn */}
                    {isEditing && currentRoutePoints.length > 0 && (
                        <Polyline
                            positions={currentRoutePoints}
                            pathOptions={{ color: routeColor, weight: 4, dashArray: '10, 10' }}
                        />
                    )}
                    {isEditing && currentRoutePoints.map((pt, idx) => (
                        <Marker key={idx} position={pt} icon={L.divIcon({
                            className: 'route-point-marker',
                            html: `<div style="background-color: ${routeColor}; width: 10px; height: 10px; border-radius: 50%; border: 2px solid white;"></div>`,
                            iconSize: [12, 12]
                        })} />
                    ))}

                    {/* Active Shuttles */}
                    {Object.values(drivers).map(d => (
                        <Marker key={d.driverId} position={[d.lat, d.lng]} icon={createBusIcon()}>
                            <Popup>{d.driverId}</Popup>
                        </Marker>
                    ))}
                </MapContainer>

                {isEditing && (
                    <div className="absolute top-4 right-4 bg-white/90 p-4 rounded shadow-lg z-[400] max-w-sm pointer-events-none">
                        <h3 className="font-bold text-blue-900 flex items-center gap-2">
                            <Edit3 size={16} /> Edit Mode Active
                        </h3>
                        <p className="text-xs text-gray-600 mt-1">
                            Click on the map to place waypoints for the route. <br />
                            Use the sidebar to Save when finished.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AdminDashboard;
