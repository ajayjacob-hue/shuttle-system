const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_change_in_prod';

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

        // Verify Admin Password (hardcoded check matching current system)
        if (adminPassword !== 'admin123') {
            return res.status(401).json({ message: 'Unauthorized: Invalid admin password' });
        }

        await User.findByIdAndDelete(driverId);
        res.json({ message: 'Driver account deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
