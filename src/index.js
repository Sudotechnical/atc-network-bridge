const WebSocket = require('ws');
const fetch = require('node-fetch');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { app } = require('electron');

// Load environment variables
function loadEnv() {
    let envPath;
    
    if (process.type === 'renderer') {
        // In renderer process
        envPath = path.join(process.cwd(), '.env');
    } else if (process.env.ELECTRON_RUN_AS_NODE) {
        // Running as Node process from Electron
        envPath = path.join(process.cwd(), '.env');
    } else {
        // In packaged app
        const userDataPath = app ? app.getPath('userData') : process.env.APPDATA;
        envPath = path.join(userDataPath, '.env');
    }

    // Check if .env exists, if not copy from default
    if (!fs.existsSync(envPath)) {
        const defaultEnvPath = path.join(process.cwd(), '.env.default');
        if (fs.existsSync(defaultEnvPath)) {
            fs.copyFileSync(defaultEnvPath, envPath);
        }
    }

    // Load environment variables
    dotenv.config({ path: envPath });
}

loadEnv();

class ATCNetworkBridge {
    constructor() {
        this.beyondATCSocket = null;
        this.activeControllers = new Map(); // Map of active VATSIM controllers and their controlled aircraft
        this.handoffBuffer = 5; // Buffer in statute miles
        this.maxControllerRange = parseInt(process.env.MAX_CONTROLLER_RANGE || '400'); // Max range to consider controllers
        this.currentAircraft = null; // Track current aircraft position
        this.currentNetwork = 'BeyondATC'; // Track current network
        this.statusDisplayInterval = null; // Interval for status display
        this.connectionAttempts = 0;
        this.maxRetries = 5;
        this.testMode = false;
        
        // List of known BeyondATC status message prefixes
        this.statusPrefixes = [
            'AutoRespond:',
            'Actions:',
            'Facility:',
            'AutoTune:',
            'Connected:',
            'Status:'
        ];
        
        // GUI status update
        try {
            this.electron = require('electron');
            this.ipcMain = this.electron.ipcMain;
            this.setupGUIEvents();
        } catch (error) {
            console.log('Running without GUI');
            this.ipcMain = null;
        }

        this.pttKey = process.env.PTT_KEY || 'ralt';

        this.setupStatusDisplay();
        this.connectToBeyondATC();
        this.startVatsimPolling();
        this.setupTestCommands();

        console.log(`
ATC Network Bridge v${require('../package.json').version}
----------------------------------------
- BeyondATC: Port ${process.env.BEYOND_ATC_PORT || 41716}
- Mode: VATSIM-based handoff (${this.handoffBuffer} mile buffer)
- PTT Key: ${this.pttKey}
- Polling VATSIM every ${process.env.VATSIM_POLL_INTERVAL/1000 || 15} seconds

Test Commands:
- Press 't' to toggle test mode
- In test mode:
  - Press '1' to simulate VATSIM controller login (KBOS_TWR)
  - Press '2' to simulate VATSIM controller logoff (KBOS_TWR)
  Press Ctrl+C to exit.
        `);

        process.on('SIGINT', () => {
            console.log('\nShutting down...');
            this.cleanup();
        });
    }

