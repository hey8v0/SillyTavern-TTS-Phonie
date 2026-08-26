import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_BODY_PROMPT_PRESET,
    compileBodyPromptEntries,
    formatSpeechForProvider,
    parseBodySpeechSegments,
    stripBodySpeechTags,
} from '../src/dialogue/body-speech.js';

test('parses bilingual TTSVoice tags into internal speech segments', () => {
    const source = '她轻轻抬眼。\n“今天见到你真好。”[TTSVoice:Nana:开心:(chuckle) 今日は会えてうれしい。]';
    const segments = parseBodySpeechSegments(source, { messageId: 12, preferredLanguage: 'ja-JP' });

    assert.equal(segments.length, 1);
    assert.equal(segments[0].id, 'body-12-0');
    assert.equal(segments[0].speaker, 'Nana');
    assert.equal(segments[0].emotion, 'happy');
    assert.equal(segments[0].rawEmotion, '开心');
    assert.equal(segments[0].visibleText, '今天见到你真好。');
    assert.equal(segments[0].speakText, '(chuckle) 今日は会えてうれしい。');
    assert.equal(segments[0].language, 'ja-JP');
});

test('removes only control tags and preserves visible translation and narration', () => {
    const source = '雨还在落。\n“不要走。”[TTSVoice:Nana:sad:行かないで。]';
    assert.equal(stripBodySpeechTags(source), '雨还在落。\n“不要走。”');
});

test('Chinese body workflow compiles provider-aware format rules', () => {
    const entries = compileBodyPromptEntries({
        preset: DEFAULT_BODY_PROMPT_PRESET,
        characterName: 'Nana',
        sourceLanguage: 'ja-JP',
        targetLanguage: 'zh-CN',
    });

    assert.equal(entries.length, 2);
    assert.match(entries[0].content, /TTSVoice:Nana:平静:/);
    assert.match(entries[0].content, /中文译文/);
    assert.match(entries[1].content, /happy、sad、angry/);
    assert.match(entries[1].content, /\(laughs\)/);
});

test('ElevenLabs receives compatible audio tags while MiniMax keeps parenthetical tags', () => {
    const segment = { emotion: 'happy', speakText: '(laughs) 今日は楽しい。' };
    assert.equal(formatSpeechForProvider(segment, 'ElevenLabs'), '[laughs] 今日は楽しい。');
    assert.equal(formatSpeechForProvider(segment, 'MiniMax'), '(laughs) 今日は楽しい。');
});
