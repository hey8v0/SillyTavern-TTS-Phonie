import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('mobile handset keeps a legacy viewport fallback before modern viewport units', async () => {
    const phoneCss = await readFile(new URL('../styles/phone.css', import.meta.url), 'utf8');
    const homeCss = await readFile(new URL('../styles/home.css', import.meta.url), 'utf8');
    const combined = `${phoneCss}\n${homeCss}`;
    assert.match(combined, /height:\s*100vh/);
    assert.match(combined, /@supports\s*\(height:\s*100svh\)/);
    assert.match(combined, /@supports\s*\(height:\s*100dvh\)/);
    assert.match(homeCss, /top:\s*max\(4px,\s*env\(safe-area-inset-top\)\)/);
    assert.match(homeCss, /right:\s*max\(4px,\s*env\(safe-area-inset-right\)\)/);
    assert.match(homeCss, /height:\s*calc\(100vh\s*-\s*8px\)/);
    assert.doesNotMatch(homeCss, /height:\s*auto;\s*\n\s*min-height:\s*0/);
});

test('phone exposes a compact settings launcher and a wand-menu entry', async () => {
    const view = await readFile(new URL('../src/ui/phone-view.js', import.meta.url), 'utf8');
    assert.match(view, /tts_wand_container/);
    assert.match(view, /phonie-wand-menu-item/);
    assert.match(view, /inline-drawer-toggle inline-drawer-header/);
    assert.match(view, /inline-drawer-content/);
    assert.match(view, /extensionsMenuExtensionButton fa-solid fa-mobile-screen-button/);
    assert.doesNotMatch(view, /createElement\('details'\)/);
    assert.match(view, /data-launcher-setting="launcherMode"/);
    assert.match(view, /window\.addEventListener\('pointermove'/);
    assert.match(view, /getOrbDockTarget/);
    assert.match(view, /duration:\s*220/);
});

test('closed phone root collapses its hit area instead of covering SillyTavern', async () => {
    const phoneCss = await readFile(new URL('../styles/phone.css', import.meta.url), 'utf8');
    const view = await readFile(new URL('../src/ui/phone-view.js', import.meta.url), 'utf8');

    assert.match(view, /root\.dataset\.open\s*=\s*'false'/);
    assert.match(view, /document\.body\.append\(root, orb\)/);
    assert.match(view, /this\.\#root\.hidden\s*=\s*!state\.open/);
    assert.match(view, /this\.\#root\.style\.display\s*=\s*state\.open\s*\?\s*'block'\s*:\s*'none'/);
    assert.match(view, /this\.\#root\.inert\s*=\s*!state\.open/);
    assert.match(view, /if\s*\(drag\.moved\)\s*\{/);
    assert.doesNotMatch(view, /drag\.moved\s*&&\s*event\.type\s*===\s*'pointerup'/);
    assert.match(phoneCss, /#phonie-root\[hidden\]\s*\{[^}]*display:\s*none !important;/s);
    assert.match(phoneCss, /#phonie-root\[data-open="false"\]\s*\{[^}]*width:\s*0;[^}]*height:\s*0;/s);
    assert.match(phoneCss, /#phonie-root\[data-open="true"\]\s*\{[^}]*inset:\s*0;[^}]*width:\s*auto;[^}]*height:\s*auto;/s);
    assert.match(phoneCss, /#phonie-root\[data-open="false"\] \.phonie-phone,\s*#phonie-root\[data-open="false"\] \.phonie-scrim\s*\{[^}]*pointer-events:\s*none !important;/s);
});
