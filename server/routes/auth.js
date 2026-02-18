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

// --- STUDENT AUTH (OTP) ---

// Email Transporter
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail', // Use built-in Gmail preset (handles ports/secure auto)
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    },
    family: 4 // Force IPv4
});

// Verify connection configuration
transporter.verify(function (error, success) {
    if (error) {
        console.log("Transporter Error:", error);
    } else {
        console.log("Server is ready to take our messages");
    }
});

// Student Direct Login (No OTP for Prototype)
router.post('/student/login', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: 'Email is required' });

        // Find or create user
        let user = await User.findOne({ email, role: 'student' });
        if (!user) {
            user = new User({ email, role: 'student', isApproved: true });
            await user.save();
        }

        const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.json({
            token,
            user: { email: user.email, role: user.role },
            message: 'Login successful'
        });

    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Verify OTP
router.post('/student/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        const user = await User.findOne({ email, role: 'student' });

        if (!user || user.otp !== otp || user.otpExpires < Date.now()) {
            return res.status(400).json({ message: 'Invalid or expired OTP' });
        }

        // Clear OTP
        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();

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

module.exports = router;
