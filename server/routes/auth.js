const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error("FATAL ERROR: JWT_SECRET is not defined in .env");
    process.exit(1);
}

// --- DRIVER AUTH ---

// Driver Signup
router.post('/driver/signup', async (req, res) => {
    try {
        const { email, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: 'Email already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            email,
            password: hashedPassword,
            role: 'driver',
            isApproved: false // Requires admin approval
        });
        await newUser.save();
        res.status(201).json({ message: 'Driver registered. Please wait for admin approval.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Driver Login
router.post('/driver/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email, role: 'driver' });
        if (!user) return res.status(400).json({ message: 'Invalid credentials' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

        if (!user.isApproved) return res.status(403).json({ message: 'Account not approved yet' });

        const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { email: user.email, role: user.role } });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// --- ADMIN ---

// Admin Login
router.post('/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log(`Admin login attempt for: ${email}`);

        const admin = await User.findOne({ email, role: 'admin' });
        
        if (!admin) {
            console.log(`Login failed: Admin user '${email}' not found in database.`);
            return res.status(401).json({ message: 'Invalid admin credentials' });
        }

        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) {
            console.log(`Login failed: Password mismatch for admin '${email}'.`);
            return res.status(401).json({ message: 'Invalid admin credentials' });
        }

        console.log(`Admin login successful for: ${email}`);
        const token = jwt.sign({ userId: admin._id, role: 'admin' }, JWT_SECRET, { expiresIn: '1d' });
        res.json({ token, user: { email: admin.email, role: 'admin' } });
    } catch (error) {
        console.error("Admin Login Error:", error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// List Pending Drivers
router.get('/admin/pending-drivers', async (req, res) => {
    try {
        const drivers = await User.find({ role: 'driver', isApproved: false }).select('-password');
        res.json(drivers);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// List All Approved Drivers
router.get('/admin/approved-drivers', async (req, res) => {
    try {
        const drivers = await User.find({ role: 'driver', isApproved: true }).select('-password');
        res.json(drivers);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Approve Driver
router.post('/admin/approve-driver', async (req, res) => {
    try {
        const { driverId } = req.body;
        await User.findByIdAndUpdate(driverId, { isApproved: true });
        res.json({ message: 'Driver approved' });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Reject/Delete Pending Driver
router.post('/admin/reject-driver', async (req, res) => {
    try {
        const { driverId } = req.body;
        await User.findByIdAndDelete(driverId);
        res.json({ message: 'Driver request rejected and account removed' });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete Driver Account (Requires Admin Password)
router.post('/admin/delete-driver', async (req, res) => {
    try {
        const { driverId, adminPassword } = req.body;

        // Verify Admin Password against DB
        const admin = await User.findOne({ role: 'admin' }); // Get any admin (vitshuttle)
        if (!admin) {
            return res.status(500).json({ message: 'Admin account not found in system' });
        }

        const isMatch = await bcrypt.compare(adminPassword, admin.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Unauthorized: Invalid admin password' });
        }

        await User.findByIdAndDelete(driverId);
        res.json({ message: 'Driver account deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
