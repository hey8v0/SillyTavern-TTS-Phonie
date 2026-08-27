import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { SCREENS } from '../src/core/constants.js';
import { promptEntryMarkup, systemSettingsScreensMarkup } from '../src/ui/system-settings.js';

test('system app markup exposes real model and prompt controls', () => {
    const markup = systemSettingsScreensMarkup();
    assert.match(markup, new RegExp(`data-screen="${SCREENS.MODEL}"`));
    assert.match(markup, new RegExp(`data-screen="${SCREENS.PROMPTS}"`));
    assert.match(markup, /data-setting="generationMode"/);
    assert.match(markup, /data-setting="generationProfileId"/);
    assert.match(markup, /data-setting="customOpenAIEndpoint"/);
    assert.match(markup, /data-setting="customOpenAIModel"/);
    assert.match(markup, /data-action="refresh-custom-models"/);
    assert.match(markup, /data-action="save-custom-key"/);
    assert.doesNotMatch(markup, /data-setting="customOpenAIKey"/);
    assert.match(markup, /data-prompt-preset-field="insertionDepth"/);
    assert.match(markup, /data-setting="promptWorkflowKind"/);
    assert.match(markup, /data-setting="bodyPromptEnabled"/);
    assert.match(markup, /data-role="prompt-preset-library"/);
    assert.match(markup, /data-action="save-prompt-preset"/);
    assert.match(markup, /data-action="export-prompt-library"/);
    assert.match(markup, /data-action="import-prompt-presets"/);
    assert.match(markup, /\{\{角色\}\}/);
});

test('voice app exposes the independent Phonie provider center', async () => {
    const home = await readFile(new URL('../src/ui/phone-home.js', import.meta.url), 'utf8');
    const view = await readFile(new URL('../src/ui/phone-view.js', import.meta.url), 'utf8');
    assert.match(home, /data-role="tts-provider-list"/);
    assert.match(home, /data-role="tts-provider-editor"/);
    assert.match(home, /data-screen="\$\{SCREENS\.PROVIDER\}"/);
    assert.match(home, /data-role="character-directory"/);
    assert.match(view, /data-action="set-tts-provider"/);
    assert.match(view, /data-action="open-tts-provider"/);
    assert.match(view, /data-provider-tone/);
    assert.match(view, /data-role="dynamic-island-label"/);
    assert.match(view, /生成中/);
    assert.match(view, /通话中/);
    assert.match(view, /data-action="check-tts-provider"/);
    assert.match(view, /data-action="cycle-theme"/);
    assert.match(view, /data-action="choose-chat-image"/);
    assert.match(view, /data-action="open-chat-action"/);
    assert.match(view, /data-action="quote-phone-message"/);
    assert.match(view, /data-action="recall-phone-message"/);
    assert.match(view, /data-role="audio-cache-size"/);
});

test('prompt entry editor exposes all message roles and ordering controls', () => {
    const markup = promptEntryMarkup({ id: 'entry-a', name: '规则', role: 'assistant', enabled: true, content: 'Hello' }, 1, 3);
    assert.match(markup, /option value="system"/);
    assert.match(markup, /option value="user"/);
    assert.match(markup, /option value="assistant" selected/);
    assert.match(markup, /data-action="move-prompt-entry"/);
    assert.match(markup, /data-action="delete-prompt-entry"/);
});

test('mobile handset CSS preserves a physical frame and fades character wallpaper', async () => {
    const css = await readFile(new URL('../styles/home.css', import.meta.url), 'utf8');
    assert.match(css, /pointer:\s*coarse[\s\S]*max-width:\s*1000px/);
    assert.match(css, /width:\s*auto/);
    assert.match(css, /\.phonie-phone\s*\{[\s\S]*padding:\s*5px/);
    assert.match(css, /\.phonie-frame\s*\{[\s\S]*border:\s*1px\s+solid/);
    assert.match(css, /mask-image:\s*linear-gradient/);
    assert.match(css, /prefers-reduced-motion[\s\S]*\.phonie-rain-curtain/);
});

test('every phone theme owns emphasis, point and multi-stop wallpaper colors', async () => {
    const css = await readFile(new URL('../styles/tokens.css', import.meta.url), 'utf8');
    for (const theme of ['day', 'night', 'tavern']) {
        const start = css.indexOf(`#phonie-root[data-theme="${theme}"]`);
        const end = css.indexOf('\n}', start);
        const block = css.slice(start, end);
        assert.ok(start >= 0, theme);
        assert.match(block, /--phonie-emphasis:/, theme);
        assert.match(block, /--phonie-point:/, theme);
        assert.match(block, /--phonie-wallpaper-gradient:/, theme);
        assert.match(block, /radial-gradient[\s\S]*linear-gradient/, theme);
    }
});
