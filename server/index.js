require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const distance = require('@turf/distance').default;
const { point } = require('@turf/helpers');
const path = require('path');
const mongoose = require('mongoose');
const Route = require('./models/Route');

const app = express();
app.use(cors());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Connection Error:', err));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Configuration
const VIT_VELLORE_CENTER = point([79.1559, 12.9692]); // [lng, lat] for turf
const GEOFENCE_RADIUS_KM = 5000;

// State
const activeDrivers = new Map(); // Stores socket.id -> { driverId, lat, lng, lastUpdate }

// Initial Data Helper
const getRoutes = async () => {
  try {
    return await Route.find({});
  } catch (e) {
    console.error("Error fetching routes:", e);
    return [];
  }
};

io.on('connection', async (socket) => {
  console.log('User connected:', socket.id);

  // Client joins as 'driver' or 'student'
  socket.on('join_role', async (role) => {
    if (role === 'driver') {
      socket.join('driver');
      console.log(`Driver joined: ${socket.id}`);
    } else if (role === 'student') {
      socket.join('student');
      console.log(`Socket ${socket.id} joined as ${role}`);

      const driversList = {};
      activeDrivers.forEach((val, key) => {
        if (val.lat !== null && val.lng !== null) {
          driversList[key] = {
            socketId: key,
            driverId: val.driverId,
            lat: val.lat,
            lng: val.lng,
            lastUpdate: val.lastUpdate
          };
        }
      });
      socket.emit('initial_drivers', driversList);
      socket.emit('routes_update', await getRoutes());
    } else if (role === 'admin') {
      socket.join('admin');
      console.log(`Admin joined: ${socket.id}`);

      // Send active drivers to admin too
      const driversList = {};
      activeDrivers.forEach((val, key) => {
        if (val.lat !== null && val.lng !== null) {
          driversList[key] = {
            socketId: key,
            driverId: val.driverId,
            lat: val.lat,
            lng: val.lng,
            lastUpdate: val.lastUpdate
          };
        }
      });
      socket.emit('initial_drivers', driversList);
      socket.emit('routes_update', await getRoutes());
    }
  });

  // ADMIN EVENTS
  socket.on('admin_login', (password, callback) => {
    if (password === 'admin123') {
      callback({ success: true });
      socket.join('admin');
    } else {
      callback({ success: false });
    }
  });

  socket.on('save_route', async (routeData) => {
    try {
      // Upsert based on ID
      await Route.findOneAndUpdate(
        { id: routeData.id },
        routeData,
        { upsert: true, new: true }
      );
      const allRoutes = await getRoutes();
      io.emit('routes_update', allRoutes);
    } catch (e) {
      console.error("Error saving route:", e);
    }
  });

  socket.on('delete_route', async (routeId) => {
    try {
      await Route.deleteOne({ id: routeId });
      const allRoutes = await getRoutes();
      io.emit('routes_update', allRoutes);
    } catch (e) {
      console.error("Error deleting route:", e);
    }
  });

  socket.on('admin_force_stop', (targetSocketId) => {
    io.to(targetSocketId).emit('force_stop_sharing', { reason: 'Stopped by Admin' });
    // Also remove from active list immediately
    if (activeDrivers.has(targetSocketId)) {
      activeDrivers.delete(targetSocketId);
      io.to('student').to('admin').emit('driver_offline', { socketId: targetSocketId });
    }
  });

  // Driver updates location
  socket.on('update_location', (data) => {
    // data: { driverId, lat, lng }
    if (!data || !data.lat || !data.lng || !data.driverId) return;

    // DEDUPLICATION: Check if this driverId is already active on ANOTHER socket
    // If so, remove the old one to prevent ghosts
    for (const [sId, driver] of activeDrivers.entries()) {
      if (driver.driverId === data.driverId && sId !== socket.id) {
        console.log(`Duplicate driver ${data.driverId} detected. Removing old socket ${sId}`);
        activeDrivers.delete(sId);
        // Tell students to remove the old ghost immediately
        io.to('student').to('admin').emit('driver_offline', { socketId: sId });
      }
    }

    const driverLocation = point([data.lng, data.lat]);
    const dist = distance(driverLocation, VIT_VELLORE_CENTER, { units: 'kilometers' });

    if (dist > GEOFENCE_RADIUS_KM) {
      // Outside Geofence!
      socket.emit('force_stop_sharing', { reason: 'Outside Service Area' });

      // Remove from active list
      if (activeDrivers.has(socket.id)) {
        activeDrivers.delete(socket.id);
        io.to('student').to('admin').emit('driver_offline', { socketId: socket.id });
      }
      return;
    }

    // Inside Geofence -> Broadcast
    const driverInfo = {
      socketId: socket.id,
      driverId: data.driverId,
      lat: data.lat,
      lng: data.lng,
      lastUpdate: Date.now()
    };

    activeDrivers.set(socket.id, driverInfo);

    // Broadcast to students AND admins
    io.to('student').to('admin').emit('shuttle_moved', driverInfo);
  });

  socket.on('stop_sharing', () => {
    if (activeDrivers.has(socket.id)) {
      activeDrivers.delete(socket.id);
      io.to('student').to('admin').emit('driver_offline', { socketId: socket.id });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (activeDrivers.has(socket.id)) {
      activeDrivers.delete(socket.id);
      io.to('student').to('admin').emit('driver_offline', { socketId: socket.id });
    }
  });
});

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get(/.*/, (req, res) => {
  const indexPath = path.join(__dirname, '../client/dist/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("Client build not found. Please run 'npm run build' in client directory.");
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
