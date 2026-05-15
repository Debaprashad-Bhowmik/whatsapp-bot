require('dotenv').config();
const { Client, RemoteAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const mongoose = require('mongoose');
const { MongoStore } = require('wwebjs-mongo');
const express = require('express');

// Express server for Render to ping
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('WhatsApp Bot is Alive!');
});

app.listen(PORT, () => {
    console.log(`🌍 Express ping server listening on port ${PORT}`);
});

// Target phone number formatted for whatsapp-web.js
// Dad's number: +880 1847-101102
const TARGET_NUMBER = '8801847101102@c.us';

console.log('Connecting to MongoDB Atlas...');

// Ensure MONGODB_URI is provided in .env
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
            backupSyncIntervalMs: 300000 // Saves session to DB every 5 mins
        }),
        puppeteer: {
            // Essential for running Puppeteer on free cloud servers
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', (qr) => {
        // Generate and scan this code with your phone
        console.log('\n======================================================');
        console.log('SCAN THIS QR CODE WITH YOUR WHATSAPP TO LINK THE BOT');
        console.log('======================================================\n');
        qrcode.generate(qr, { small: true });
    });

    client.on('remote_session_saved', () => {
        console.log('☁️  WhatsApp session saved securely to MongoDB.');
    });

    client.on('ready', async () => {
        console.log('✅ Client is ready! Bot is now connected.');

        // Schedule the recurring message every 8 hours
        // Cron expression for every 8 hours: '0 */8 * * *'
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
    });

    // Start the client
    client.initialize();
}).catch((err) => {
    console.error('❌ MongoDB Connection Error:', err);
});
