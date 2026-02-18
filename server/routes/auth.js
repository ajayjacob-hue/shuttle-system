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
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // use SSL
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Generate OTP (Real Email)
router.post('/student/login-otp', async (req, res) => {
    try {
        const { email } = req.body;

        // Basic validation for VIT email if desired
        // if (!email.endsWith('@vit.ac.in')) return res.status(400).json({ message: 'Use VIT email' });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

        let user = await User.findOne({ email, role: 'student' });
        if (!user) {
            user = new User({ email, role: 'student', isApproved: true });
        }
        user.otp = otp;
        user.otpExpires = otpExpires;
        await user.save();

        console.log(`>>> OTP for ${email}: ${otp} <<<`); // Keep log for dev backup



        // Send Email with Timeout
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'VIT Shuttle Login OTP',
            text: `Your OTP for VIT Shuttle Login is: ${otp}. It expires in 10 minutes.`
        };

        // Wrap sendMail in a promise to handle timeout
        const sendMailPromise = new Promise((resolve, reject) => {
            transporter.sendMail(mailOptions, (error, info) => {
                if (error) reject(error);
                else resolve(info);
            });
        });

        // timeout after 10 seconds
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Email sending timed out. Check internet or credentials.')), 10000);
        });

        try {
            const info = await Promise.race([sendMailPromise, timeoutPromise]);
            console.log('Email sent: ' + info.response);
            res.json({ message: `OTP sent to ${email}` });
        } catch (error) {
            console.error("Email Error:", error.message);
            // Fallback: still allow login if email fails in dev, but warn user
            if (process.env.NODE_ENV !== 'production') {
                res.json({ message: `OTP Sent to CONSOLE (Email failed: ${error.message})` });
            } else {
                res.status(500).json({ message: 'Failed to send email. ' + error.message });
            }
        }

    } catch (error) {
        console.error("OTP Error:", error);
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
