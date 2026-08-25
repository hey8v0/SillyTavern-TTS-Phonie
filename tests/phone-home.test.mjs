import test from 'node:test';
import assert from 'node:assert/strict';

import { SCREENS } from '../src/core/constants.js';
import { DOCK_ITEMS, HOME_APPS } from '../src/ui/phone-home.js';

test('home exposes eight unique application tiles', () => {
    assert.equal(HOME_APPS.length, 8);
    assert.equal(new Set(HOME_APPS.map((app) => app.id)).size, HOME_APPS.length);
});

test('every home and dock target is a registered phone screen', () => {
    const screens = new Set(Object.values(SCREENS));
    for (const item of [...HOME_APPS, ...DOCK_ITEMS]) assert.equal(screens.has(item.screen), true, item.screen);
});

test('dock keeps the five primary phone destinations', () => {
    assert.deepEqual(DOCK_ITEMS.map((item) => item.screen), [
        SCREENS.HOME,
        SCREENS.CHAT,
        SCREENS.CALL,
        SCREENS.TRACE,
        SCREENS.SETTINGS,
    ]);
});
