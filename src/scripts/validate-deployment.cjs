const { validateHalifaxTime } = require('../utils/time');
const { MetricRecorder } = require('../services/MetricService');

async function validateDeployment() {
    try {
        // 1. Validate timezone
        validateHalifaxTime();
        console.log('✅ Timezone validation passed');

        // 2. Validate metric format
        const recorder = new MetricRecorder();
        const testMetric = {
            type: 'pass.purchase',
            value: 100.123
        };
        const unified = recorder.createUnifiedPayload(testMetric);
        
        // Verify payload structure
        const required = ['type', 'value', 'timestamp', 'source'];
        const missing = required.filter(key => !(key in unified));
        
        if (missing.length > 0) {
            throw new Error(`Missing required fields: ${missing.join(', ')}`);
        }
        
        // Verify value precision
        if (!Number.isInteger(unified.value * 100)) {
            throw new Error('Value precision exceeds 2 decimal places');
        }

        console.log('✅ Metric format validation passed');
        console.log('✅ All validation checks passed');
        
    } catch (error) {
        console.error('❌ Validation failed:', error.message);
        process.exit(1);
    }
}

validateDeployment(); 