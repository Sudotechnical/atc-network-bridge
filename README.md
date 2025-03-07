# ATC Network Bridge (Beta 0.9.0)

A smart bridge between VATSIM and BeyondATC networks that enables GPS-based aircraft handoffs and seamless ATC integration.

## Features

- GPS-based handoff system with 5-mile buffer zones
- Intelligent aircraft tracking and handoff management
- Real-time VATSIM controller position monitoring
- Automatic aircraft return to BeyondATC when VATSIM controllers disconnect
- Robust WebSocket message handling for BeyondATC communication

## Quick Start

1. Download `atc-network-bridge.exe` from the latest release
2. Create a `.env` file in the same directory with:
   ```env
   BEYOND_ATC_PORT=41716
   VATSIM_API_URL=https://data.vatsim.net/v3/vatsim-data.json
   BEYOND_ATC_PTT_KEY=ralt
   VATSIM_PTT_KEY=lalt
   HANDOFF_BUFFER_MILES=5
   VATSIM_POLL_INTERVAL=15000
   ```
3. Run `atc-network-bridge.exe`

## Detailed Setup

### Prerequisites
- Windows operating system
- BeyondATC client installed and configured
- vPilot client for VATSIM
- Node.js >= 16.0.0 (only for development)

### Configuration Options

#### Environment Variables
- `BEYOND_ATC_PORT`: BeyondATC WebSocket port (default: 41716)
- `VATSIM_API_URL`: VATSIM data endpoint
- `BEYOND_ATC_PTT_KEY`: Push-to-talk key for BeyondATC (default: ralt)
- `VATSIM_PTT_KEY`: Push-to-talk key for vPilot (default: lalt)
- `HANDOFF_BUFFER_MILES`: Buffer zone for handoffs in statute miles (default: 5)
- `VATSIM_POLL_INTERVAL`: VATSIM data polling interval in ms (default: 15000)

### Running the Bridge

1. **Using the Executable**
   ```bash
   # Just double-click atc-network-bridge.exe
   # Or run from command line:
   ./atc-network-bridge.exe
   ```

2. **Development Mode**
   ```bash
   npm install
   npm run dev
   ```

3. **Production Mode**
   ```bash
   npm run start:prod
   ```

## How It Works

### GPS-Based Handoff System
The bridge uses a sophisticated GPS-based system to manage aircraft handoffs:

1. **Controller Detection**
   - Monitors VATSIM for active controllers
   - Updates controller positions every 15 seconds
   - Tracks which aircraft each controller is handling

2. **Handoff Logic**
   - Aircraft within 5 statute miles of a VATSIM controller are automatically handed off
   - Uses actual VATSIM controller assignments for accurate handoffs
   - Maintains connection to BeyondATC for areas without VATSIM coverage

3. **Message Handling**
   - Processes BeyondATC WebSocket messages:
     - Status messages (AutoRespond, Actions, Facility, etc.)
     - JSON command messages
     - Aircraft position updates
     - Handoff commands

### Test Mode
Press 't' to enable test mode, then:
- Press '1': Simulate VATSIM controller login
- Press '2': Simulate VATSIM controller logoff

## Troubleshooting

### Common Issues

1. **Connection Issues**
   - Verify BeyondATC is running and port 41716 is available
   - Check your internet connection for VATSIM data access
   - Ensure no firewall is blocking the connection

2. **Handoff Problems**
   - Verify aircraft is within 5-mile buffer of controller
   - Check if VATSIM controller is actually online
   - Ensure BeyondATC is properly connected

3. **PTT Key Conflicts**
   - Adjust PTT keys in .env file if they conflict
   - Default keys: ralt (BeyondATC), lalt (vPilot)

### Logs
- Check console output for detailed operation logs
- Error messages will show in red
- Controller updates show in real-time

## Development

### Building from Source
```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build executable
npm run build
```

### Contributing
1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## Version History

### 0.9.0-beta.1 (Current)
- Initial beta release
- GPS-based handoff system
- VATSIM integration
- Robust message handling
- Test mode implementation
