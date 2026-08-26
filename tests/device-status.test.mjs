import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createDeviceStatusSnapshot,
    normalizeBatteryStatus,
    normalizeNetworkStatus,
} from '../src/device/device-status.js';

test('battery status uses a live percentage when the API is available', () => {
    assert.deepEqual(normalizeBatteryStatus({ level: 0.473, charging: true }), {
        available: true,
        percent: 47,
        charging: true,
    });
});

test('battery status is honest when the browser exposes no level', () => {
    assert.deepEqual(normalizeBatteryStatus(null), {
        available: false,
        percent: null,
        charging: false,
    });
});

test('network status maps connectivity without inventing a radio type', () => {
    assert.equal(normalizeNetworkStatus({ online: false }).label, '离线');
    assert.deepEqual(normalizeNetworkStatus({ online: true, connection: { effectiveType: '4g', downlink: 8.2 } }), {
        online: true,
        label: '4G',
        kind: 'cellular',
        downlink: 8.2,
    });
    assert.equal(normalizeNetworkStatus({ online: true, connection: null }).label, '在线');
});

test('snapshot reads navigator online and connection state', () => {
    const snapshot = createDeviceStatusSnapshot({
        navigatorRef: { onLine: true, connection: { type: 'wifi' } },
        battery: { level: 1, charging: false },
    });
    assert.equal(snapshot.network.label, 'Wi-Fi');
    assert.equal(snapshot.battery.percent, 100);
});
