VIT Shuttle Tracking System
Project StatusPlatformTech Stack

A comprehensive, real-time shuttle tracking solution consisting of a backend service and a cross-platform progressive web application (PWA) compiled into an Android App via Capacitor. The system allows drivers to seamlessly share their live locations and provides an administrative dashboard to manage active drivers and system settings.

🌟 Key Features
Real-Time Location Tracking: Drivers can securely broadcast their live GPS location, which is continuously tracked in real-time.
Background Location Sharing: Implements a persistent background notification system, ensuring location updates continue cleanly and reliably even when the app is running in the background.
Geofencing Integration: Configured with a custom 1km geofence radius to accurately track shuttle entries and exits.
Admin Dashboard:
Secure Administrator login utilizing robust JWT Authentication.
Monitor real-time active drivers on a centralized map interface.
Implement an Admin Force Stop to remotely terminate active driver tracking sessions when required.
Automated Stale Driver Cleanup: Backend service automatically identifies and safely removes driver locations from the active map if they have been inactive/unresponsive for over 1 minute.
Cross-Platform Delivery: Built originally as a Responsive Web App/PWA, and gracefully wrapped into a scalable native-like Android APK via Ionic Capacitor.
🛠️ Technology Stack
Frontend / Mobile: Web Technologies (HTML/CSS/JS), Progressive Web App (PWA), Capacitor (Android builds)
Backend API: Node.js & Express.js
Database: MongoDB (Admin credentials, location states, etc.)
Deployment: Render (Backend APIs)
Authentication: JWT (JSON Web Tokens)
🚀 Getting Started
Prerequisites
Node.js (v16+ recommended)
A MongoDB Cluster / Local Instance
Android Studio (For Capacitor Android compilation only)
Installation
Clone the repository

bash
git clone https://github.com/yourusername/shuttle-tracking.git
cd shuttle-tracking
Environment Variables Create a .env file in the root directory:

env
PORT=3000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret_key
ADMIN_USERNAME=vitshuttle
ADMIN_PASSWORD=your_admin_password
Backend Setup

bash
# Install dependencies
npm install
# Start the development server
npm run start
Mobile App Build (Capacitor) Ensure the frontend API calls are pointed correctly to your backend URL (e.g., your Render production URL or localhost for local testing).

bash
# Sync web assets to Capacitor android folder
npx cap sync
# Open Android Studio to build and run the APK
npx cap open android
🔐 Credentials & Security
Admin credentials (vitshuttle) can be initialized via environment variables upon the server's first startup, securely migrating and persisting them into the MongoDB database.
All backend administrative routes and data-modifying endpoints are strictly guarded by JWT token verification.
👨‍💻 Team
This system was finalized and distributed among a 5-person development team, encompassing:

Backend Architecture & API Routes
Authentication & MongoDB Migrations
Frontend App Design & PWA Enhancements
Capacitor Native Compilation
Geofencing & Real-Time Logistics
📝 License
This project is licensed under the MIT License.

