const mongoose = require('mongoose');

const RouteSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true }, // Keep string ID for compatibility with frontend logic
    name: { type: String, required: true },
    color: { type: String, default: '#ff0000' },
    waypoints: { type: [[Number]], required: true } // Array of [lat, lng] arrays
}, { timestamps: true });

module.exports = mongoose.model('Route', RouteSchema);
