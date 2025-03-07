const https = require('https');
require('dotenv').config();

console.log('Starting SAYintentions ACARS connection test...');
console.log(`Using API Key: ${process.env.SAY_INTENTIONS_API_KEY}`);

// Test ACARS connection
const testData = {
    logon: 'TEST1',
    type: 'ping'
};

const options = {
    hostname: 'acars.sayintentions.ai',
    path: '/api',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SAY_INTENTIONS_API_KEY}`
    }
};

const req = https.request(options, (res) => {
    console.log(`Status Code: ${res.statusCode}`);
    
    res.on('data', (data) => {
        console.log('Response:', data.toString());
    });
});

req.on('error', (error) => {
    console.error('Error:', error);
});

req.write(JSON.stringify(testData));
req.end();

// Keep the script running briefly to see the response
setTimeout(() => {
    console.log('Test complete.');
    process.exit(0);
}, 5000);
