require('dotenv').config();
const { default: makeWASocket, DisconnectReason, initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const cron = require('node-cron');
const mongoose = require('mongoose');
const express = require('express');

// Express server to display QR code and keep Render awake
const app = express();
const PORT = process.env.PORT || 3000;

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

// Target phone number formatted for Baileys
const TARGET_NUMBER = '8801847101102@s.whatsapp.net';

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

mongoose.connect(process.env.MONGODB_URI).then(async () => {
    console.log('✅ Connected to MongoDB!');
    
    // Create a generic schema/model for the auth state
    const AuthSchema = new mongoose.Schema({ _id: String }, { strict: false });
    const AuthCollection = mongoose.model('BaileysAuth', AuthSchema);
    
    const { state, saveCreds } = await useMongoDBAuthState(AuthCollection);

    async function startBot() {
        console.log('Initializing Baileys WhatsApp Client...');
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }) // Disable noisy logs
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('📱 QR Code generated! Check the web page to scan it.');
                try {
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
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('❌ Connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
                
                webpageContent = `
                    <div style="font-family: sans-serif; text-align: center; margin-top: 50px; color: red;">
                        <h2>❌ WhatsApp Bot was disconnected.</h2>
                        <p>Server restarting...</p>
                    </div>
                `;

                if (shouldReconnect) {
                    startBot();
                } else {
                    console.log('Logged out. Please restart server to get new QR code.');
                    // If logged out, delete auth state
                    await AuthCollection.deleteMany({});
                    process.exit(0);
                }
            } else if (connection === 'open') {
                console.log('✅ Client is ready! Bot is now connected.');
                webpageContent = `
                    <div style="font-family: sans-serif; text-align: center; margin-top: 50px; color: green;">
                        <h2>✅ WhatsApp Bot is Alive and Connected!</h2>
                        <p>The session is securely saved in MongoDB.</p>
                    </div>
                `;
            }
        });

        // Clear existing cron jobs if reconnecting
        cron.getTasks().forEach(task => task.stop());

        console.log('⏳ Setting up schedule to send "valo achi" every 8 hours...');
        cron.schedule('0 */8 * * *', async () => {
            try {
                console.log(`[${new Date().toLocaleString()}] Sending scheduled message...`);
                await sock.sendMessage(TARGET_NUMBER, { text: 'valo achi' });
                console.log(`[${new Date().toLocaleString()}] ✅ Scheduled message sent!`);
            } catch (err) {
                console.error(`[${new Date().toLocaleString()}] ❌ Failed to send scheduled message:`, err);
            }
        });
    }

    startBot();

}).catch((err) => {
    console.error('❌ MongoDB Connection Error:', err);
});
