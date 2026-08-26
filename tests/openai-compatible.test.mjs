import test from 'node:test';
import assert from 'node:assert/strict';

import {
    fetchCustomOpenAIModels,
    normalizeOpenAIEndpoint,
    requestCustomOpenAIGeneration,
    saveCustomOpenAIKey,
} from '../src/integrations/openai-compatible.js';

test('custom OpenAI endpoint is normalized without losing the v1 path', () => {
    assert.equal(normalizeOpenAIEndpoint(' https://voice.example/v1/ '), 'https://voice.example/v1');
    assert.throws(() => normalizeOpenAIEndpoint('file:///tmp/models'), /HTTP/);
});

test('custom model discovery uses the SillyTavern protected proxy', async () => {
    let request;
    const models = await fetchCustomOpenAIModels('https://voice.example/v1', {
        getHeaders: async () => ({ 'X-CSRF-Token': 'token' }),
        fetchImpl: async (url, options) => {
            request = { url, options };
            return { ok: true, json: async () => ({ data: [{ id: 'model-b' }, { id: 'model-a' }] }) };
        },
    });
    assert.equal(request.url, '/api/backends/chat-completions/status');
    assert.equal(JSON.parse(request.options.body).chat_completion_source, 'custom');
    assert.deepEqual(models, ['model-a', 'model-b']);
});

test('custom key is written to the SillyTavern secret store', async () => {
    let saved;
    await saveCustomOpenAIKey('secret-value', {
        loadSecrets: async () => ({
            SECRET_KEYS: { CUSTOM: 'api_key_custom' },
            writeSecret: async (...args) => { saved = args; },
        }),
    });
    assert.deepEqual(saved, ['api_key_custom', 'secret-value', 'Phonie 自定义 OpenAI']);
});

test('custom generation sends structured chat through the protected proxy', async () => {
    let body;
    const result = await requestCustomOpenAIGeneration({
        endpoint: 'https://voice.example/v1',
        model: 'model-a',
        messages: [{ role: 'user', content: '你好' }],
        maxTokens: 512,
        jsonSchema: { type: 'object' },
    }, {
        getHeaders: async () => ({}),
        fetchImpl: async (_url, options) => {
            body = JSON.parse(options.body);
            return { ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) };
        },
    });
    assert.equal(body.chat_completion_source, 'custom');
    assert.equal(body.model, 'model-a');
    assert.equal(body.stream, false);
    assert.equal(result.choices[0].message.content, '{}');
});
