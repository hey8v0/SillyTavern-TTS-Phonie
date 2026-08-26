import { normalizePhonePromptPreset, resolvePromptVariables } from './prompt-preset.js';
import { detectLanguage } from './segmenter.js';

export const BODY_TTS_TAG_PATTERN = /\[(?:TTSVoice|TTS)\s*[:：]\s*([^:：\]]+?)\s*[:：]\s*([^:：\]]*?)\s*[:：]\s*([\s\S]*?)\]/gi;

const VISIBLE_QUOTE_PATTERN = /(?:“([^”]+)”|「([^」]+)」|『([^』]+)』|"([^"]+)")\s*$/u;
const ELEVENLABS_AUDIO_TAG_PATTERN = /(^|\s)\((laughs|chuckle|humming|breath|inhale|exhale|pant|gasps|sighs|sniffs|snorts|coughs|clear-throat|groans|emm|lip-smacking|sneezes|burps)\)(?=\s|$)/gi;

const EMOTION_ALIASES = Object.freeze({
    neutral: 'calm',
    natural: 'calm',
    calm: 'calm',
    fluent: 'fluent',
    happy: 'happy',
    bright: 'happy',
    warm: 'happy',
    sad: 'sad',
    angry: 'angry',
    fearful: 'fearful',
    fear: 'fearful',
    disgusted: 'disgusted',
    surprised: 'surprised',
    平静: 'calm',
    自然: 'calm',
    流畅: 'fluent',
    开心: 'happy',
    高兴: 'happy',
    温柔: 'happy',
    悲伤: 'sad',
    难过: 'sad',
    生气: 'angry',
    愤怒: 'angry',
    害怕: 'fearful',
    恐惧: 'fearful',
    厌恶: 'disgusted',
    惊讶: 'surprised',
});

const BODY_PROMPT_ENTRIES = [
    {
        id: 'body-rules',
        name: '正文语音规则',
        role: 'system',
        enabled: true,
        content: [
            '正常续写正文与叙事，不要改变角色人设或写作风格。',
            '凡是角色真正说出口、需要朗读的台词，请完整写成 {{格式}}。',
            '标签前引号内的中文译文必须自然、完整，供读者查看；标签内最后一段文本必须保留角色实际说话的原语言，供 TTS 生成。两者语义必须一致并同时保留。',
            '旁白、动作、环境与心理描写继续写成普通正文，不要为没有说出口的内容添加语音标签。',
            '格式中的角色、情绪和原语言文本都必须填写；台词语言遵循 {{语言}}。不要解释规则，不要输出代码块。',
        ].join('\n'),
    },
    {
        id: 'body-minimax-adaptation',
        name: '情绪与服务商适配',
        role: 'system',
        enabled: true,
        content: [
            '情绪字段优先使用以下标准值之一：happy、sad、angry、fearful、disgusted、surprised、calm、fluent。',
            '需要笑声、呼吸或停顿时，只能把控制标记写进标签内的原语言文本，不得写进可见中文译文。',
            '可用控制标记包括：(laughs)、(chuckle)、(humming)、(breath)、(inhale)、(exhale)、(pant)、(gasps)、(sighs)、(sniffs)、(snorts)、(coughs)、(clear-throat)、(groans)、(emm)、(lip-smacking)、(sneezes)、(burps)、<#0.3#>。',
            '控制标记应少量、自然地使用；没有必要时不要添加。',
        ].join('\n'),
    },
];

export const DEFAULT_BODY_PROMPT_PRESET = Object.freeze({
    id: 'phonie-body-default',
    name: '正文 TTS 默认预设',
    insertionDepth: 1,
    entries: Object.freeze(BODY_PROMPT_ENTRIES.map((entry) => Object.freeze({ ...entry }))),
});

function formatExample(characterName, sourceLanguage) {
    const source = String(sourceLanguage || '').toLowerCase().startsWith('ja')
        ? '今日は会えてうれしい。'
        : String(sourceLanguage || '').toLowerCase().startsWith('en')
            ? 'I am glad to see you today.'
            : String(sourceLanguage || '').toLowerCase().startsWith('ko')
                ? '오늘 만나서 정말 기뻐.'
                : '今天见到你真好。';
    return `“今天见到你真好。”[TTSVoice:${characterName || '{{角色}}'}:平静:${source}]`;
}

export function normalizeBodyEmotion(value) {
    const raw = String(value || '').trim();
    return EMOTION_ALIASES[raw] || EMOTION_ALIASES[raw.toLowerCase()] || 'calm';
}

export function parseBodySpeechSegments(sourceText, { messageId = 0, preferredLanguage = 'ja-JP' } = {}) {
    const source = String(sourceText || '');
    const segments = [];
    let match;
    BODY_TTS_TAG_PATTERN.lastIndex = 0;

    while ((match = BODY_TTS_TAG_PATTERN.exec(source))) {
        const prefix = source.slice(0, match.index);
        const visibleMatch = prefix.match(VISIBLE_QUOTE_PATTERN);
        const visibleText = visibleMatch ? visibleMatch.slice(1).find(Boolean) || '' : '';
        const speaker = String(match[1] || '').trim();
        const rawEmotion = String(match[2] || '').trim();
        const speakText = String(match[3] || '').trim();
        const detected = detectLanguage(speakText);
        segments.push(Object.freeze({
            id: `body-${messageId}-${segments.length}`,
            messageId: Number(messageId),
            index: segments.length,
            speaker,
            emotion: normalizeBodyEmotion(rawEmotion),
            rawEmotion,
            visibleText: String(visibleText).trim(),
            speakText,
            language: detected === 'und' ? preferredLanguage : detected,
            sourceStart: match.index,
            sourceEnd: BODY_TTS_TAG_PATTERN.lastIndex,
            rawTag: match[0],
        }));
    }
    BODY_TTS_TAG_PATTERN.lastIndex = 0;
    return segments;
}

export function stripBodySpeechTags(sourceText) {
    BODY_TTS_TAG_PATTERN.lastIndex = 0;
    const value = String(sourceText || '').replace(BODY_TTS_TAG_PATTERN, '');
    BODY_TTS_TAG_PATTERN.lastIndex = 0;
    return value;
}

export function compileBodyPromptEntries({
    preset = DEFAULT_BODY_PROMPT_PRESET,
    characterName = '{{角色}}',
    userName = '{{用户}}',
    sourceLanguage = 'ja-JP',
    targetLanguage = 'zh-CN',
} = {}) {
    const normalized = normalizePhonePromptPreset(preset || DEFAULT_BODY_PROMPT_PRESET);
    const variables = {
        character: characterName,
        user: userName,
        sourceLanguage,
        targetLanguage,
        mode: '酒馆正文',
        format: formatExample(characterName, sourceLanguage),
    };
    return normalized.entries
        .filter((entry) => entry.enabled && entry.content.trim())
        .map((entry) => ({
            ...entry,
            depth: normalized.insertionDepth,
            content: resolvePromptVariables(entry.content, variables).trim(),
        }));
}

export function formatSpeechForProvider(segment, providerLabel = '') {
    const text = String(segment?.speakText || '').trim();
    if (!/elevenlabs/i.test(String(providerLabel || ''))) return text;
    return text.replace(ELEVENLABS_AUDIO_TAG_PATTERN, (_, spacing, tag) => `${spacing}[${String(tag).toLowerCase()}]`);
}
