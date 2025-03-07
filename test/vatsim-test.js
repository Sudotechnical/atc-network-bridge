const fetch = require('node-fetch');
require('dotenv').config();

console.log('Starting VATSIM data test...');

// Function to fetch VATSIM data
async function fetchVatsimData() {
    try {
        const response = await fetch(process.env.VATSIM_API_URL);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching VATSIM data:', error);
        return null;
    }
}

// Function to check controller coverage for an airport
function checkControllerCoverage(data, icao) {
    if (!data || !data.controllers) return null;

    const relevantPositions = data.controllers.filter(controller => {
        return controller.callsign.startsWith(icao) &&
               (controller.callsign.endsWith('TWR') || 
                controller.callsign.endsWith('GND') || 
                controller.callsign.endsWith('DEL') ||
                controller.callsign.endsWith('APP') ||
                controller.callsign.endsWith('DEP'));
    });

    return {
        airport: icao,
        hasControllers: relevantPositions.length > 0,
        controllers: relevantPositions.map(c => ({
            callsign: c.callsign,
            frequency: c.frequency,
            position: c.facility
        }))
    };
}

// Main test function
async function runTest() {
    console.log('Fetching VATSIM data...');
    const data = await fetchVatsimData();
    
    if (!data) {
        console.log('Failed to fetch VATSIM data');
        return;
    }

    console.log('\nVATSIM Network Statistics:');
    console.log('Total Pilots:', data.pilots?.length || 0);
    console.log('Total Controllers:', data.controllers?.length || 0);
    console.log('Total Observers:', data.observers?.length || 0);
    
    // Test coverage for some major airports
    const testAirports = ['KJFK', 'KLAX', 'KBOS', 'KATL'];
    
    console.log('\nChecking controller coverage:');
    testAirports.forEach(airport => {
        const coverage = checkControllerCoverage(data, airport);
        console.log(`\n${airport} Coverage:`);
        console.log('Controllers Present:', coverage.hasControllers);
        if (coverage.controllers.length > 0) {
            console.log('Active Positions:');
            coverage.controllers.forEach(controller => {
                console.log(`- ${controller.callsign} (${controller.frequency})`);
            });
        } else {
            console.log('No active controllers - BeyondATC can take over');
        }
    });
}

// Run the test
runTest().then(() => {
    console.log('\nTest complete.');
    process.exit(0);
}).catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
});
