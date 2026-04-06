/**
 * Centralized API configuration for the Shuttle System.
 * This ensures consistency across the web and mobile apps.
 */

// Priority 1: Environment Variable (set during npm run build)
// Priority 2: Remote Render address (Hardcoded fallback for mobile ease)
// Priority 3: Localhost (for local development)
const REMOTE_URL = 'https://shuttle-system-p9d4.onrender.com';
const LOCAL_URL = 'http://localhost:3000';

export const API_URL = import.meta.env.VITE_API_URL || REMOTE_URL || LOCAL_URL;

export const getAuthHeader = () => {
    const token = localStorage.getItem('token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

export const getJSONHeaders = () => ({
    'Content-Type': 'application/json',
    ...getAuthHeader()
});
