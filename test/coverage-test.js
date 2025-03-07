require('dotenv').config();
const CoverageManager = require('../src/services/coverage-manager');

console.log('Starting Coverage Manager test...');

const manager = new CoverageManager();

// Listen for coverage changes
manager.on('coverageChange', (coverage) => {
    console.log('\nCoverage change detected:');
    console.log(`Airport: ${coverage.airport}`);
    console.log(`Controllers Present: ${coverage.hasControllers}`);
    
    if (coverage.controllers.length > 0) {
        console.log('Active Controllers:');
        coverage.controllers.forEach(controller => {
            console.log(`- ${controller.callsign} (${controller.frequency})`);
        });
    } else {
        console.log('No active controllers - BeyondATC will be activated');
    }
});

// Start the manager
manager.start().catch(error => {
    console.error('Failed to start coverage manager:', error);
});

// Keep the script running
console.log('\nMonitoring coverage...');
console.log('Press Ctrl+C to exit');
