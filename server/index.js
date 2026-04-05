require('dotenv').config();
const dns = require('dns');
// FIX: Custom DNS servers (8.8.8.8) to resolve MongoDB SRV record issues on local networks
dns.setServers(['8.8.8.8']);

// Environment Validation
const requiredEnv = ['MONGO_URI', 'JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'];
const missingEnv = requiredEnv.filter(env => !process.env[env]);
if (missingEnv.length > 0) {
  console.error(`FATAL ERROR: Missing environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const distance = require('@turf/distance').default;
const { point } = require('@turf/helpers');
const path = require('path');
const mongoose = require('mongoose');
const Route = require('./models/Route');
const User = require('./models/User');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json()); // Parse JSON bodies

// Root Route for easy checking
app.get('/', (req, res) => {
  res.send('Shuttle System Server is Running! Check /api/health for status.');
});

// Routes
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// Health Check
app.get('/api/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState;
  const statusMap = {
    0: 'Disconnected',
    1: 'Connected',
    2: 'Connecting',
    3: 'Disconnecting',
  };
  res.json({
    status: 'ok',
    db: statusMap[dbStatus] || 'Unknown',
    timestamp: new Date().toISOString()
  });
});

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('MongoDB Connected');
    
    // AUTO-SYNC ADMIN FROM ENV
    try {
      const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      await User.findOneAndUpdate(
        { role: 'admin' }, // Find existing admin
        { 
          email: process.env.ADMIN_EMAIL, 
          password: hashedPassword,
          isApproved: true
        },
        { upsert: true, returnDocument: 'after' }
      );
      console.log(`Admin user '${process.env.ADMIN_EMAIL}' synced from environment.`);
    } catch (e) {
      console.error("Admin Sync Error:", e);
    }
  })
  .catch(err => console.error('MongoDB Connection Error:', err));

mongoose.connection.on('error', err => {
  console.error('MongoDB Runtime Error:', err);
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingInterval: 5000,
  pingTimeout: 10000
});

// Configuration
const VIT_VELLORE_CENTER = point([79.1559, 12.9692]); // [lng, lat] for turf
const GEOFENCE_RADIUS_KM = 5000;

// State
// State
const activeDrivers = new Map(); // Stores socket.id -> { driverId, shuttleNumber }
const liveDrivers = new Map();   // Persistent: driverId (email) -> { lat, lng, lastUpdate, shuttleNumber, socketId }

function getNextShuttleNumber() {
  const usedNumbers = new Set();
  for (const driver of liveDrivers.values()) {
    if (driver.shuttleNumber) usedNumbers.add(driver.shuttleNumber);
  }
  let num = 1;
  while (usedNumbers.has(num)) {
    num++;
  }
  return num;
}

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
      liveDrivers.forEach((val, key) => {
        if (val.lat !== null && val.lng !== null) {
          driversList[key] = {
            socketId: val.socketId || key,
            driverId: key,
            shuttleNumber: val.shuttleNumber,
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
      liveDrivers.forEach((val, key) => {
        if (val.lat !== null && val.lng !== null) {
          driversList[key] = {
            socketId: val.socketId || key,
            driverId: key,
            shuttleNumber: val.shuttleNumber,
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
  socket.on('admin_login', async (password, callback) => {
    try {
      const admin = await User.findOne({ role: 'admin' });
      if (!admin) {
        return callback({ success: false, message: 'Admin account not found' });
      }

      const isMatch = await bcrypt.compare(password, admin.password);
      if (isMatch) {
        callback({ success: true });
        socket.join('admin');
      } else {
        callback({ success: false });
      }
    } catch (e) {
      console.error("Admin socket login error:", e);
      callback({ success: false });
    }
  });

  socket.on('save_route', async (routeData) => {
    try {
      // Upsert based on ID
      await Route.findOneAndUpdate(
        { id: routeData.id },
        routeData,
        { upsert: true, returnDocument: 'after' }
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
    let existingShuttleNumber;
    for (const [sId, driver] of activeDrivers.entries()) {
      if (driver.driverId === data.driverId) {
        if (sId !== socket.id) {
          console.log(`Duplicate driver ${data.driverId} detected. Removing old socket ${sId}`);
          activeDrivers.delete(sId);
          // Tell students to remove the old ghost immediately
          io.to('student').to('admin').emit('driver_offline', { socketId: sId });
        } else {
          existingShuttleNumber = driver.shuttleNumber;
        }
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

    // Inside Geofence -> Update Persistent State
    const existing = liveDrivers.get(data.driverId);
    const assignedShuttleNumber = (existing && existing.shuttleNumber) || getNextShuttleNumber();
    
    const driverInfo = {
      socketId: socket.id,
      driverId: data.driverId,
      shuttleNumber: assignedShuttleNumber,
      lat: data.lat,
      lng: data.lng,
      lastUpdate: Date.now()
    };

    activeDrivers.set(socket.id, { driverId: data.driverId, shuttleNumber: assignedShuttleNumber });
    liveDrivers.set(data.driverId, driverInfo);

    // Send the shuttle number specific to this driver
    socket.emit('shuttle_info', { shuttleNumber: assignedShuttleNumber });

    // Broadcast to students AND admins
    io.to('student').to('admin').emit('shuttle_moved', driverInfo);
  });

  socket.on('stop_sharing', (data) => {
    // Standard Socket case
    const driverId = data?.driverId;
    if (activeDrivers.has(socket.id) || driverId) {
      const activeDriverId = activeDrivers.get(socket.id)?.driverId || driverId;
      activeDrivers.delete(socket.id);
      if (activeDriverId) {
        liveDrivers.delete(activeDriverId);
        io.to('student').to('admin').emit('driver_offline', { socketId: socket.id, driverId: activeDriverId });
      }
    }
  });

  socket.on('disconnect', () => {
    if (activeDrivers.has(socket.id)) {
      const { driverId } = activeDrivers.get(socket.id);
      // NOTE: We don't delete from liveDrivers on disconnect! 
      // This allows HTTP fallback to continue.
      activeDrivers.delete(socket.id);
    }
  });
});

// HTTP API FOR BACKGROUND UPDATES (FALLBACK)
app.post('/api/driver/location', (req, res) => {
  const { driverId, lat, lng } = req.body;
  if (!driverId || !lat || !lng) return res.status(400).json({ error: 'Missing data' });

  const existing = liveDrivers.get(driverId);
  const shuttleNumber = (existing && existing.shuttleNumber) || getNextShuttleNumber();

  const driverInfo = {
    socketId: (existing && existing.socketId) || `http-${driverId.split('@')[0]}`,
    driverId,
    shuttleNumber,
    lat,
    lng,
    lastUpdate: Date.now()
  };

  liveDrivers.set(driverId, driverInfo);

  // Broadcast to tracking screens
  io.to('student').to('admin').emit('shuttle_moved', driverInfo);
  res.json({ success: true, shuttleNumber });
});

// HTTP API FOR STOPPING SHARING (FALLBACK)
app.post('/api/driver/stop', (req, res) => {
  const { driverId } = req.body;
  if (!driverId) return res.status(400).json({ error: 'Missing driverId' });

  const existing = liveDrivers.get(driverId);
  liveDrivers.delete(driverId);

  // Broadcast to tracking screens
  io.to('student').to('admin').emit('driver_offline', { 
    socketId: (existing && existing.socketId) || `http-${driverId.split('@')[0]}`, 
    driverId 
  });

  res.json({ success: true });
});

// Periodic Cleanup for Stale Drivers (5 minutes without any update)
setInterval(() => {
  const now = Date.now();
  liveDrivers.forEach((val, driverId) => {
    if (now - val.lastUpdate > 300000) { // 5 minutes
      console.log(`Cleaning up stale driver: ${driverId}`);
      liveDrivers.delete(driverId);
      io.to('student').to('admin').emit('driver_offline', { socketId: val.socketId, driverId });
    }
  });
}, 30000); // Check every 30s instead of 10s to be less aggressive

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

// GLOBAL ERROR HANDLER
app.use((err, req, res, next) => {
  console.error("Unhandled Server Error:", err);
  res.status(500).json({ 
    status: 'error', 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
