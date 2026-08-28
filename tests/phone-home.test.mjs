import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SCREENS } from '../src/core/constants.js';
import { DOCK_ITEMS, HOME_APPS, homeScreenMarkup } from '../src/ui/phone-home.js';

const atmosphereCss = readFileSync(new URL('../styles/atmosphere.css', import.meta.url), 'utf8');
const motionRuntime = readFileSync(new URL('../src/ui/phone-motion-runtime.js', import.meta.url), 'utf8');

test('home exposes ten unique application tiles across two pages', () => {
    assert.equal(HOME_APPS.length, 10);
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
        SCREENS.CHARACTER,
        SCREENS.SETTINGS,
    ]);
});

test('home exposes group chat instead of the legacy trace destination', () => {
    const markup = homeScreenMarkup();
    assert.match(markup, /data-app="group"/);
    assert.match(markup, /data-phonie-motion-canvas/);
    assert.doesNotMatch(markup, /phonie-home-rain/);
    assert.doesNotMatch(markup, /data-app="trace"/);
});

test('home polish keeps the compact icon scale and bottom stack', () => {
    assert.match(atmosphereCss, /\.phonie-app-tile__icon\s*\{[\s\S]*?width:\s*50px/);
    assert.match(atmosphereCss, /\.phonie-wallpaper__image\s*\{[\s\S]*?object-fit:\s*cover/);
    assert.match(atmosphereCss, /object-position:\s*center 18%/);
    assert.match(atmosphereCss, /transform:\s*scale\(1\.03\)/);
    assert.match(atmosphereCss, /\.phonie-service-card\s*\{[\s\S]*?position:\s*absolute[\s\S]*?bottom:\s*8px/);
    assert.match(atmosphereCss, /\.phonie-page-rail\s*\{[\s\S]*?position:\s*absolute[\s\S]*?bottom:\s*75px/);
    assert.match(atmosphereCss, /\.phonie-motion-canvas\s*\{/);
});

test('home rain curtain uses the motion runtime and respects accessibility', () => {
    assert.match(motionRuntime, /bezierCurveTo/);
    assert.match(motionRuntime, /pointermove/);
    assert.match(motionRuntime, /prefers-reduced-motion/);
    assert.match(motionRuntime, /requestAnimationFrame/);
    assert.match(motionRuntime, /document\.visibilityState/);
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
