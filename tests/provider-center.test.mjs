import test from 'node:test';
import assert from 'node:assert/strict';

import { TTS_PROVIDERS, normalizeProviderSettings } from '../src/tts/provider-catalog.js';
import { PhonieProviderCenter, normalizeMiniMaxCatalog } from '../src/tts/provider-center.js';

function makeBridge(overrides = {}) {
    let settings = {
        ttsActiveProvider: 'elevenlabs',
        ttsFallbackProvider: '',
        ttsProviderSettings: {},
        ttsCharacterRoutes: {},
        ttsResourceCatalogs: {},
        ...overrides,
    };
    return {
        getSettings: () => settings,
        updateSettings: (patch) => (settings = { ...settings, ...patch }),
    };
}

test('catalog contains the seven Phonie-owned engines from the handoff', () => {
    assert.deepEqual(TTS_PROVIDERS.map((provider) => provider.id), [
        'indextts2', 'gpt_sovits', 'voxcpm2', 'doubao', 'edge', 'elevenlabs', 'minimax',
    ]);
});

test('provider defaults preserve user configuration', () => {
    const settings = normalizeProviderSettings({ elevenlabs: { voice: 'voice-1' } });
    assert.equal(settings.elevenlabs.voice, 'voice-1');
    assert.equal(settings.elevenlabs.model, 'eleven_multilingual_v2');
    assert.equal(settings.minimax.model, 'speech-2.8-hd');
});

test('character route overrides the global provider and keeps fallback', () => {
    const bridge = makeBridge({ ttsFallbackProvider: 'minimax' });
    const center = new PhonieProviderCenter({ bridge });
    center.setCharacterRoute('Nana', { providerId: 'gpt_sovits', voiceId: 'nana' });
    const route = center.resolveRoute('Nana');
    assert.equal(route.providerId, 'gpt_sovits');
    assert.equal(route.fallbackProviderId, 'minimax');
    assert.equal(route.voiceId, 'nana');
});

test('cache signature changes when a character voice changes', () => {
    const bridge = makeBridge({ ttsProviderSettings: { elevenlabs: { model: 'eleven_v3', voice: 'voice-1' } } });
    const center = new PhonieProviderCenter({ bridge });
    const first = center.getCacheSignature('Nana');
    center.setCharacterRoute('Nana', { providerId: 'elevenlabs', voiceId: 'voice-2' });
    assert.notEqual(center.getCacheSignature('Nana'), first);
    assert.equal(center.getLabelForSpeaker('Nana'), 'ElevenLabs');
});

test('active provider is stored only in Phonie settings', () => {
    const bridge = makeBridge();
    const center = new PhonieProviderCenter({ bridge });
    center.setActive('minimax');
    assert.equal(bridge.getSettings().ttsActiveProvider, 'minimax');
    assert.equal(center.getActiveLabel(), 'MiniMax');
});

test('MiniMax resource proxy payload is normalized into selectable models and voices', () => {
    const catalog = normalizeMiniMaxCatalog({
        models: { data: [{ model_name: 'general-model' }] },
        speechModels: [{ id: 'speech-2.8-hd', name: 'Speech 2.8 HD' }],
        voices: {
            data: {
                system_voice: [{ voice_id: 'voice-a', voice_name: '音色 A' }],
                voice_cloning: [{ voice_id: 'voice-b' }],
            },
        },
    });
    assert.deepEqual(catalog.models.map((item) => item.id), ['speech-2.8-hd', 'general-model']);
    assert.deepEqual(catalog.voices.map((item) => item.id), ['voice-a', 'voice-b']);
});
