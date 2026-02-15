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
const GEOFENCE_RADIUS_KM = 2.5;

// State
const activeDrivers = new Map(); // Stores socket.id -> { driverId, lat, lng, lastUpdate }
let loadingBusCount = 1;

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Client joins as 'driver' or 'student'
  socket.on('join_role', (role) => {
    if (role === 'driver') {
      const driverId = `Bus ${loadingBusCount++}`;
      // Store driver with initial null location
      activeDrivers.set(socket.id, { driverId, lat: null, lng: null, lastUpdate: null });
      socket.join('driver');
      console.log(`Driver registered: ${driverId} (${socket.id})`);

      // Tell the driver their ID
      socket.emit('login_success', { driverId });
    } else if (role === 'student') {
      socket.join('student');
      console.log(`Socket ${socket.id} joined as ${role}`);
      // Send existing drivers to new student
      const driversList = {};
      activeDrivers.forEach((val, key) => {
        if (val.lat !== null && val.lng !== null) { // Only send drivers with active locations
          driversList[key] = {
            socketId: key,
            driverId: val.driverId,
            lat: val.lat,
            lng: val.lng,
            lastUpdate: val.lastUpdate
          };
        }
      });
      socket.emit('initial_drivers', Object.values(driversList));
    }
  });

  // Driver updates location
  socket.on('update_location', (data) => {
    // data: { lat, lng } (driverId is now managed internally)
    // Validation
    if (!data || !data.lat || !data.lng) return;

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
      driverId: data.driverId || 'Unknown Driver',
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
