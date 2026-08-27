import test from 'node:test';
import assert from 'node:assert/strict';

import { SCREENS } from '../src/core/constants.js';
import { DOCK_ITEMS, HOME_APPS, homeScreenMarkup } from '../src/ui/phone-home.js';

test('home exposes nine unique application tiles across two pages', () => {
    assert.equal(HOME_APPS.length, 9);
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

test('home page rail sits directly above the voice service card', () => {
    const markup = homeScreenMarkup();
    const railIndex = markup.indexOf('phonie-page-rail');
    const serviceIndex = markup.indexOf('phonie-service-card');
    assert.ok(railIndex >= 0);
    assert.ok(serviceIndex > railIndex);
});

test('usage guidance lives in its own second-page application', () => {
    const markup = homeScreenMarkup();
    assert.match(markup, /data-home-page="1"/);
    assert.match(markup, /data-app="guide"/);
    assert.match(markup, /data-action="set-home-page"/);
});
