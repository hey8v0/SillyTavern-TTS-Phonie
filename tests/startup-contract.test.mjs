import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { APP_VERSION, EXTENSION_BASE, MODULE_ID } from '../src/core/constants.js';

test('Phonie uses a fresh data namespace and a folder-independent asset base', () => {
    assert.equal(MODULE_ID, 'phonie');
    assert.equal(APP_VERSION, '0.13.0');
    assert.match(EXTENSION_BASE, /SillyTavern-TTS-/);
});

test('startup integration does not statically import optional generation APIs', async () => {
    const bridge = await readFile(new URL('../src/integrations/sillytavern.js', import.meta.url), 'utf8');
    assert.doesNotMatch(bridge, /import\s*\{[^}]*generateRaw/s);
    assert.doesNotMatch(bridge, /from ['"]\/scripts\/extensions\/shared\.js['"]/);
    assert.match(bridge, /generateQuietPrompt/);
    assert.match(bridge, /requestPhoneGeneration/);
    assert.match(bridge, /updateBodyPromptInjection/);
    assert.match(bridge, /GENERATION_AFTER_COMMANDS|BODY_PROMPT_PREFIX/);
});

test('entrypoint removes an obsolete interface before mounting Phonie', async () => {
    const entrypoint = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.match(entrypoint, /removeObsoleteRuntime/);
    assert.match(entrypoint, /settings-launcher/);
    assert.match(entrypoint, /createPhonieApp/);
});
