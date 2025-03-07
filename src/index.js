const WebSocket = require('ws');
const fetch = require('node-fetch');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Load environment variables with fallback to default
try {
    if (fs.existsSync(path.join(process.cwd(), '.env'))) {
        require('dotenv').config();
    } else {
        require('dotenv').config({ path: path.join(__dirname, '../.env.default') });
        console.log('\nUsing default configuration. Create a .env file to customize settings.');
    }
} catch (error) {
    console.error('\nError loading configuration:', error.message);
    process.exit(1);
}

class ATCNetworkBridge {
    constructor() {
        this.beyondATCSocket = null;
        this.activeControllers = new Map(); // Map of active VATSIM controllers and their controlled aircraft
        this.handoffBuffer = parseInt(process.env.HANDOFF_BUFFER_MILES) || 5; // Buffer in statute miles
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
        
        this.connectToBeyondATC();
        this.startVatsimPolling();
        this.setupTestCommands();

        console.log(`
ATC Network Bridge v${require('../package.json').version}
----------------------------------------
- BeyondATC: Port ${process.env.BEYOND_ATC_PORT || 41716}
- Mode: VATSIM-based handoff (${this.handoffBuffer} mile buffer)
- PTT Keys: 
  • BeyondATC: ${process.env.BEYOND_ATC_PTT_KEY || 'ralt'}
  • VATSIM: ${process.env.VATSIM_PTT_KEY || 'lalt'}
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
            if (this.beyondATCSocket) {
                this.beyondATCSocket.close();
            }
            process.exit(0);
        });
    }

    async startVatsimPolling() {
        const pollVatsim = async () => {
            try {
                const response = await fetch(process.env.VATSIM_API_URL);
                const data = await response.json();
                await this.processVatsimData(data);
            } catch (error) {
                console.error('Error fetching VATSIM data:', error.message);
            }
        };

        // Initial poll
        await pollVatsim();
        // Poll every 15 seconds
        setInterval(pollVatsim, process.env.VATSIM_POLL_INTERVAL || 15000);
    }

    async processVatsimData(data) {
        // Update controller information
        const newControllers = new Map();
        
        // Process controllers and their controlled aircraft
        for (const controller of data.controllers) {
            const { callsign, frequency, latitude, longitude } = controller;
            
            // Get list of aircraft this controller is actively controlling
            const controlledAircraft = data.pilots
                .filter(pilot => pilot.last_controller_id === controller.cid)
                .map(pilot => pilot.callsign);
            
            newControllers.set(callsign, {
                ...controller,
                controlledAircraft,
                lastUpdate: Date.now()
            });

            // Log new controllers
            if (!this.activeControllers.has(callsign)) {
                console.log(`\nNew VATSIM controller online: ${callsign}`);
                console.log(`Controlling ${controlledAircraft.length} aircraft`);
            }
        }

        // Handle controllers that went offline
        for (const [callsign, controller] of this.activeControllers) {
            if (!newControllers.has(callsign)) {
                console.log(`\nVATSIM controller offline: ${callsign}`);
                // Return their aircraft to BeyondATC
                await this.returnAircraftToBeyondATC(controller.controlledAircraft);
            }
        }

        this.activeControllers = newControllers;

        // Process all aircraft
        for (const aircraft of data.pilots) {
            await this.processAircraft(aircraft, data.controllers);
        }
    }

    async processAircraft(aircraft, controllers) {
        const { callsign, latitude, longitude, altitude, heading, groundspeed } = aircraft;
        
        // Find the nearest controller who should handle this aircraft
        const nearestController = this.findNearestController(aircraft, controllers);
        
        if (nearestController) {
            const distance = this.calculateDistance(
                latitude,
                longitude,
                nearestController.latitude,
                nearestController.longitude
            );

            // If aircraft is within handoff buffer of a controller
            if (distance <= this.handoffBuffer) {
                // Check if this is a new handoff
                const controller = this.activeControllers.get(nearestController.callsign);
                if (controller && !controller.controlledAircraft.includes(callsign)) {
                    await this.handoffToVatsim(aircraft, nearestController);
                }
            }
        } else {
            // No nearby VATSIM controller, ensure BeyondATC has control
            await this.handoffToBeyondATC(aircraft);
        }
    }

    findNearestController(aircraft, controllers) {
        let nearestController = null;
        let minDistance = Infinity;

        for (const controller of controllers) {
            // Skip controllers without position
            if (!controller.latitude || !controller.longitude) continue;

            const distance = this.calculateDistance(
                aircraft.latitude,
                aircraft.longitude,
                controller.latitude,
                controller.longitude
            );

            // Update nearest controller if this one is closer
            if (distance < minDistance) {
                minDistance = distance;
                nearestController = controller;
            }
        }

        return nearestController;
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        // Convert nautical miles to statute miles
        const R = 3440.065 * 1.15078; // Earth radius in statute miles
        const dLat = this.toRad(lat2 - lat1);
        const dLon = this.toRad(lon2 - lon1);
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    toRad(degrees) {
        return degrees * Math.PI / 180;
    }

    async handoffToVatsim(aircraft, controller) {
        console.log(`\nHandoff ${aircraft.callsign} to VATSIM controller ${controller.callsign}`);
        
        const command = {
            command: 'handoff_to_vatsim',
            data: {
                aircraft: {
                    callsign: aircraft.callsign,
                    position: {
                        latitude: aircraft.latitude,
                        longitude: aircraft.longitude,
                        altitude: aircraft.altitude,
                        heading: aircraft.heading,
                        groundspeed: aircraft.groundspeed
                    },
                    controller: {
                        callsign: controller.callsign,
                        frequency: controller.frequency
                    }
                }
            }
        };
        
        if (this.beyondATCSocket && this.beyondATCSocket.readyState === WebSocket.OPEN) {
            this.beyondATCSocket.send(JSON.stringify(command));
        }
    }

    async handoffToBeyondATC(aircraft) {
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
        
        if (this.beyondATCSocket && this.beyondATCSocket.readyState === WebSocket.OPEN) {
            this.beyondATCSocket.send(JSON.stringify(command));
        }
    }

    async returnAircraftToBeyondATC(aircraftList) {
        console.log(`\nReturning ${aircraftList.length} aircraft to BeyondATC control`);
        const command = {
            command: 'return_aircraft',
            data: {
                aircraft: aircraftList
            }
        };
        
        if (this.beyondATCSocket && this.beyondATCSocket.readyState === WebSocket.OPEN) {
            this.beyondATCSocket.send(JSON.stringify(command));
        }
    }

    isStatusMessage(message) {
        return this.statusPrefixes.some(prefix => message.startsWith(prefix));
    }

    connectToBeyondATC() {
        if (this.connectionAttempts >= this.maxRetries) {
            console.log('\nMax connection attempts reached. Please ensure BeyondATC is running.');
            return;
        }

        const port = process.env.BEYOND_ATC_PORT || 41716;
        console.log(`\nAttempting to connect to BeyondATC on port ${port} (Attempt ${this.connectionAttempts + 1}/${this.maxRetries})`);

        try {
            this.beyondATCSocket = new WebSocket(`ws://localhost:${port}`);

            this.beyondATCSocket.on('open', () => {
                console.log('\nConnected to BeyondATC');
                this.connectionAttempts = 0;
            });

            this.beyondATCSocket.on('message', (data) => {
                const message = data.toString().trim();
                
                // Check if it's a status message
                if (this.isStatusMessage(message)) {
                    // Only log important status changes
                    if (message.includes('Connected:') || message.includes('Status:')) {
                        console.log('\nBeyondATC status:', message);
                    }
                    return;
                }

                // Try to parse as JSON for command messages
                try {
                    const jsonMessage = JSON.parse(message);
                    this.handleBeyondATCMessage(jsonMessage);
                } catch (error) {
                    // If it's not JSON and not a status message, then log the error
                    console.error('\nUnexpected message format from BeyondATC:', message);
                }
            });

            this.beyondATCSocket.on('error', (error) => {
                console.error('\nBeyondATC connection error:', error.message);
            });

            this.beyondATCSocket.on('close', () => {
                console.log('\nBeyondATC connection closed');
                this.connectionAttempts++;
                
                if (this.activeSystem === 'beyondatc') {
                    const retryDelay = Math.min(1000 * Math.pow(2, this.connectionAttempts), 30000);
                    console.log(`Retrying in ${retryDelay/1000} seconds...`);
                    setTimeout(() => this.connectToBeyondATC(), retryDelay);
                } else {
                    console.log('Not reconnecting since VATSIM is active');
                }
            });
        } catch (error) {
            console.error('\nError creating WebSocket:', error.message);
            this.connectionAttempts++;
            setTimeout(() => this.connectToBeyondATC(), 5000);
        }
    }

