const EventEmitter = require('events');

class ControllerTransition extends EventEmitter {
    constructor(coverageManager, beyondATCSocket) {
        super();
        this.coverageManager = coverageManager;
        this.beyondATCSocket = beyondATCSocket;
        this.activeTransitions = new Map();
        this.handoffStates = new Map();
    }

    // Called when a VATSIM controller logs on
    async handleVatsimControllerLogin(controller) {
        const { callsign, frequency } = controller;
        const airport = callsign.slice(0, 4);
        
        // Check if BeyondATC is controlling this position
        const command = {
            command: 'check_coverage',
            data: {
                airport,
                position: this.getPositionType(callsign)
            }
        };

        // If BeyondATC is controlling, initiate handoff
        if (await this.isBeyondATCControlling(airport)) {
            await this.initiateHandoffToBeyondATC(controller);
        }
    }

    // Called when a VATSIM controller is about to log off
    async handleVatsimControllerLogoff(controller) {
        const { callsign } = controller;
        const airport = callsign.slice(0, 4);
        
        // Notify BeyondATC to prepare for takeover
        const command = {
            command: 'prepare_takeover',
            data: {
                airport,
                position: this.getPositionType(callsign),
                reason: 'VATSIM controller disconnecting'
            }
        };

        this.beyondATCSocket.send(JSON.stringify(command));
    }

    // Initiate handoff from BeyondATC to VATSIM
    async initiateHandoffToVatsim(controller) {
        const { callsign } = controller;
        const airport = callsign.slice(0, 4);
        
        // 1. Notify BeyondATC to prepare aircraft list
        const prepareCommand = {
            command: 'prepare_handoff',
            data: {
                airport,
                position: this.getPositionType(callsign),
                target: 'VATSIM'
            }
        };
        this.beyondATCSocket.send(JSON.stringify(prepareCommand));

        // 2. Track handoff state
        this.handoffStates.set(callsign, {
            status: 'preparing',
            startTime: Date.now(),
            aircraft: []
        });

        // 3. Wait for aircraft list
        // This will be handled by the message handler
    }

    // Initiate handoff from VATSIM to BeyondATC
    async initiateHandoffToBeyondATC(controller) {
        const { callsign } = controller;
        const airport = callsign.slice(0, 4);
        
        // 1. Get list of aircraft under control
        const vatsimAircraft = await this.getVatsimAircraft(airport);

        // 2. Send aircraft list to BeyondATC
        const handoffCommand = {
            command: 'receive_handoff',
            data: {
                airport,
                position: this.getPositionType(callsign),
                aircraft: vatsimAircraft,
                source: 'VATSIM'
            }
        };
        this.beyondATCSocket.send(JSON.stringify(handoffCommand));

        // 3. Track handoff state
        this.handoffStates.set(callsign, {
            status: 'in_progress',
            startTime: Date.now(),
            aircraft: vatsimAircraft
        });
    }

    // Handle BeyondATC messages during handoff
    handleBeyondATCMessage(message) {
        if (message.type === 'handoff_status') {
            const { callsign, status, aircraft } = message;
            const handoffState = this.handoffStates.get(callsign);
            
            if (handoffState) {
                handoffState.status = status;
                if (aircraft) {
                    handoffState.aircraft = aircraft;
                }

                // Emit status update
                this.emit('handoffUpdate', {
                    callsign,
                    status,
                    aircraft: handoffState.aircraft
                });

                // If handoff is complete, clean up
                if (status === 'complete') {
                    this.handoffStates.delete(callsign);
                }
            }
        }
    }

    // Get position type from callsign
    getPositionType(callsign) {
        const suffix = callsign.slice(-3);
        if (suffix.includes('DEL')) return 'delivery';
        if (suffix.includes('GND')) return 'ground';
        if (suffix.includes('TWR')) return 'tower';
        if (suffix.includes('APP')) return 'approach';
        if (suffix.includes('DEP')) return 'departure';
        if (suffix.includes('CTR')) return 'center';
        return 'unknown';
    }

    // Check if BeyondATC is controlling a position
    async isBeyondATCControlling(airport) {
        return new Promise((resolve) => {
            const command = {
                command: 'check_coverage',
                data: { airport }
            };

            // Set up one-time listener for response
            this.beyondATCSocket.once('message', (response) => {
                const data = JSON.parse(response);
                resolve(data.controlling === true);
            });

            this.beyondATCSocket.send(JSON.stringify(command));
        });
    }

    // Get list of aircraft under VATSIM control
    async getVatsimAircraft(airport) {
        // This would integrate with your VATSIM data service
        // Return format: [{ callsign, squawk, route, ... }]
        return [];
    }

    // Monitor handoff progress
    startHandoffMonitoring() {
        setInterval(() => {
            const now = Date.now();
            
            // Check for stalled handoffs
            for (const [callsign, state] of this.handoffStates) {
                const duration = now - state.startTime;
                
                // If handoff takes more than 5 minutes, mark as failed
                if (duration > 300000 && state.status !== 'complete') {
                    this.emit('handoffFailed', {
                        callsign,
                        reason: 'timeout',
                        duration
                    });
                    this.handoffStates.delete(callsign);
                }
            }
        }, 30000); // Check every 30 seconds
    }
}

module.exports = ControllerTransition;
