const path = require('path');
require('module-alias/register');

const projectRoot = path.resolve(__dirname, '..');
const resolvePath = (mod) => path.resolve(projectRoot, mod);

const modules = [
    '../../services/orderService.cjs'
];

modules.forEach(mod => {
    try {
        require(mod);
        console.log(`✓ ${mod} found`);
    } catch (e) {
        console.error(`✗ ${mod} MISSING`);
        process.exit(1);
    }
});

const orderService = require('../../services/orderService.cjs');

describe('Smoke Tests', () => {
    describe('Module Imports', () => {
        test('orderService module can be imported', () => {
            expect(orderService).toBeDefined();
        });
    });
});