    handleBeyondATCMessage(message) {
        console.log('\nBeyondATC message:', message);
        switch (message.type) {
            case 'handoff_complete':
                console.log(`Handoff completed for ${message.airport}`);
                break;
            case 'takeover_complete':
                console.log(`BeyondATC now controlling ${message.airport}`);
                break;
            default:
                console.log('Unhandled message type:', message.type);
        }
    }

    setupTestCommands() {
        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);

        process.stdin.on('keypress', (str, key) => {
            if (key.ctrl && key.name === 'c') {
                console.log('\nShutting down...');
                process.exit();
            }

            if (key.name === 't') {
                this.testMode = !this.testMode;
                console.log(`\nTest mode ${this.testMode ? 'enabled' : 'disabled'}`);
                if (this.testMode) {
                    console.log('Available commands:');
                    console.log('1 - Simulate VATSIM controller login (connects VATSIM, disconnects BeyondATC)');
                    console.log('2 - Simulate VATSIM controller logoff (disconnects VATSIM, connects BeyondATC)');
                }
                return;
            }

            if (!this.testMode) return;

            switch (key.name) {
                case '1':
                    console.log('\nSimulating VATSIM controller login (KBOS_TWR)');
                    // this.handleVatsimControllerLogin('KBOS_TWR', { frequency: '118.850' });
                    console.log('Status: VATSIM active, BeyondATC disconnected');
                    break;
                case '2':
                    console.log('\nSimulating VATSIM controller logoff (KBOS_TWR)');
                    // this.handleVatsimControllerLogoff('KBOS_TWR', { frequency: '118.850' });
                    console.log('Status: VATSIM inactive, BeyondATC connected');
                    break;
            }
        });
    }
}

// Create and start the bridge
console.log('Starting ATC Network Bridge...');
const bridge = new ATCNetworkBridge();
