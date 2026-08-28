import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_PHONE_PROMPT_PRESET,
    addPhonePromptEntry,
    assemblePhonePromptMessages,
    movePhonePromptEntry,
    normalizePhonePromptPreset,
    normalizePromptPresetLibrary,
    removePhonePromptEntry,
    savePromptPreset,
    resolvePromptVariables,
    updatePhonePromptEntry,
} from '../src/dialogue/prompt-preset.js';

test('default phone preset exposes editable roles and variables', () => {
    assert.ok(DEFAULT_PHONE_PROMPT_PRESET.entries.length >= 3);
    assert.ok(DEFAULT_PHONE_PROMPT_PRESET.entries.every((entry) => ['system', 'user', 'assistant'].includes(entry.role)));
    assert.match(DEFAULT_PHONE_PROMPT_PRESET.entries.map((entry) => entry.content).join('\n'), /\{\{角色\}\}/);
});

test('prompt preset library saves a named copy without replacing the active preset', () => {
    const original = normalizePhonePromptPreset(DEFAULT_PHONE_PROMPT_PRESET);
    const library = normalizePromptPresetLibrary({ chat: [original] }, { chat: original });
    const saved = savePromptPreset(library, 'chat', { ...original, name: '夜间私信' }, { asNew: true });
    assert.equal(saved.library.chat.length, 2);
    assert.equal(saved.preset.name, '夜间私信');
    assert.notEqual(saved.preset.id, original.id);
});

test('preset normalization recovers from legacy null settings', () => {
    const preset = normalizePhonePromptPreset(null);
    assert.equal(preset.name, DEFAULT_PHONE_PROMPT_PRESET.name);
    assert.ok(preset.entries.length >= 1);
});
test('preset normalization clamps depth and rejects invalid roles', () => {
    const preset = normalizePhonePromptPreset({
        name: 'Custom',
        insertionDepth: 999,
        entries: [{ id: 'one', name: 'One', role: 'developer', enabled: true, content: 'Hello' }],
    });
    assert.equal(preset.insertionDepth, 20);
    assert.equal(preset.entries[0].role, 'system');
});

test('prompt variables resolve Chinese and English aliases', () => {
    const text = resolvePromptVariables('{{角色}}/{{char}} {{用户}} {{语言}} {{译文语言}} {{模式}} {{上下文}} {{参与者}} {{通话主题}} {{编排方式}}', {
        character: 'Aoi',
        user: 'Nana',
        sourceLanguage: 'ja-JP',
        targetLanguage: 'zh-CN',
        mode: '电话',
        context: '剧情摘要',
        participants: 'Aoi、Ren',
        topic: '周末约会',
        strategy: '指定内容优先',
    });
    assert.equal(text, 'Aoi/Aoi Nana ja-JP zh-CN 电话 剧情摘要 Aoi、Ren 周末约会 指定内容优先');
});

test('prompt entries are inserted at the configured depth with roles preserved', () => {
    const preset = normalizePhonePromptPreset({
        insertionDepth: 2,
        entries: [
            { id: 'system', name: 'System', role: 'system', enabled: true, content: 'For {{角色}}' },
            { id: 'assistant', name: 'Assistant', role: 'assistant', enabled: true, content: 'Ready' },
        ],
    });
    const history = [
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'two' },
        { role: 'user', content: 'three' },
        { role: 'assistant', content: 'four' },
    ];
    const messages = assemblePhonePromptMessages({ preset, history, variables: { character: 'Aoi' } });
    assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant', 'system', 'assistant', 'user', 'assistant']);
    assert.equal(messages[2].content, 'For Aoi');
});

test('prompt entry editing helpers add, update, move, and remove immutably', () => {
    const original = normalizePhonePromptPreset(DEFAULT_PHONE_PROMPT_PRESET);
    const added = addPhonePromptEntry(original);
    const newEntry = added.entries.at(-1);
    const updated = updatePhonePromptEntry(added, newEntry.id, { name: 'Custom', role: 'assistant' });
    const moved = movePhonePromptEntry(updated, newEntry.id, -1);
    const removed = removePhonePromptEntry(moved, newEntry.id);
    assert.equal(original.entries.length, DEFAULT_PHONE_PROMPT_PRESET.entries.length);
    assert.equal(updated.entries.at(-1).name, 'Custom');
    assert.equal(moved.entries.at(-2).id, newEntry.id);
    assert.equal(removed.entries.length, original.entries.length);
});
