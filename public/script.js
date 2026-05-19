document.addEventListener('DOMContentLoaded', () => {
    fetchStatus();
    fetchConfig();
    
    // Poll status every 3 seconds
    setInterval(fetchStatus, 3000);

    const messageCountInput = document.getElementById('messageCount');
    messageCountInput.addEventListener('input', (e) => {
        const count = parseInt(e.target.value) || 1;
        renderMessageBoxes(count);
    });

    const form = document.getElementById('config-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const saveBtn = document.getElementById('save-btn');
        const originalText = saveBtn.innerHTML;
        saveBtn.innerHTML = 'Saving...';
        saveBtn.style.opacity = '0.8';

        // Gather all message box values
        const messages = [];
        const count = parseInt(document.getElementById('messageCount').value) || 1;
        for (let i = 0; i < count; i++) {
            const el = document.getElementById(`message-${i}`);
            if (el && el.value.trim() !== '') {
                messages.push(el.value.trim());
            }
        }
        
        if (messages.length === 0) {
            alert('Please enter at least one message.');
            saveBtn.innerHTML = originalText;
            saveBtn.style.opacity = '1';
            return;
        }

        const config = {
            targetNumber: document.getElementById('targetNumber').value,
            messages: messages,
            intervalValue: parseFloat(document.getElementById('intervalValue').value),
            intervalUnit: document.getElementById('intervalUnit').value,
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
            document.getElementById('intervalValue').value = data.intervalValue || 8;
            document.getElementById('intervalUnit').value = data.intervalUnit || 'Hours';
            document.getElementById('isActive').checked = data.isActive !== false; // default true
            
            const msgs = data.messages && data.messages.length > 0 ? data.messages : [''];
            document.getElementById('messageCount').value = msgs.length;
            renderMessageBoxes(msgs.length, msgs);
        }
    } catch (err) {
        console.error('Config fetch failed', err);
    }
}

function renderMessageBoxes(count, existingMessages = []) {
    const container = document.getElementById('messageBoxesContainer');
    
    // Save existing values to prevent losing data when changing count
    const currentValues = [];
    for (let i = 0; i < container.children.length; i++) {
        const el = document.getElementById(`message-${i}`);
        if (el) currentValues.push(el.value);
    }

    container.innerHTML = '';
    
    for (let i = 0; i < count; i++) {
        const div = document.createElement('div');
        div.className = 'form-group';
        
        const label = document.createElement('label');
        label.setAttribute('for', `message-${i}`);
        label.innerText = `Message ${i + 1}`;
        
        const textarea = document.createElement('textarea');
        textarea.id = `message-${i}`;
        textarea.rows = 2;
        textarea.placeholder = `Type message ${i + 1} here...`;
        textarea.required = true;
        
        if (existingMessages[i] !== undefined) {
            textarea.value = existingMessages[i];
        } else if (currentValues[i] !== undefined) {
            textarea.value = currentValues[i];
        }
        
        div.appendChild(label);
        div.appendChild(textarea);
        container.appendChild(div);
    }
}
