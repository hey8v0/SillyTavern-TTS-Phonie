import test from 'node:test';
import assert from 'node:assert/strict';

import { buildContinuityPrompt, buildPhoneReplyMessages, buildPhoneReplyPrompt, parsePhoneReply, resolveCallTurnRange } from '../src/dialogue/prompt-service.js';
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

test('call prompt carries story context, participants, and a user topic', () => {
    const messages = buildPhoneReplyMessages({
        contactName: 'Aoi',
        userName: 'Nana',
        sourceLanguage: 'ja-JP',
        targetLanguage: 'zh-CN',
        history: [],
        callMode: true,
        storyContext: '[当前摘要]\n两人刚刚约好见面。',
        participants: [{ name: 'Aoi' }, { name: 'Ren' }],
        topic: '确认集合地点',
        strategy: 'topic',
    });
    const content = messages.map((message) => message.content).join('\n');
    assert.match(content, /两人刚刚约好见面/);
    assert.match(content, /Aoi、Ren/);
    assert.match(content, /确认集合地点/);
});

test('group chat prompt requests multiple short messages without impersonating the user', () => {
    const messages = buildPhoneReplyMessages({
        contactName: 'Aoi、Ren',
        userName: 'Nana',
        sourceLanguage: 'ja-JP',
        targetLanguage: 'zh-CN',
        history: [{ direction: 'outgoing', originalText: '你们都在吗？' }],
        participants: [{ name: 'Aoi' }, { name: 'Ren' }],
    });
    const content = messages.map((message) => message.content).join('\n');
    assert.match(content, /多人手机群聊/);
    assert.match(content, /2 到 8 条/);
    assert.match(content, /Aoi、Ren/);
    assert.match(content, /不要代替用户|不要替用户/);
    assert.match(content, /不要强迫所有角色/);
});

test('structured call reply preserves an optional speaker', () => {
    const parsed = parsePhoneReply({
        originalText: '今から向かうよ。',
        translationText: '我现在过去。',
        emotion: 'warm',
        action: 'reply',
        speaker: 'Ren',
    });
    assert.equal(parsed.speaker, 'Ren');
});

test('prepared call mode asks for one complete multi-turn script', () => {
    const messages = buildPhoneReplyMessages({
        contactName: 'Aoi',
        userName: 'Nana',
        sourceLanguage: 'ja-JP',
        targetLanguage: 'zh-CN',
        history: [],
        callMode: true,
        scriptMode: true,
        participants: [{ name: 'Aoi' }, { name: 'Ren' }],
    });
    const content = messages.map((message) => message.content).join('\n');
    assert.match(content, /完整电话|完整段电话/);
    assert.match(content, /turns/);
    assert.match(content, /不要让用户逐轮输入/);
    assert.match(content, /20 到 28/);
});

test('call length presets and group calls resolve to explicit turn ranges', () => {
    assert.deepEqual(resolveCallTurnRange('short', 1), { minimum: 4, maximum: 6, label: '短来电' });
    assert.deepEqual(resolveCallTurnRange('normal', 1), { minimum: 7, maximum: 10, label: '普通来电' });
    assert.deepEqual(resolveCallTurnRange('long', 1), { minimum: 12, maximum: 18, label: '长来电' });
    assert.deepEqual(resolveCallTurnRange('short', 3), { minimum: 20, maximum: 28, label: '多人通话' });
});

test('prepared call parser normalizes multiple bilingual turns', () => {
    const parsed = parsePhoneReply({
        turns: [
            { speaker: 'Aoi', originalText: 'もしもし。', translationText: '喂。', emotion: 'warm' },
            { speaker: 'Ren', originalText: '今、話せる？', translationText: '现在能说话吗？', emotion: 'quiet' },
        ],
        action: 'end_call',
        summary: '两人确认了见面时间。',
    });
    assert.equal(parsed.turns.length, 2);
    assert.equal(parsed.turns[1].speaker, 'Ren');
    assert.equal(parsed.action, 'end_call');
    assert.equal(parsed.summary, '两人确认了见面时间。');
});

test('prepared call parser keeps all supported group-call turns', () => {
    const parsed = parsePhoneReply({
        turns: Array.from({ length: 28 }, (_, index) => ({
            speaker: index % 2 ? 'Aoi' : 'Ren',
            originalText: `line-${index}`,
            translationText: `译文-${index}`,
        })),
    });
    assert.equal(parsed.turns.length, 28);
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

test('structured reply parser accepts provider objects and OpenAI-style wrappers', () => {
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

test('structured reply parser rejects empty objects before TTS', () => {
    assert.throws(() => parsePhoneReply({}), /没有返回可播放的电话内容/);
    assert.throws(() => parsePhoneReply('{}'), /没有返回可播放的电话内容/);
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
    assert.match(content, /多人群聊/);
    assert.doesNotMatch(content, /Continue an in-world|Write originalText|Reply naturally/);
});
