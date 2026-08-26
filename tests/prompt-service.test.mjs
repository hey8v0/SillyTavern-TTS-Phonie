import test from 'node:test';
import assert from 'node:assert/strict';

import { buildContinuityPrompt, buildPhoneReplyMessages, buildPhoneReplyPrompt, parsePhoneReply } from '../src/dialogue/prompt-service.js';
import { DEFAULT_PHONE_PROMPT_PRESET } from '../src/dialogue/prompt-preset.js';

test('phone reply prompt declares both languages and channel', () => {
    const prompt = buildPhoneReplyPrompt({
        contactName: 'Aoi',
        sourceLanguage: 'ja-JP',
        targetLanguage: 'zh-CN',
        history: [],
        callMode: true,
    });
    assert.match(prompt, /电话通话/);
    assert.match(prompt, /ja-JP/);
    assert.match(prompt, /zh-CN/);
});

test('phone reply messages preserve preset roles for raw generation', () => {
    const messages = buildPhoneReplyMessages({
        contactName: 'Aoi',
        userName: 'Nana',
        sourceLanguage: 'ja-JP',
        targetLanguage: 'zh-CN',
        history: [{ direction: 'outgoing', originalText: '今、話せる？' }],
        callMode: true,
        preset: DEFAULT_PHONE_PROMPT_PRESET,
    });
    assert.ok(messages.some((message) => message.role === 'system'));
    assert.ok(messages.some((message) => message.role === 'user'));
    assert.match(messages.map((message) => message.content).join('\n'), /Aoi/);
    assert.match(messages.map((message) => message.content).join('\n'), /ja-JP/);
});

test('structured reply parser accepts fenced JSON', () => {
    const parsed = parsePhoneReply('```json\n{"originalText":"もしもし","translationText":"喂","emotion":"warm","action":"reply"}\n```');
    assert.deepEqual(parsed, {
        originalText: 'もしもし',
        translationText: '喂',
        emotion: 'warm',
        action: 'reply',
    });
});

test('structured reply parser accepts Connection Manager objects and wrappers', () => {
    const direct = parsePhoneReply({
        originalText: 'もしもし。',
        translationText: '喂。',
        emotion: 'warm',
        action: 'reply',
    });
    assert.equal(direct.originalText, 'もしもし。');

    const wrapped = parsePhoneReply({
        choices: [{ message: { content: JSON.stringify({
            originalText: '今、話せる？',
            translationText: '现在能说话吗？',
            emotion: 'quiet',
            action: 'reply',
        }) } }],
    });
    assert.equal(wrapped.translationText, '现在能说话吗？');
});
test('structured reply parser degrades to plain text', () => {
    const parsed = parsePhoneReply('今、話せる？');
    assert.equal(parsed.originalText, '今、話せる？');
    assert.equal(parsed.emotion, 'neutral');
});

test('continuity prompt is bounded', () => {
    const messages = Array.from({ length: 20 }, (_, index) => ({
        direction: index % 2 ? 'incoming' : 'outgoing',
        originalText: '長いメッセージ'.repeat(100),
    }));
    const prompt = buildContinuityPrompt({ contactName: 'Aoi', messages, maxChars: 480 });
    assert.ok(prompt.length <= 480);
    assert.match(prompt, /Phonie 私人通信连续性/);
});

test('default injected prompts are written in Chinese', () => {
    const content = DEFAULT_PHONE_PROMPT_PRESET.entries.map((entry) => entry.content).join('\n');
    assert.match(content, /保持角色设定/);
    assert.match(content, /只返回 JSON/);
    assert.doesNotMatch(content, /Continue an in-world|Write originalText|Reply naturally/);
});
