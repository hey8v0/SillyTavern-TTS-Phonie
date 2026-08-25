import test from 'node:test';
import assert from 'node:assert/strict';

import { buildContinuityPrompt, buildPhoneReplyPrompt, parsePhoneReply } from '../src/dialogue/prompt-service.js';

test('phone reply prompt declares both languages and channel', () => {
    const prompt = buildPhoneReplyPrompt({
        contactName: 'Aoi',
        sourceLanguage: 'ja-JP',
        targetLanguage: 'zh-CN',
        history: [],
        callMode: true,
    });
    assert.match(prompt, /live phone call/);
    assert.match(prompt, /ja-JP/);
    assert.match(prompt, /zh-CN/);
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
    assert.match(prompt, /Phoen private communication continuity/);
});
