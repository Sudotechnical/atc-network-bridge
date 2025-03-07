const WebSocket = require('ws');
require('dotenv').config();

console.log('Starting BeyondATC connection test...');
console.log('Attempting to connect to:', process.env.BEYOND_ATC_SERVER);

// Create WebSocket connection with more detailed options
const ws = new WebSocket(process.env.BEYOND_ATC_SERVER, {
    headers: {
        'User-Agent': 'BeyondATC-Bridge/1.0',
        'Origin': 'http://localhost',
        'Accept': '*/*'
    },
    followRedirects: true,
    handshakeTimeout: 5000,
    maxPayload: 65536
});

// Connection opening
ws.on('open', () => {
    console.log('Connected to BeyondATC!');
    
    // Send initial identification
    const identify = {
        command: 'identify',
        data: {
            client: 'External-Bridge',
            version: '1.0.0',
            capabilities: ['voice', 'text', 'position']
        }
    };
    
    console.log('Sending identification:', identify);
    ws.send(JSON.stringify(identify));

    // Request status after connection
    setTimeout(() => {
        const statusRequest = {
            command: 'status_request'
        };
        console.log('Requesting status:', statusRequest);
        ws.send(JSON.stringify(statusRequest));
    }, 1000);
});

// Ping to keep connection alive
setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        console.log('Ping sent');
    }
}, 5000);

// Connection upgrading
ws.on('upgrade', (response) => {
    console.log('Connection upgrade response:', response.headers);
});

// Message handling
ws.on('message', (data) => {
    const message = data.toString();
    console.log('Message received:', message);
    
    // Try to parse as key-value pair
    const kvMatch = message.match(/^([^:]+):\s*(.*)$/);
    if (kvMatch) {
        const [_, key, value] = kvMatch;
        console.log('Parsed message:', { key, value });
        
        // Handle different message types
        switch (key) {
            case 'Facility':
                console.log('Current facility:', value);
                break;
            case 'AutoTune':
                console.log('Auto-tune status:', value);
                break;
            case 'AutoRespond':
                console.log('Auto-respond status:', value);
                break;
            case 'Actions':
                try {
                    const actions = JSON.parse(value);
                    console.log('Available actions:', actions);
                } catch (e) {
                    console.log('Actions:', value);
                }
                break;
            default:
                console.log('Unhandled message type:', key);
        }
    } else {
        // Try to parse as JSON
        try {
            const jsonMessage = JSON.parse(message);
            console.log('Parsed JSON message:', jsonMessage);
        } catch (error) {
            console.log('Unable to parse message');
        }
    }
});

// Error handling
ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    console.error('Error details:', {
        message: error.message,
        code: error.code,
        type: error.type
    });
});

// Connection closing
ws.on('close', (code, reason) => {
    console.log('Connection closed:', {
        code: code,
        reason: reason || 'No reason provided'
    });
});

// Pong response
ws.on('pong', () => {
    console.log('Received pong from server');
});

// Keep the script running for 30 seconds
console.log('Waiting for events...');
setTimeout(() => {
    console.log('Test complete. Closing connection...');
    if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Test complete');
    }
    process.exit(0);
}, 30000);
