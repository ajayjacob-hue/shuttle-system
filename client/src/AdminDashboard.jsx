import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext'; // Auth
import L from 'leaflet';
import { Bus, Trash2, Save, StopCircle, Plus, Edit3, CheckCircle, XCircle, LogOut, UserCheck, ShieldCheck } from 'lucide-react';

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
    const { user, login, logout } = useAuth();
    const [loginEmail, setLoginEmail] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [loginError, setLoginError] = useState('');

    const socket = useSocket();
    const [drivers, setDrivers] = useState({}); // Active (online) drivers
    const [routes, setRoutes] = useState([]);

    // Approval/Management State
    const [pendingDrivers, setPendingDrivers] = useState([]);
    const [approvedDrivers, setApprovedDrivers] = useState([]);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    // Editor State
    const [isEditing, setIsEditing] = useState(false);
    const [currentRoutePoints, setCurrentRoutePoints] = useState([]);
    const [routeName, setRouteName] = useState('');
    const [routeColor, setRouteColor] = useState('#ff0000');
    const [snapToRoads, setSnapToRoads] = useState(true);

    const VITE_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

    // Fetch Drivers
    useEffect(() => {
        if (user && user.role === 'admin') {
            // Fetch Pending
            fetch(`${VITE_API_URL}/api/auth/admin/pending-drivers`)
                .then(res => res.json())
                .then(data => setPendingDrivers(data))
                .catch(err => console.error("Failed to fetch pending drivers", err));

            // Fetch Approved (All Database Approved)
            fetch(`${VITE_API_URL}/api/auth/admin/approved-drivers`)
                .then(res => res.json())
                .then(data => setApprovedDrivers(data))
                .catch(err => console.error("Failed to fetch approved drivers", err));
        }
    }, [user, refreshTrigger]);

    useEffect(() => {
        if (!socket || !user || user.role !== 'admin') return;

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

        // Also listen for new signups/approvals to refresh list? 
        // Ideally we'd have a socket event for "new_driver_signup" or we poll. 
        // For now, manual refresh or poll.

        return () => {
            socket.off('initial_drivers');
            socket.off('routes_update');
            socket.off('shuttle_moved');
            socket.off('driver_offline');
        };
    }, [socket, user]);


    // Action Handlers
    const handleLogin = (e) => {
        e.preventDefault();
        // Hardcoded admin for now as per requirements, or use real auth if we had an endpoint
        // To keep it simple and consistent with "simulated" admin in previous steps:
        if (loginEmail === 'admin' && loginPassword === 'admin123') {
            login('admin-token', { role: 'admin', email: 'admin' });
        } else {
            setLoginError('Invalid credentials');
        }
    };

    const handleApprove = async (driverId) => {
        try {
            const res = await fetch(`${VITE_API_URL}/api/auth/admin/approve-driver`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ driverId })
            });
            if (res.ok) {
                setRefreshTrigger(prev => prev + 1);
            } else {
                const err = await res.json();
                alert("Failed to approve: " + (err.message || "Unknown error"));
            }
        } catch (e) {
            console.error("Approve error:", e);
        }
    };

    const handleReject = async (driverId) => {
        if (!confirm("Are you sure you want to reject and delete this sign-up request?")) return;
        try {
            const res = await fetch(`${VITE_API_URL}/api/auth/admin/reject-driver`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ driverId })
            });
            if (res.ok) {
                setRefreshTrigger(prev => prev + 1);
            } else {
                const err = await res.json();
                alert("Failed to reject: " + (err.message || "Unknown error"));
            }
        } catch (e) {
            console.error("Reject error:", e);
        }
    };

    const handleDeleteAccount = async (driverId) => {
        const adminPassword = window.prompt("To delete this driver account, please enter the admin confirmation password:");
        if (adminPassword === null) return; // Cancelled

        try {
            const res = await fetch(`${VITE_API_URL}/api/auth/admin/delete-driver`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ driverId, adminPassword })
            });
            if (res.ok) {
                alert("Account deleted successfully.");
                setRefreshTrigger(prev => prev + 1);
            } else {
                const err = await res.json();
                alert("Failed to delete: " + (err.message || "Invalid password"));
            }
        } catch (e) {
            console.error("Delete error:", e);
        }
    };

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

    // --- ADMIN LOGIN SCREEN ---
    if (!user || user.role !== 'admin') {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black flex flex-col items-center justify-center p-4">
                <div className="mb-8 text-center">
                    <div className="bg-gray-800/80 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-gray-700 shadow-[0_0_30px_rgba(59,130,246,0.15)] relative overflow-hidden backdrop-blur-md">
                        <div className="absolute inset-0 bg-blue-500/10" />
                        <ShieldCheck size={36} className="text-blue-400 relative z-10" />
                    </div>
                    <h1 className="text-3xl font-extrabold text-white tracking-widest">SYSTEM ADMIN</h1>
                    <p className="text-blue-400/80 text-xs mt-2 tracking-[0.2em] uppercase font-bold">Restricted Access</p>
                </div>
                
                <div className="bg-gray-800/40 backdrop-blur-xl p-8 rounded-3xl shadow-2xl w-full max-w-sm border border-gray-700/50">
                    {loginError && (
                        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-xl mb-6 text-sm text-center font-medium flex items-center justify-center gap-2">
                            <XCircle size={16} /> {loginError}
                        </div>
                    )}
                    <form onSubmit={handleLogin} className="space-y-5">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-1">Admin ID</label>
                            <input
                                type="text"
                                className="w-full bg-gray-900/60 border border-gray-700 text-white px-4 py-3.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all placeholder-gray-600 block shadow-inner"
                                placeholder="..."
                                value={loginEmail}
                                onChange={e => setLoginEmail(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-1">Passcode</label>
                            <input
                                type="password"
                                className="w-full bg-gray-900/60 border border-gray-700 text-white px-4 py-3.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all placeholder-gray-600 block shadow-inner"
                                placeholder="..."
                                value={loginPassword}
                                onChange={e => setLoginPassword(e.target.value)}
                            />
                        </div>
                        <div className="pt-4">
                            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl transition-all shadow-[0_0_15px_rgba(37,99,235,0.3)] hover:shadow-[0_0_25px_rgba(37,99,235,0.5)] active:scale-[0.98] tracking-widest uppercase text-sm">
                                Authenticate
                            </button>
                        </div>
                    </form>
                </div>

                <div className="mt-12">
                     <button onClick={() => window.location.href = '/'} className="text-xs font-semibold text-gray-500 hover:text-white transition-colors flex items-center gap-2 uppercase tracking-wider">
                       ← Return to Public Portal
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col md:flex-row h-screen w-full bg-gray-100 dark:bg-gray-950 transition-colors duration-500">
            {/* Sidebar Controls */}
            <div className="w-full md:w-80 bg-white dark:bg-gray-900 shadow-xl z-20 flex flex-col h-[40vh] md:h-full overflow-hidden border-r border-gray-100 dark:border-white/5">
                <div className="p-5 bg-gray-800 dark:bg-indigo-950 text-white shadow-md flex justify-between items-center">
                    <h1 className="text-xl font-black flex items-center gap-2 tracking-tight">
                        <Edit3 size={20} className="text-blue-400" /> CONTROL
                    </h1>
                    <button onClick={logout} className="text-gray-400 hover:text-white transition-colors"><LogOut size={18} /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-6">

                    {/* Pending Approvals */}
                    <div className="bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/20 rounded-2xl p-4">
                        <h2 className="text-xs font-black text-yellow-800 dark:text-yellow-500 uppercase mb-3 flex items-center gap-2 tracking-widest">
                            <UserCheck size={14} /> PENDING ({pendingDrivers.length})
                        </h2>
                        {pendingDrivers.length === 0 ? <p className="text-[10px] text-gray-500 italic font-medium">Clear for now</p> : (
                            <div className="space-y-3 mt-2">
                                {pendingDrivers.map(d => (
                                    <div key={d._id} className="bg-white dark:bg-gray-800 p-3 rounded-xl border border-yellow-100 dark:border-white/5 flex flex-col gap-2 shadow-sm">
                                        <span className="text-[10px] font-black text-gray-700 dark:text-gray-300 truncate" title={d.email}>{d.email}</span>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleApprove(d._id)}
                                                className="flex-1 bg-green-600 text-white text-[10px] py-1 rounded hover:bg-green-700 flex items-center justify-center gap-1"
                                            >
                                                <CheckCircle size={10} /> Approve
                                            </button>
                                            <button
                                                onClick={() => handleReject(d._id)}
                                                className="flex-1 bg-red-500 text-white text-[10px] py-1 rounded hover:bg-red-600 flex items-center justify-center gap-1"
                                            >
                                                <XCircle size={10} /> Reject
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Approved Drivers Management */}
                    <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-2xl p-4">
                        <h2 className="text-xs font-black text-blue-800 dark:text-blue-400 uppercase mb-3 flex items-center gap-2 tracking-widest">
                            <Bus size={14} /> FLEET ({approvedDrivers.length})
                        </h2>
                        {approvedDrivers.length === 0 ? <p className="text-[10px] text-gray-500 italic font-medium">No units registered</p> : (
                            <div className="space-y-3 mt-2">
                                {approvedDrivers.map(d => {
                                    // Check if online
                                    const onlineSocketId = Object.keys(drivers).find(sId => drivers[sId].driverId === d.email);

                                    return (
                                        <div key={d._id} className="bg-white dark:bg-gray-800 p-3 rounded-xl border border-blue-100 dark:border-white/5 shadow-sm space-y-3">
                                            <div className="flex justify-between items-center">
                                                <span className="text-[10px] font-black text-gray-700 dark:text-gray-300 truncate w-3/4" title={d.email}>{d.email}</span>
                                                <span className={`text-[8px] font-black uppercase rounded-full px-2 py-0.5 ${onlineSocketId ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-500' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-500'}`}>
                                                    {onlineSocketId ? 'Online' : 'Offline'}
                                                </span>
                                            </div>
                                            <div className="flex gap-2">
                                                {onlineSocketId && (
                                                    <button
                                                        onClick={() => handleForceStop(onlineSocketId)}
                                                        className="flex-1 bg-orange-100 dark:bg-orange-500/10 text-orange-700 dark:text-orange-500 text-[9px] font-bold py-2 rounded-lg hover:bg-orange-200 dark:hover:bg-orange-500/20 flex items-center justify-center gap-1 transition-colors"
                                                        title="Force Stop Location Sharing"
                                                    >
                                                        <StopCircle size={10} /> STOP
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleDeleteAccount(d._id)}
                                                    className="flex-1 bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-500 text-[9px] font-bold py-2 rounded-lg hover:bg-red-200 dark:hover:bg-red-500/20 flex items-center justify-center gap-1 transition-colors"
                                                    title="Delete Driver Account"
                                                >
                                                    <Trash2 size={10} /> DELETE
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Active Shuttles */}
                    <div className="bg-gray-50 dark:bg-gray-800/30 border border-gray-100 dark:border-white/5 rounded-2xl p-4">
                        <h2 className="text-xs font-black text-gray-500 uppercase mb-3 tracking-widest">LIVE TRACKS ({Object.keys(drivers).length})</h2>
                        {Object.keys(drivers).length === 0 ? <p className="text-[10px] text-gray-500 italic font-medium">None active</p> : (
                            <div className="space-y-2">
                                {Object.values(drivers).map(d => (
                                    <div key={d.driverId} className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-white/5 shadow-sm">
                                        <div>
                                            <p className="font-black text-xs text-gray-800 dark:text-gray-200 uppercase">SHUTTLE {d.shuttleNumber || d.driverId.slice(-3)}</p>
                                            <p className="text-[10px] text-green-600 font-bold uppercase">Streaming</p>
                                        </div>
                                        <button
                                            onClick={() => handleForceStop(d.socketId)}
                                            className="text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 p-2 rounded-full transition-colors"
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
                                <div className="flex items-center gap-2">
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
                            <Popup>Shuttle {d.shuttleNumber || d.driverId.slice(-3)}</Popup>
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
