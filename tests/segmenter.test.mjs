import test from 'node:test';
import assert from 'node:assert/strict';

import { detectLanguage, extractDialogue, segmentSpeech, stripMarkdownForSpeech } from '../src/dialogue/segmenter.js';
import { createSpeechPlan } from '../src/dialogue/speech-plan.js';

test('stripMarkdownForSpeech removes code and keeps link labels', () => {
    const source = 'こんにちは、[ここ](https://example.com)を見て。\n```js\nalert(1)\n```';
    assert.equal(stripMarkdownForSpeech(source), 'こんにちは、ここを見て。');
});

test('extractDialogue prefers quoted dialogue', () => {
    assert.equal(extractDialogue('彼は笑った。「もう帰ろう。」そして立ち上がった。'), 'もう帰ろう。');
});

test('language detection distinguishes Japanese, Chinese, and English', () => {
    assert.equal(detectLanguage('おはよう、今日はどう？'), 'ja-JP');
    assert.equal(detectLanguage('今天要去哪里？'), 'zh-CN');
    assert.equal(detectLanguage('Where should we go?'), 'en-US');
});

test('Japanese segmentation preserves sentences and respects maximum length', () => {
    const result = segmentSpeech('今日は雨だね。傘を持ってきた？それなら安心。', { locale: 'ja-JP', maxChars: 12 });
    assert.deepEqual(result, ['今日は雨だね。', '傘を持ってきた？', 'それなら安心。']);
    assert.ok(result.every((segment) => segment.length <= 12));
});

test('speech plan keeps source, translation, and speech text separate', () => {
    const plan = createSpeechPlan({
        messageId: 3,
        characterName: 'Aoi',
        sourceText: '「待っていたよ。」',
        translationText: '我一直在等你。',
    });
    assert.equal(plan.speakText, '待っていたよ。');
    assert.equal(plan.translationText, '我一直在等你。');
    assert.equal(plan.language, 'ja-JP');
});
