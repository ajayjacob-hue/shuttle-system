require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8']); // DNS FIX
const mongoose = require('mongoose');
const User = require('./models/User');

async function checkAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB...");
    
    const admin = await User.findOne({ role: 'admin' });
    if (admin) {
      console.log("Admin user found:", { email: admin.email, role: admin.role });
    } else {
      console.log("No admin user found!");
    }
    
    process.exit(0);
  } catch (err) {
    console.error("Error checking admin:", err);
    process.exit(1);
  }
}

checkAdmin();
