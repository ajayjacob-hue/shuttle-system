require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8']);
const mongoose = require('mongoose');
const User = require('./models/User');
const bcrypt = require('bcryptjs');

async function testPassword() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const admin = await User.findOne({ email: 'vitshuttle', role: 'admin' });
    if (!admin) {
        console.log("Admin not found!");
        process.exit(1);
    }
    
    const isMatch = await bcrypt.compare('vss123', admin.password);
    console.log("Password 'vss123' match check:", isMatch);
    
    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

testPassword();
