const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String }, // Hashed password (drivers only)
    role: { type: String, enum: ['student', 'driver', 'admin'], required: true },
    isApproved: { type: Boolean, default: false } // For drivers
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
