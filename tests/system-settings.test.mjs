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
    assert.doesNotMatch(markup, /generationProfileId|连接管理器/);
    assert.match(markup, /phonie-generation-panel/);
    assert.match(markup, /max="65536"/);
    assert.match(markup, /data-setting="customOpenAIEndpoint"/);
    assert.match(markup, /data-setting="customOpenAIModel"/);
    assert.match(markup, /data-action="refresh-custom-models"/);
    assert.match(markup, /data-action="save-custom-key"/);
    assert.doesNotMatch(markup, /data-setting="customOpenAIKey"/);
    assert.match(markup, /data-prompt-preset-field="insertionDepth"/);
    assert.match(markup, /data-setting="promptWorkflowKind"/);
    assert.match(markup, /value="call_single"/);
    assert.match(markup, /value="call_group"/);
    assert.match(markup, /data-setting="bodyPromptEnabled"/);
    assert.match(markup, /data-role="prompt-preset-library"/);
    assert.match(markup, /data-action="save-prompt-preset"/);
    assert.match(markup, /data-action="export-prompt-library"/);
    assert.match(markup, /data-action="import-prompt-presets"/);
    assert.match(markup, /\{\{角色\}\}/);
});

test('model app owns providers while voice app owns routed voices', async () => {
    const home = await readFile(new URL('../src/ui/phone-home.js', import.meta.url), 'utf8');
    const view = await readFile(new URL('../src/ui/phone-view.js', import.meta.url), 'utf8');
    const systemMarkup = systemSettingsScreensMarkup();
    assert.match(systemMarkup, /data-role="tts-provider-list"/);
    assert.doesNotMatch(home, /最近声线/);
    assert.match(home, /data-role="voice-library"/);
    assert.match(home, /data-role="tts-provider-editor"/);
    assert.match(home, /data-screen="\$\{SCREENS\.PROVIDER\}"/);
    assert.match(home, /data-role="character-directory"/);
    assert.match(home, /nai-diffusion-5-full/);
    assert.match(home, /正面提示词/);
    assert.match(home, /画师串与风格 Tag/);
    assert.match(home, /data-action="generate-novelai-tags"/);
    assert.match(home, /data-action="save-novelai-preset"/);
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
    assert.match(view, /data-action="open-chat-preset"/);
    assert.match(view, /data-action="open-chat-settings"/);
    assert.match(view, /data-action="add-call-participant"/);
    assert.match(view, /data-action="remove-call-participant"/);
    assert.match(view, /phonie-call-ripples/);
    assert.match(view, /AudioActionMenu/);
    assert.match(view, /#audioMenu\.bind[\s\S]*?regenerate:/);
    assert.match(view, /data-action="replay-call-record"/);
    assert.match(view, /data-action="delete-call-record"/);
});

test('motion and call playback contracts remain wired to real state', async () => {
    const [view, phoneCss, callCss, providerCenter, app] = await Promise.all([
        readFile(new URL('../src/ui/phone-view.js', import.meta.url), 'utf8'),
        readFile(new URL('../styles/phone.css', import.meta.url), 'utf8'),
        readFile(new URL('../styles/call.css', import.meta.url), 'utf8'),
        readFile(new URL('../src/tts/provider-center.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/app.js', import.meta.url), 'utf8'),
    ]);
    assert.match(view, /dataset\.awake = 'true'/);
    assert.match(view, /style\.right = '-33px'/);
    assert.match(phoneCss, /right:\s*-34px/);
    assert.match(phoneCss, /data-awake="true"/);
    assert.match(callCss, /grid-template-columns:\s*repeat\(30, 2px\)/);
    assert.match(callCss, /data-theme='day'[\s\S]*data-theme='night'[\s\S]*data-theme='tavern'/);
    assert.match(providerCenter, /minimax:\s*1350,\s*elevenlabs:\s*1150/);
    assert.match(providerCenter, /status === 429/);
    assert.match(app, /endCall\('completed'\)/);
    assert.match(app, /force:\s*true/);
    assert.match(app, /force \? currentRouteKey/);
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
    const [css, atmosphereCss] = await Promise.all([
        readFile(new URL('../styles/home.css', import.meta.url), 'utf8'),
        readFile(new URL('../styles/atmosphere.css', import.meta.url), 'utf8'),
    ]);
    assert.match(css, /pointer:\s*coarse[\s\S]*max-width:\s*1000px/);
    assert.match(css, /width:\s*auto/);
    assert.match(css, /\.phonie-phone\s*\{[\s\S]*padding:\s*5px/);
    assert.match(css, /\.phonie-frame\s*\{[\s\S]*border:\s*1px\s+solid/);
    assert.match(css, /mask-image:\s*linear-gradient/);
    assert.match(atmosphereCss, /prefers-reduced-motion[\s\S]*\.phonie-motion-canvas/);
});

test('group selection and call layouts expose the clarified interaction contract', async () => {
    const [home, view, app, atmosphereCss] = await Promise.all([
        readFile(new URL('../src/ui/phone-home.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/ui/phone-view.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/app.js', import.meta.url), 'utf8'),
        readFile(new URL('../styles/atmosphere.css', import.meta.url), 'utf8'),
    ]);
    assert.match(home, /data-role="group-selection-summary"/);
    assert.match(home, /data-action="clear-group-selection"/);
    assert.match(view, /加入/);
    assert.match(view, /已选/);
    assert.match(app, /clearGroupSelection\(\)/);
    assert.match(app, /chatParticipants:\s*selected/);
    assert.match(atmosphereCss, /\.phonie-call-idle-action\s*\{[\s\S]*?position:\s*absolute[\s\S]*?top:\s*48px/);
    assert.match(atmosphereCss, /\.phonie-contact-mark\s*\{[\s\S]*?background-size:\s*contain/);
    assert.match(atmosphereCss, /\.phonie-call-captions\s*\{[\s\S]*?background:/);
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
