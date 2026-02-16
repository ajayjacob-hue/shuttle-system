const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const distance = require('@turf/distance').default;
const { point } = require('@turf/helpers');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for dev simplicity
    methods: ["GET", "POST"]
  }
});

// Configuration
const VIT_VELLORE_CENTER = point([79.1559, 12.9692]); // [lng, lat] for turf
const GEOFENCE_RADIUS_KM = 5000; // Increased for testing (was 2.5)

// State
const activeDrivers = new Map(); // Stores socket.id -> { driverId, lat, lng, lastUpdate }
let loadingBusCount = 1;

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Client joins as 'driver' or 'student'
  socket.on('join_role', (role) => {
    if (role === 'driver') {
      // Just join, wait for location update to register ID
      socket.join('driver');
      console.log(`Driver joined: ${socket.id}`);
    } else if (role === 'student') {
      socket.join('student');
      console.log(`Socket ${socket.id} joined as ${role}`);
      // Send existing drivers to new student
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
        io.to('student').emit('driver_offline', { socketId: sId });
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
        io.to('student').emit('driver_offline', { socketId: socket.id });
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

    // Broadcast to students
    io.to('student').emit('shuttle_moved', driverInfo);
  });

  socket.on('stop_sharing', () => {
    if (activeDrivers.has(socket.id)) {
      activeDrivers.delete(socket.id);
      io.to('student').emit('driver_offline', { socketId: socket.id });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (activeDrivers.has(socket.id)) {
      activeDrivers.delete(socket.id);
      io.to('student').emit('driver_offline', { socketId: socket.id });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
