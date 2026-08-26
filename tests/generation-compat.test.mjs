import test from 'node:test';
import assert from 'node:assert/strict';

import {
    flattenPromptMessages,
    getCurrentGenerationTarget,
    listConnectionProfiles,
    requestPhoneGeneration,
} from '../src/integrations/generation-compat.js';

const settings = { generationProfileId: '', phoneResponseLength: 420 };
const prompt = [
    { role: 'system', content: 'Stay in character.' },
    { role: 'user', content: 'もしもし' },
];

test('older SillyTavern falls back to generateQuietPrompt without breaking startup', async () => {
    let received;
    const result = await requestPhoneGeneration({
        settings,
        prompt,
        jsonSchema: { type: 'object' },
        loadScriptModule: async () => ({}),
        generateQuietPrompt: async (options) => {
            received = options;
            return '{"originalText":"はい"}';
        },
    });
    assert.equal(result, '{"originalText":"はい"}');
    assert.match(received.quietPrompt, /\[system\]/);
    assert.match(received.quietPrompt, /\[user\]/);
    assert.equal(received.responseLength, 420);
});

test('newer SillyTavern uses generateRaw with real message roles', async () => {
    let received;
    const result = await requestPhoneGeneration({
        settings,
        prompt,
        jsonSchema: { type: 'object' },
        generateQuietPrompt: async () => 'fallback',
        loadScriptModule: async () => ({ generateRaw: async (options) => { received = options; return 'raw'; } }),
    });
    assert.equal(result, 'raw');
    assert.deepEqual(received.prompt, prompt);
});

test('Connection Manager is loaded only when a profile is selected', async () => {
    let call;
    const result = await requestPhoneGeneration({
        settings: { ...settings, generationProfileId: 'profile-a' },
        prompt,
        jsonSchema: { type: 'object' },
        generateQuietPrompt: async () => 'fallback',
        loadSharedModule: async () => ({
            ConnectionManagerRequestService: {
                constructPrompt(value, id) { assert.equal(id, 'profile-a'); return value; },
                async sendRequest(...args) { call = args; return { content: { originalText: '接続済み' } }; },
            },
        }),
    });
    assert.equal(result.originalText, '接続済み');
    assert.equal(call[0], 'profile-a');
});

test('custom mode routes through the OpenAI-compatible proxy adapter', async () => {
    let received;
    const result = await requestPhoneGeneration({
        settings: {
            ...settings,
            generationMode: 'custom',
            customOpenAIEndpoint: 'https://voice.example/v1',
            customOpenAIModel: 'voice-model',
            customOpenAIMaxTokens: 2048,
            customOpenAITemperature: 0.6,
        },
        prompt,
        jsonSchema: { type: 'object' },
        generateQuietPrompt: async () => 'wrong route',
        requestCustomGeneration: async (options) => { received = options; return 'custom route'; },
    });
    assert.equal(result, 'custom route');
    assert.equal(received.endpoint, 'https://voice.example/v1');
    assert.equal(received.model, 'voice-model');
    assert.deepEqual(received.messages, prompt);
});

test('profile discovery reads settings data without importing optional modules', () => {
    const context = { extensionSettings: { connectionManager: { profiles: [{ id: 'a', name: 'A', api: 'openai', model: 'm' }] } } };
    assert.deepEqual(listConnectionProfiles(context), [{ id: 'a', name: 'A', api: 'openai', model: 'm' }]);
    assert.equal(getCurrentGenerationTarget({ mainApi: 'openai', onlineStatus: 'online' }).api, 'openai');
    assert.match(flattenPromptMessages(prompt), /Stay in character/);
});
