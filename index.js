require('dotenv').config();
const { Client, RemoteAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cron = require('node-cron');
const mongoose = require('mongoose');
const { MongoStore } = require('wwebjs-mongo');
const express = require('express');

// Express server to display QR code and keep Render awake
const app = express();
const PORT = process.env.PORT || 3000;

// State variable for the webpage
let webpageContent = `
    <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
        <h2>Bot is starting...</h2>
        <p>Please refresh this page in a few seconds to see the QR code.</p>
    </div>
`;

app.get('/', (req, res) => {
    res.send(webpageContent);
});

app.listen(PORT, () => {
    console.log(`🌍 Web server listening on port ${PORT}`);
});

// Target phone number formatted for whatsapp-web.js
const TARGET_NUMBER = '8801847101102@c.us';

console.log('Connecting to MongoDB Atlas...');

if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI is missing in .env file!');
    process.exit(1);
}

mongoose.connect(process.env.MONGODB_URI).then(() => {
    console.log('✅ Connected to MongoDB!');
    
    const store = new MongoStore({ mongoose: mongoose });
    
    console.log('Initializing WhatsApp Client with RemoteAuth...');
    
    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 300000
        }),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', async (qr) => {
        console.log('📱 QR Code generated! Check the web page to scan it.');
        try {
            // Generate a base64 image of the QR code
            const qrImage = await qrcode.toDataURL(qr);
            webpageContent = `
                <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                    <h2>Scan this QR code with your WhatsApp</h2>
                    <p>Go to Settings > Linked Devices > Link a Device</p>
                    <img src="${qrImage}" alt="QR Code" style="width: 300px; height: 300px; border: 1px solid #ccc; padding: 10px; border-radius: 10px;"/>
                </div>
            `;
        } catch (err) {
            console.error('Failed to generate QR image:', err);
        }
    });

    client.on('remote_session_saved', () => {
        console.log('☁️  WhatsApp session saved securely to MongoDB.');
    });

    client.on('ready', async () => {
        console.log('✅ Client is ready! Bot is now connected.');
        webpageContent = `
            <div style="font-family: sans-serif; text-align: center; margin-top: 50px; color: green;">
                <h2>✅ WhatsApp Bot is Alive and Connected!</h2>
                <p>The session is securely saved in MongoDB.</p>
            </div>
        `;

        console.log('⏳ Setting up schedule to send "valo achi" every 8 hours...');
        cron.schedule('0 */8 * * *', async () => {
            try {
                console.log(`[${new Date().toLocaleString()}] Sending scheduled message...`);
                await client.sendMessage(TARGET_NUMBER, 'valo achi');
                console.log(`[${new Date().toLocaleString()}] ✅ Scheduled message sent!`);
            } catch (err) {
                console.error(`[${new Date().toLocaleString()}] ❌ Failed to send scheduled message:`, err);
            }
        });
    });

    client.on('authenticated', () => {
        console.log('✅ Authenticated successfully!');
    });

    client.on('auth_failure', msg => {
        console.error('❌ Authentication failure', msg);
    });

    client.on('disconnected', (reason) => {
        console.log('❌ Client was logged out', reason);
        webpageContent = `
            <div style="font-family: sans-serif; text-align: center; margin-top: 50px; color: red;">
                <h2>❌ WhatsApp Bot was disconnected.</h2>
                <p>Please restart the server to generate a new QR code.</p>
            </div>
        `;
    });

    client.initialize();
}).catch((err) => {
    console.error('❌ MongoDB Connection Error:', err);
});
