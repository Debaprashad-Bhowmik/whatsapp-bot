require('dotenv').config();
const { default: makeWASocket, DisconnectReason, initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const cron = require('node-cron');
const mongoose = require('mongoose');
const express = require('express');
const path = require('path');

// Express server
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve the frontend dashboard

// Global States
let botStatus = { state: 'STARTING', qrImage: null };
let currentIntervalTimer = null;
let currentMessageIndex = 0;
let globalSock = null;
let isReconnecting = false;

// Database Schema for Bot Configuration
const ConfigSchema = new mongoose.Schema({
    _id: { type: String, default: 'global' },
    targetNumber: { type: String, default: '8801847101102@s.whatsapp.net' },
    messages: { type: [String], default: ['valo achi'] },
    intervalValue: { type: Number, default: 8 },
    intervalUnit: { type: String, default: 'Hours' },
    isActive: { type: Boolean, default: true }
});
const ConfigModel = mongoose.model('BotConfig', ConfigSchema);

// API Endpoints for Frontend Dashboard
app.get('/api/status', (req, res) => {
    res.json(botStatus);
});

app.get('/api/config', async (req, res) => {
    let config = await ConfigModel.findById('global');
    if (!config) {
        config = { targetNumber: '8801847101102@s.whatsapp.net', messages: ['valo achi'], intervalValue: 8, intervalUnit: 'Hours', isActive: true };
    }
    res.json(config);
});

app.post('/api/config', async (req, res) => {
    try {
        let target = req.body.targetNumber;
        if (!target.includes('@')) target += '@s.whatsapp.net';
        
        const newConfig = {
            _id: 'global',
            targetNumber: target,
            messages: req.body.messages || ['valo achi'],
            intervalValue: req.body.intervalValue || 8,
            intervalUnit: req.body.intervalUnit || 'Hours',
            isActive: req.body.isActive
        };
        
        await ConfigModel.replaceOne({ _id: 'global' }, newConfig, { upsert: true });
        
        // Refresh the schedule immediately with new settings
        await setupCron();
        res.json({ success: true });
    } catch (err) {
        console.error('Failed to save config:', err);
        res.status(500).json({ error: 'Failed to save config' });
    }
});

app.listen(PORT, () => {
    console.log(`🌍 Web server and API listening on port ${PORT}`);
});

console.log('Connecting to MongoDB Atlas...');

if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI is missing in .env file!');
    process.exit(1);
}

// Custom MongoDB Auth State for Baileys
const useMongoDBAuthState = async (collection) => {
    const writeData = async (data, id) => {
        await collection.replaceOne({ _id: id }, JSON.parse(JSON.stringify(data, BufferJSON.replacer)), { upsert: true });
    };
    const readData = async (id) => {
        const data = await collection.findOne({ _id: id });
        return data ? JSON.parse(JSON.stringify(data), BufferJSON.reviver) : null;
    };
    const removeData = async (id) => {
        await collection.deleteOne({ _id: id });
    };

    const creds = await readData('creds') || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async id => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(value, key) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds')
    };
};

async function setupCron() {
    if (currentIntervalTimer) {
        clearInterval(currentIntervalTimer);
        console.log('🛑 Stopped existing schedule.');
    }

    let config = await ConfigModel.findById('global');
    if (!config) {
        // Fallback default
        config = { targetNumber: '8801847101102@s.whatsapp.net', messages: ['valo achi'], intervalValue: 8, intervalUnit: 'Hours', isActive: true };
    }

    if (config.isActive && config.messages && config.messages.length > 0) {
        console.log(`⏳ Setting up schedule to send ${config.messages.length} messages to ${config.targetNumber} every ${config.intervalValue} ${config.intervalUnit}...`);
        
        // Calculate interval in milliseconds
        let intervalMs = config.intervalValue * 1000; // default Seconds
        if (config.intervalUnit === 'Minutes') intervalMs *= 60;
        if (config.intervalUnit === 'Hours') intervalMs *= 3600;
        
        // Ensure minimum interval of 0.5s to prevent freezing the bot
        if (intervalMs < 500) intervalMs = 500;

        currentMessageIndex = 0; // reset index when settings change

        currentIntervalTimer = setInterval(async () => {
            if (!globalSock) return;
            try {
                const msgToSend = config.messages[currentMessageIndex % config.messages.length];
                console.log(`[${new Date().toLocaleString()}] Sending scheduled message (${(currentMessageIndex % config.messages.length) + 1}/${config.messages.length})...`);
                await globalSock.sendMessage(config.targetNumber, { text: msgToSend });
                console.log(`[${new Date().toLocaleString()}] ✅ Scheduled message sent!`);
                currentMessageIndex++;
            } catch (err) {
                console.error(`[${new Date().toLocaleString()}] ❌ Failed to send scheduled message:`, err);
            }
        }, intervalMs);
    } else {
        console.log('⏸️ Bot automated messaging is currently set to OFF or no messages configured.');
    }
}

mongoose.connect(process.env.MONGODB_URI).then(async () => {
    console.log('✅ Connected to MongoDB!');
    
    const AuthSchema = new mongoose.Schema({ _id: String }, { strict: false });
    const AuthCollection = mongoose.model('BaileysAuth', AuthSchema);

    async function startBot() {
        if (isReconnecting) {
            console.log('⚠️ startBot called but already reconnecting/connecting. Ignoring.');
            return;
        }
        isReconnecting = true;

        console.log('Initializing Baileys WhatsApp Client...');
        botStatus.state = 'STARTING';
        
        // Fetch fresh auth state from DB every time we start/restart the bot
        const { state, saveCreds } = await useMongoDBAuthState(AuthCollection);

        globalSock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' })
        });

        globalSock.ev.on('creds.update', saveCreds);

        globalSock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('📱 QR Code generated! Check the dashboard to scan it.');
                try {
                    botStatus.qrImage = await qrcode.toDataURL(qr);
                    botStatus.state = 'QR';
                } catch (err) {
                    console.error('Failed to generate QR image:', err);
                }
            }

            if (connection === 'close') {
                isReconnecting = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                
                // 401 is Logged Out, 440 is Conflict (another instance running with same session)
                // 405 is Not Authorized. For all these, we should require re-authentication.
                const requireReAuth = statusCode === DisconnectReason.loggedOut || statusCode === 440 || statusCode === 405;
                const shouldReconnect = !requireReAuth;
                
                console.log('❌ Connection closed due to ', lastDisconnect?.error?.message || lastDisconnect?.error, ', reconnecting:', shouldReconnect);
                
                botStatus.state = 'DISCONNECTED';

                if (shouldReconnect) {
                    setTimeout(startBot, 5000); // Wait 5s before reconnect
                } else {
                    console.log('Session invalidated (logged out or conflict). Clearing credentials to get new QR code...');
                    botStatus.state = 'STARTING'; // Reset state so frontend knows we are restarting
                    await AuthCollection.deleteMany({});
                    setTimeout(startBot, 2000); // Restart bot to generate fresh QR
                }
            } else if (connection === 'open') {
                isReconnecting = false;
                console.log('✅ Client is ready! Bot is now connected.');
                botStatus.state = 'CONNECTED';
                botStatus.qrImage = null; // Clear QR code from memory
                
                // Initialize the cron schedule based on MongoDB settings
                setupCron();
            }
        });
    }

    startBot();

}).catch((err) => {
    console.error('❌ MongoDB Connection Error:', err);
});
