// Simple Haversine distance for fallback (returns km)
const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
    var R = 6371; // Radius of the earth in km
    var dLat = deg2rad(lat2 - lat1);
    var dLon = deg2rad(lon2 - lon1);
    var a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
        ;
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c; // Distance in km
    return d;
}

const deg2rad = (deg) => {
    return deg * (Math.PI / 180)
}

// Cache to store recent ETA results to avoid spamming the API
// Key: "startLat,startLng-endLat,endLng" -> { duration: number (seconds), timestamp: number }
const etaCache = new Map();

/**
 * Calculates ETA from start to end coordinates.
 * @param {object} start - { lat, lng }
 * @param {object} end - { lat, lng }
 * @returns {Promise<string>} - ETA string (e.g., "5 mins", "1 min", "< 1 min")
 */
export const calculateETA = async (start, end) => {
    if (!start || !end) return null;

    // 1. Check Cache (Simple check: if same coords requested within 30s)
    // Round coords to 4 decimal places to increase cache hit rate (~11m precision)
    const key = `${start.lat.toFixed(4)},${start.lng.toFixed(4)}-${end.lat.toFixed(4)},${end.lng.toFixed(4)}`;
    const cached = etaCache.get(key);
    if (cached && (Date.now() - cached.timestamp < 30000)) {
        return formatDuration(cached.duration);
    }

    try {
        // 2. OSRM API Call
        // formatting: lon,lat;lon,lat
        const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=false`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error("OSRM API invalid response");

        const data = await response.json();

        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            const durationSeconds = data.routes[0].duration;

            // Update Cache
            etaCache.set(key, { duration: durationSeconds, timestamp: Date.now() });

            return formatDuration(durationSeconds);
        } else {
            throw new Error("No route found");
        }

    } catch (err) {
        console.warn("ETA API failed, using fallback:", err.message);

        // 3. Fallback: Straight line distance * 1.5 (tortuosity factor) / 30km/h avg speed
        const distKm = getDistanceFromLatLonInKm(start.lat, start.lng, end.lat, end.lng);
        const effectiveDistKm = distKm * 1.5; // Estimate road distance
        const speedKmph = 30; // Average bus speed
        const timeHours = effectiveDistKm / speedKmph;
        const durationSeconds = timeHours * 3600;

        return formatDuration(durationSeconds);
    }
};

const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    if (mins < 1) return "< 1 min";
    if (mins === 1) return "1 min";
    return `${mins} mins`;
};
