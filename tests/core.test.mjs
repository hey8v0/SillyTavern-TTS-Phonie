import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../src/core/store.js';
import { ProviderRegistry } from '../src/tts/provider-registry.js';
import { makeAudioCacheKey } from '../src/storage/audio-cache.js';
import { makeInlineAudioSourceKey } from '../src/ui/inline-player.js';

test('store publishes state changes', () => {
    const store = createStore({ count: 1 });
    let observed = null;
    store.subscribe((state, previous) => { observed = [state.count, previous.count]; });
    store.setState({ count: 2 });
    assert.deepEqual(observed, [2, 1]);
});

test('provider registry uses fallback providers in order', async () => {
    const registry = new ProviderRegistry();
    registry.register({ id: 'first', synthesize: async () => { throw new Error('offline'); } });
    registry.register({ id: 'second', synthesize: async ({ text }) => `audio:${text}` });
    const result = await registry.synthesize({ providerId: 'first', text: 'hello' }, ['second']);
    assert.equal(result, 'audio:hello');
});

test('audio cache keys are stable and text-sensitive', () => {
    const first = makeAudioCacheKey({ chatId: 'chat', messageId: 1, text: 'hello', provider: 'a' });
    const same = makeAudioCacheKey({ chatId: 'chat', messageId: 1, text: 'hello', provider: 'a' });
    const changed = makeAudioCacheKey({ chatId: 'chat', messageId: 1, text: 'goodbye', provider: 'a' });
    const nextChat = makeAudioCacheKey({ chatId: 'next-chat', messageId: 1, text: 'hello', provider: 'a' });
    assert.equal(first, same);
    assert.notEqual(first, changed);
    assert.notEqual(first, nextChat);
    assert.notEqual(makeInlineAudioSourceKey(first), makeInlineAudioSourceKey(changed));
});
