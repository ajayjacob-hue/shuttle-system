require('dotenv').config();
const mongoose = require('mongoose');

console.log("Testing MongoDB Connection...");
console.log("URI:", process.env.MONGO_URI.replace(/:([^:@]+)@/, ':****@')); // Hide password

mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("✅ SUCCESS: MongoDB Connected!");
        process.exit(0);
    })
    .catch(err => {
        console.error("❌ FAILED: Connection Error");
        console.error(err);
        process.exit(1);
    });