    async startVatsimPolling() {
        // Test data for development
        const testData = {
            controllers: [
                {
                    callsign: 'KATL_TWR',
                    frequency: '118.300',
                    latitude: 33.6367,
                    longitude: -84.4281,
                    rating: 7
                },
                {
                    callsign: 'KATL_APP',
                    frequency: '127.900',
                    latitude: 33.6367,
                    longitude: -84.4281,
                    rating: 7
                }
            ],
            pilots: [
                {
                    callsign: process.env.CURRENT_AIRCRAFT_CALLSIGN || 'N9632J',
                    latitude: 33.6514,
                    longitude: -84.4244,
                    altitude: 1000,
                    groundspeed: 0,
                    heading: 90
                }
            ]
        };

        const pollVatsim = async () => {
            try {
                console.log('\nFetching VATSIM data...');
                const response = await fetch('https://data.vatsim.net/v3/vatsim-data.json', {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'ATC-Network-Bridge/0.9.0-beta.1'
                    },
                    timeout: 5000
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();

                // Validate data structure
                if (!data || !Array.isArray(data.controllers) || !Array.isArray(data.pilots)) {
                    console.warn('Invalid VATSIM data format, using test data');
                    await this.processVatsimData(testData);
                    return;
                }

                // Debug VATSIM data
                const atlControllers = data.controllers.filter(c => 
                    c.callsign && (
                        c.callsign.includes('KATL') || 
                        c.callsign.includes('ATL_')
                    )
                );
                
                console.log('\nVATSIM Data Summary:');
                console.log(`Total Controllers: ${data.controllers.length}`);
                console.log(`Total Pilots: ${data.pilots.length}`);
                if (atlControllers.length > 0) {
                    console.log('\nATL Controllers:');
                    atlControllers.forEach(c => {
                        console.log(`- ${c.callsign} on ${c.frequency}`);
                    });
                } else {
                    console.log('No ATL controllers found, using test data');
                    await this.processVatsimData(testData);
                    return;
                }

                // Look for our aircraft
                const ourAircraft = data.pilots.find(p => p.callsign === process.env.CURRENT_AIRCRAFT_CALLSIGN);
                if (ourAircraft) {
                    console.log(`\nFound our aircraft: ${ourAircraft.callsign}`);
                    console.log(`Position: ${ourAircraft.latitude.toFixed(4)}, ${ourAircraft.longitude.toFixed(4)}`);
                    
                    // Check distance to ATL
                    const atlDistance = this.calculateDistance(
                        ourAircraft.latitude,
                        ourAircraft.longitude,
                        33.6367, // ATL coordinates
                        -84.4281
                    );
                    console.log(`Distance to ATL: ${atlDistance.toFixed(1)} SM`);
                }
                
                await this.processVatsimData(data);
            } catch (error) {
                console.error('Error fetching VATSIM data, using test data:', error.message);
                await this.processVatsimData(testData);
            }
        };

        // Initial poll
        await pollVatsim();
        // Poll every 15 seconds
        setInterval(pollVatsim, parseInt(process.env.VATSIM_POLL_INTERVAL) || 15000);
    }

    async processVatsimData(data) {
        // Update controller information
        const newControllers = new Map();
        let nearestController = null;
        
        // Update our aircraft position first
        const ourAircraft = data.pilots.find(p => p.callsign === process.env.CURRENT_AIRCRAFT_CALLSIGN);
        if (ourAircraft) {
            this.currentAircraft = {
                callsign: ourAircraft.callsign,
                latitude: parseFloat(ourAircraft.latitude),
                longitude: parseFloat(ourAircraft.longitude),
                altitude: parseFloat(ourAircraft.altitude),
                groundspeed: parseFloat(ourAircraft.groundspeed),
                heading: parseFloat(ourAircraft.heading)
            };

            // Calculate distance to ATL
            const atlDistance = this.calculateDistance(
                this.currentAircraft.latitude,
                this.currentAircraft.longitude,
                33.6367, // ATL coordinates
                -84.4281
            );

            // Log aircraft status
            console.log('\nAircraft Status:');
            console.log(`- Callsign: ${this.currentAircraft.callsign}`);
            console.log(`- Position: ${this.currentAircraft.latitude.toFixed(4)}, ${this.currentAircraft.longitude.toFixed(4)}`);
            console.log(`- Distance to ATL: ${atlDistance.toFixed(1)} SM`);

            // First check for ATL controllers since we're tracking ATL position
            if (atlDistance <= 50) { // Within ATL airspace
                const atlControllers = data.controllers
                    .filter(c => c.callsign && c.frequency && (
                        c.callsign.includes('KATL') || 
                        c.callsign.includes('ATL_') ||
                        (c.callsign.includes('ATL') && !c.callsign.includes('SEAT'))
                    ))
                    .map(c => ({
                        ...c,
                        distance: atlDistance,
                        isAtlController: true
                    }));

                if (atlControllers.length > 0) {
                    // Sort by priority: TWR -> APP -> CTR
                    const priorityOrder = { 'TWR': 1, 'APP': 2, 'CTR': 3 };
                    atlControllers.sort((a, b) => {
                        const aType = Object.keys(priorityOrder).find(t => a.callsign.includes(t)) || 'OTHER';
                        const bType = Object.keys(priorityOrder).find(t => b.callsign.includes(t)) || 'OTHER';
                        return (priorityOrder[aType] || 99) - (priorityOrder[bType] || 99);
                    });

                    // Use the highest priority ATL controller
                    nearestController = atlControllers[0];
                    console.log('\nATL Controller Selected:');
                    console.log(`- ${nearestController.callsign} on ${nearestController.frequency}`);
                    console.log(`- Type: ATL (${nearestController.callsign.includes('TWR') ? 'Tower' : nearestController.callsign.includes('APP') ? 'Approach' : 'Center'})`);
                    console.log(`- Distance: ${nearestController.distance.toFixed(1)} SM`);
                }
            }

            // If no ATL controller found or we're outside ATL airspace, look for other controllers
            if (!nearestController) {
                const otherControllers = data.controllers
                    .filter(c => c.callsign && c.frequency && c.latitude && c.longitude)
                    .map(c => ({
                        ...c,
                        distance: this.calculateDistance(
                            this.currentAircraft.latitude,
                            this.currentAircraft.longitude,
                            parseFloat(c.latitude),
                            parseFloat(c.longitude)
                        ),
                        isAtlController: false
                    }))
                    .sort((a, b) => a.distance - b.distance);

                nearestController = otherControllers[0];
            }
        }

        // Add controllers to active list
        if (nearestController) {
            const maxRange = nearestController.isAtlController ? 50 : this.maxControllerRange;
            
            // Always add nearest controller
            newControllers.set(nearestController.callsign, {
                ...nearestController,
                lastUpdate: Date.now()
            });

            // Show controller status
            console.log('\nNearest Controller:');
            console.log(`- ${nearestController.callsign} on ${nearestController.frequency}`);
            console.log(`- Distance: ${nearestController.distance.toFixed(1)} SM`);
            console.log(`- Type: ${nearestController.isAtlController ? 'ATL' : 'Other'}`);
            console.log(`- Range: ${maxRange} SM`);
            console.log(`- Status: ${nearestController.distance <= maxRange ? 'In Range' : 'Out of Range'}`);

            // Handle network switching
            if (nearestController.distance <= maxRange) {
                if (this.currentNetwork !== 'VATSIM') {
                    console.log(`\nSwitching to VATSIM - ${nearestController.callsign} is in range`);
                    await this.handoffToVatsim(this.currentAircraft, nearestController);
                }
            } else if (nearestController.distance > maxRange + this.handoffBuffer) {
                if (this.currentNetwork !== 'BeyondATC') {
                    console.log(`\nSwitching to BeyondATC - ${nearestController.callsign} out of range`);
                    await this.handoffToBeyondATC(this.currentAircraft);
                }
            }
        } else if (this.currentNetwork === 'VATSIM') {
            console.log('\nSwitching to BeyondATC - No controllers found');
            await this.handoffToBeyondATC(this.currentAircraft);
        }

        // Update active controllers
        this.activeControllers = newControllers;
    }

    async handoffToVatsim(aircraft, controller) {
        if (!aircraft || !controller) return;

        // First notify BeyondATC about the handoff
        const command = {
            command: 'handoff_to_vatsim',
            data: {
                aircraft: {
                    callsign: aircraft.callsign,
                    controller: controller.callsign,
                    frequency: controller.frequency,
                    position: {
                        latitude: aircraft.latitude,
                        longitude: aircraft.longitude,
                        altitude: aircraft.altitude,
                        heading: aircraft.heading,
                        groundspeed: aircraft.groundspeed
                    }
                }
            }
        };

        // Send handoff command to BeyondATC
        if (this.beyondATCSocket && this.beyondATCSocket.readyState === WebSocket.OPEN) {
            try {
                this.beyondATCSocket.send(JSON.stringify(command));
                console.log('\nHandoff command sent to BeyondATC');
                
                // Update network status
                this.currentNetwork = 'VATSIM';
                console.log(`Switched to VATSIM - Connected to ${controller.callsign} on ${controller.frequency}`);
                
                // Configure PTT for VATSIM
                const pttConfig = {
                    command: 'configure_ptt',
                    data: {
                        key: this.pttKey,
                        network: 'VATSIM'
                    }
                };
                this.beyondATCSocket.send(JSON.stringify(pttConfig));
                
                this.updateStatusDisplay();
            } catch (error) {
                console.error('Failed to send handoff command:', error);
            }
        } else {
            console.warn('BeyondATC WebSocket not connected, handoff may be incomplete');
        }
    }

    async handoffToBeyondATC(aircraft) {
        if (!aircraft) return;

        // Prepare handoff command
        const command = {
            command: 'handoff_to_beyondatc',
            data: {
                aircraft: {
                    callsign: aircraft.callsign,
                    position: {
                        latitude: aircraft.latitude,
                        longitude: aircraft.longitude,
                        altitude: aircraft.altitude,
                        heading: aircraft.heading,
                        groundspeed: aircraft.groundspeed
                    }
                }
            }
        };

        // Send handoff command to BeyondATC
        if (this.beyondATCSocket && this.beyondATCSocket.readyState === WebSocket.OPEN) {
            try {
                this.beyondATCSocket.send(JSON.stringify(command));
                console.log('\nHandoff command sent to BeyondATC');
                
                // Update network status
                this.currentNetwork = 'BeyondATC';
                console.log('Switched to BeyondATC network');
                
                // Configure PTT for BeyondATC
                const pttConfig = {
                    command: 'configure_ptt',
                    data: {
                        key: this.pttKey,
                        network: 'BeyondATC'
                    }
                };
                this.beyondATCSocket.send(JSON.stringify(pttConfig));
                
                this.updateStatusDisplay();
            } catch (error) {
                console.error('Failed to send handoff command:', error);
            }
        } else {
            console.warn('BeyondATC WebSocket not connected, handoff may be incomplete');
        }
    }

    async returnAircraftToBeyondATC(aircraftList) {
        if (!aircraftList || aircraftList.length === 0) return;

        // Prepare return command with aircraft positions
        const command = {
            command: 'return_aircraft',
            data: {
                aircraft: aircraftList.map(aircraft => ({
                    callsign: aircraft.callsign,
                    position: {
                        latitude: aircraft.latitude,
                        longitude: aircraft.longitude,
                        altitude: aircraft.altitude,
                        heading: aircraft.heading,
                        groundspeed: aircraft.groundspeed
                    }
                }))
            }
        };

        // Send return command to BeyondATC
        if (this.beyondATCSocket && this.beyondATCSocket.readyState === WebSocket.OPEN) {
            try {
                this.beyondATCSocket.send(JSON.stringify(command));
                console.log(`\nReturned ${aircraftList.length} aircraft to BeyondATC control`);
                this.updateStatusDisplay();
            } catch (error) {
                console.error('Failed to send return aircraft command:', error);
            }
        } else {
            console.warn('BeyondATC WebSocket not connected, aircraft return may be incomplete');
        }
    }

    setupStatusDisplay() {
        // Clear any existing interval
        if (this.statusDisplayInterval) {
            clearInterval(this.statusDisplayInterval);
        }

        // Update status display every second
        this.statusDisplayInterval = setInterval(() => {
            this.updateStatusDisplay();
        }, 1000);
    }

    updateStatusDisplay() {
        console.log(`Current Network: ${this.currentNetwork}${this.activeControllers.size > 0 ? ` (${this.activeControllers.size} controllers)` : ''} | Aircraft: ${this.currentAircraft?.callsign || 'N/A'}`);
        
        // Update GUI if available
        if (this.ipcMain) {
            const windows = this.electron.BrowserWindow.getAllWindows();
            for (const win of windows) {
                win.webContents.send('network-status', {
                    network: this.currentNetwork,
                    aircraft: this.currentAircraft?.callsign,
                    pttKey: this.pttKey
                });
            }
        }
    }

    setupGUIEvents() {
        if (!this.ipcMain) return;

        // Listen for settings updates
        this.ipcMain.on('get-status', (event) => {
            event.reply('network-status', {
                network: this.currentNetwork,
                aircraft: this.currentAircraft?.callsign,
                pttKey: this.pttKey
            });
        });

        // Handle reconnect request
        this.ipcMain.on('reconnect', async (event) => {
            try {
                console.log('\nReconnecting to networks...');
                
                // Close existing connections
                if (this.beyondATCSocket) {
                    this.beyondATCSocket.close();
                    this.beyondATCSocket = null;
                }

                // Reset state
                this.currentNetwork = 'BeyondATC';
                this.activeControllers.clear();
                this.pttKey = process.env.PTT_KEY || 'ralt';
                
                // Reconnect
                await this.connectToBeyondATC();
                await this.fetchVatsimData();
                
                event.reply('reconnect-status', { 
                    success: true, 
                    message: 'Successfully reconnected' 
                });
                
                this.updateStatusDisplay();
            } catch (error) {
                event.reply('reconnect-status', { 
                    success: false, 
                    message: 'Failed to reconnect: ' + error.message 
                });
            }
        });
    }

    findNearestController(aircraft) {
        if (!aircraft || this.activeControllers.size === 0) return null;

        let nearest = null;
        let minDistance = Infinity;

        for (const [_, controller] of this.activeControllers) {
            const distance = this.calculateDistance(
                aircraft.latitude,
                aircraft.longitude,
                parseFloat(controller.latitude),
                parseFloat(controller.longitude)
            );

            if (distance < minDistance) {
                minDistance = distance;
                nearest = controller;
            }
        }

        return nearest;
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 3440.065; // Earth's radius in nautical miles
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c * 1.15078; // Convert to statute miles
    }

    isStatusMessage(message) {
        return this.statusPrefixes.some(prefix => message.includes(prefix));
    }

    handleBeyondATCMessage(data) {
        const message = data.toString().trim();

        // Check if it's a status message
        if (this.statusPrefixes.some(prefix => message.includes(prefix))) {
            // Only log important status changes
            if (message.includes('Connected:') || message.includes('Status:')) {
                console.log('\nBeyondATC status:', message);
            }
            return;
        }

        // Try to parse as JSON for command messages
        try {
            const jsonMessage = JSON.parse(message);
            
            // Handle PTT state changes
            if (jsonMessage.command === 'ptt_state') {
                const isPttActive = jsonMessage.data.active;
                
                // Only process PTT if we're on the correct network
                if (this.currentNetwork === 'BeyondATC' && isPttActive) {
                    console.log('\nPTT active on BeyondATC');
                } else if (this.currentNetwork === 'VATSIM' && !isPttActive) {
                    // Forward PTT to VATSIM
                    console.log('\nPTT forwarded to VATSIM');
                }
            }
            
            // Handle other command messages
            if (jsonMessage.command === 'position_update') {
                this.handlePositionUpdate(jsonMessage.data);
            }
        } catch (error) {
            // If it's not JSON and not a status message, then log for debugging
            if (process.env.DEBUG) {
                console.log('\nRaw message from BeyondATC:', message);
            }
        }
    }

    async connectToBeyondATC() {
        const port = process.env.BEYOND_ATC_PORT || 41716;
        let attempt = 1;
        const maxAttempts = 5;

        while (attempt <= maxAttempts) {
            try {
                console.log(`\nAttempting to connect to BeyondATC on port ${port} (Attempt ${attempt}/${maxAttempts})`);
                
                this.beyondATCSocket = new WebSocket(`ws://localhost:${port}`);
                
                this.beyondATCSocket.on('open', () => {
                    console.log('\nConnected to BeyondATC');
                    
                    // Configure initial PTT state
                    const config = {
                        command: 'configure_ptt',
                        data: {
                            key: this.pttKey,
                            network: this.currentNetwork
                        }
                    };
                    
                    this.beyondATCSocket.send(JSON.stringify(config));
                });

                this.beyondATCSocket.on('message', (data) => {
                    this.handleBeyondATCMessage(data);
                });

                this.beyondATCSocket.on('close', () => {
                    console.log('\nDisconnected from BeyondATC');
                    setTimeout(() => this.connectToBeyondATC(), 5000);
                });

                break;
            } catch (error) {
                console.error(`Failed to connect (Attempt ${attempt}/${maxAttempts}):`, error.message);
                if (attempt === maxAttempts) {
                    console.error('Max connection attempts reached. Please check if BeyondATC is running.');
                } else {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                attempt++;
            }
        }
    }

    setupTestCommands() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('\nTest Commands:');
        console.log('  1: Toggle test mode (use test data)');
        console.log('  2: Show active controllers');
        console.log('  3: Show current aircraft position');
        console.log('  4: Force VATSIM data refresh');
        console.log('  5: Toggle network (BeyondATC/VATSIM)');

        rl.on('line', async (input) => {
            switch (input.trim()) {
                case '1':
                    this.testMode = !this.testMode;
                    console.log(`Test mode ${this.testMode ? 'enabled' : 'disabled'}`);
                    break;
                case '2':
                    console.log('\nActive Controllers:');
                    for (const [callsign, controller] of this.activeControllers) {
                        const distanceStr = controller.distance ? ` (${controller.distance.toFixed(1)} SM)` : '';
                        console.log(`- ${callsign} on ${controller.frequency}${distanceStr}`);
                    }
                    break;
                case '3':
                    if (this.currentAircraft) {
                        console.log('\nCurrent Aircraft:');
                        console.log(`Callsign: ${this.currentAircraft.callsign}`);
                        console.log(`Position: ${this.currentAircraft.latitude.toFixed(4)}, ${this.currentAircraft.longitude.toFixed(4)}`);
                        console.log(`Altitude: ${this.currentAircraft.altitude} ft`);
                        console.log(`Groundspeed: ${this.currentAircraft.groundspeed} kts`);
                        console.log(`Heading: ${this.currentAircraft.heading}°`);

                        // Calculate distance to ATL
                        const atlDistance = this.calculateDistance(
                            this.currentAircraft.latitude,
                            this.currentAircraft.longitude,
                            33.6367, // ATL coordinates
                            -84.4281
                        );
                        console.log(`Distance to ATL: ${atlDistance.toFixed(1)} SM`);
                    } else {
                        console.log('\nNo aircraft position available');
                    }
                    break;
                case '4':
                    console.log('\nForcing VATSIM data refresh...');
                    await this.processVatsimData(this.testMode ? this.testData : await this.fetchVatsimData());
                    break;
                case '5':
                    this.currentNetwork = this.currentNetwork === 'BeyondATC' ? 'VATSIM' : 'BeyondATC';
                    console.log(`\nSwitched to ${this.currentNetwork}`);
                    break;
                default:
                    break;
            }
        });
    }

    cleanup() {
        if (this.statusDisplayInterval) {
            clearInterval(this.statusDisplayInterval);
        }
        if (this.beyondATCSocket) {
            this.beyondATCSocket.close();
        }
        process.exit(0);
    }
}

// Error handling
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Keep running despite errors
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Keep running despite errors
});

// Start bridge
async function startBridge() {
    try {
        const bridge = new ATCNetworkBridge();
        await bridge.start();
        
        console.log('Bridge started successfully');
        console.log('Current Aircraft:', process.env.CURRENT_AIRCRAFT_CALLSIGN);
        console.log('PTT Key:', process.env.PTT_KEY);
        console.log('BeyondATC Port:', process.env.BEYOND_ATC_PORT);
    } catch (error) {
        console.error('Failed to start bridge:', error);
    }
}

startBridge();
