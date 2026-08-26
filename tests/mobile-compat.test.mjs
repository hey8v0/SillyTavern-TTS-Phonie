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
    assert.match(homeCss, /top:\s*max\(8px,\s*env\(safe-area-inset-top\)\)/);
    assert.match(homeCss, /right:\s*max\(8px,\s*env\(safe-area-inset-right\)\)/);
    assert.doesNotMatch(homeCss, /height:\s*auto;\s*\n\s*min-height:\s*0/);
});

test('phone exposes a compact settings launcher and a wand-menu entry', async () => {
    const view = await readFile(new URL('../src/ui/phone-view.js', import.meta.url), 'utf8');
    assert.match(view, /tts_wand_container/);
    assert.match(view, /phonie-wand-menu-item/);
    assert.match(view, /createElement\('details'\)/);
    assert.match(view, /data-launcher-setting="launcherMode"/);
});
