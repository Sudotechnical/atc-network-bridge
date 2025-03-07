# ATC Network Bridge (Beta 0.9.0)

A smart bridge between VATSIM and BeyondATC networks that enables GPS-based aircraft handoffs and seamless ATC integration.

## Features

- GPS-based handoff system with 5-mile buffer zones
- Intelligent aircraft tracking and handoff management
- Real-time VATSIM controller position monitoring
- Automatic aircraft return to BeyondATC when VATSIM controllers disconnect
- Robust WebSocket message handling for BeyondATC communication

## Requirements

- Node.js >= 16.0.0
- Windows operating system
- Active BeyondATC installation
- vPilot client for VATSIM

## Installation

1. Clone this repository
2. Copy `.env.example` to `.env` and configure:
```bash
BEYOND_ATC_PORT=41716
VATSIM_API_URL=https://data.vatsim.net/v3/vatsim-data.json
BEYOND_ATC_PTT_KEY=ralt  # Right Alt for BeyondATC
VATSIM_PTT_KEY=lalt     # Left Alt for vPilot
```

3. Install dependencies:
```bash
npm install
```

## Usage

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run start:prod
```

### Build Executable
```bash
npm run build
```
The executable will be created in `dist/atc-network-bridge.exe`

## How It Works

### GPS-Based Handoff System
- Aircraft within 5 statute miles of a VATSIM controller are automatically handed off
- Uses actual VATSIM controller assignments for accurate handoffs
- Maintains connection to BeyondATC for areas without VATSIM coverage

### Message Handling
- Supports all BeyondATC message types:
  - Status messages (AutoRespond, Actions, Facility, etc.)
  - JSON command messages
  - Aircraft position updates
  - Handoff commands

### Testing Mode
Press 't' to enable test mode, then:
- Press '1' to simulate VATSIM controller login
- Press '2' to simulate VATSIM controller logoff

## Known Limitations
- Only supports Windows operating system
- Requires both BeyondATC and vPilot to be running
- 5-mile handoff buffer is fixed (not configurable yet)

## Version History

### 0.9.0-beta.1
- Initial beta release
- Implemented GPS-based handoff system
- Added robust message handling
- Integrated VATSIM controller position tracking
- Added test mode for simulating controller changes
