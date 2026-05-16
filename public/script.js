document.addEventListener('DOMContentLoaded', () => {
    fetchStatus();
    fetchConfig();
    
    // Poll status every 3 seconds
    setInterval(fetchStatus, 3000);

    const form = document.getElementById('config-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const saveBtn = document.getElementById('save-btn');
        const originalText = saveBtn.innerHTML;
        saveBtn.innerHTML = 'Saving...';
        saveBtn.style.opacity = '0.8';

        const config = {
            targetNumber: document.getElementById('targetNumber').value,
            message: document.getElementById('message').value,
            intervalHours: parseInt(document.getElementById('intervalHours').value),
            isActive: document.getElementById('isActive').checked
        };

        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            
            if (res.ok) {
                saveBtn.innerHTML = '✅ Saved!';
                saveBtn.style.background = 'linear-gradient(to right, #10b981, #059669)';
                setTimeout(() => {
                    saveBtn.innerHTML = originalText;
                    saveBtn.style.background = '';
                    saveBtn.style.opacity = '1';
                }, 2000);
            }
        } catch (err) {
            console.error(err);
            saveBtn.innerHTML = '❌ Error';
            setTimeout(() => { saveBtn.innerHTML = originalText; }, 2000);
        }
    });
});

async function fetchStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        
        const indicator = document.getElementById('status-indicator');
        const content = document.getElementById('status-content');
        
        if (data.state === 'STARTING') {
            indicator.className = 'pulse-dot starting';
            content.innerHTML = '<p id="status-text">Booting up systems...</p>';
        } 
        else if (data.state === 'QR') {
            indicator.className = 'pulse-dot starting';
            content.innerHTML = `
                <p id="status-text" style="color: #f8fafc; font-weight: 600;">Scan QR Code to Link</p>
                <img src="${data.qrImage}" class="qr-image" alt="QR Code">
                <p style="font-size: 0.8rem; margin-top: 10px; color: #94a3b8;">Settings > Linked Devices</p>
            `;
        }
        else if (data.state === 'CONNECTED') {
            indicator.className = 'pulse-dot connected';
            content.innerHTML = `
                <div style="font-size: 4rem; margin-bottom: 10px;">✅</div>
                <h3 style="color: #10b981; margin-bottom: 5px;">Bot is Armed</h3>
                <p style="color: var(--text-secondary); font-size: 0.9rem;">Session stored securely.</p>
            `;
        }
        else if (data.state === 'DISCONNECTED') {
            indicator.className = 'pulse-dot disconnected';
            content.innerHTML = `
                <div style="font-size: 4rem; margin-bottom: 10px;">❌</div>
                <h3 style="color: #ef4444; margin-bottom: 5px;">Disconnected</h3>
                <p style="color: var(--text-secondary); font-size: 0.9rem;">Server is restarting or logged out.</p>
            `;
        }
    } catch (err) {
        console.error('Status fetch failed', err);
    }
}

async function fetchConfig() {
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        
        if (data) {
            // Strip @s.whatsapp.net from the display
            let num = data.targetNumber || '';
            if (num.includes('@')) {
                num = num.split('@')[0];
            }
            
            document.getElementById('targetNumber').value = num;
            document.getElementById('message').value = data.message || '';
            document.getElementById('intervalHours').value = data.intervalHours || 8;
            document.getElementById('isActive').checked = data.isActive !== false; // default true
        }
    } catch (err) {
        console.error('Config fetch failed', err);
    }
}
