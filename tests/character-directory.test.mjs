import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCharacterDirectory, resolveCharacterRoute } from '../src/dialogue/character-directory.js';

test('character directory merges cards, spoken names and configured routes', () => {
    const routes = {
        'speaker:nephele': {
            characterId: 'speaker:nephele',
            characterName: 'Nephele',
            providerId: 'minimax',
            voiceId: 'voice-nephele',
        },
    };
    const directory = buildCharacterDirectory({
        currentContact: { id: 'card:nana.png', name: 'Nana', avatarUrl: '/characters/nana.png' },
        characters: [{ name: 'Nana', avatar: 'nana.png' }, { name: 'Aoi', avatar: 'aoi.png' }],
        routes,
        messages: [{ extra: { phonie: { bodySpeech: [{ speaker: 'Nephele' }, { speaker: 'Aoi' }] } } }],
    });

    assert.deepEqual(directory.map((entry) => entry.name), ['Nana', 'Nephele', 'Aoi']);
    assert.equal(directory.find((entry) => entry.name === 'Nephele').route.voiceId, 'voice-nephele');
    assert.equal(directory.find((entry) => entry.name === 'Aoi').spoken, true);
});

test('route lookup supports stable ids and legacy name keys', () => {
    const routes = {
        Nana: { providerId: 'elevenlabs', voiceId: 'nana-old' },
        'speaker:aoi': { characterId: 'speaker:aoi', characterName: 'Aoi', providerId: 'minimax' },
    };
    assert.equal(resolveCharacterRoute(routes, { id: 'card:nana', name: 'Nana' }).voiceId, 'nana-old');
    assert.equal(resolveCharacterRoute(routes, { id: 'speaker:aoi', name: 'Aoi' }).providerId, 'minimax');
});

test('speaker-only directory excludes cards and unused configured routes', () => {
    const directory = buildCharacterDirectory({
        currentContact: { id: 'card:nana', name: 'Nana' },
        characters: [{ name: 'Aoi', avatar: 'aoi.png' }],
        routes: { Unused: { characterName: 'Unused', voiceId: 'unused' } },
        messages: [{ extra: { phonie: { bodySpeech: [{ speaker: 'Nephele' }] } } }],
        speakersOnly: true,
    });
    assert.deepEqual(directory.map((entry) => entry.name), ['Nephele']);
});
