/**
 * 生成契约：输出 JSON Schema 属于插件结构契约，独立于用户可编辑提示词。
 */

export const QQ_GENERATION_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['messages'],
    properties: {
        messages: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['kind', 'speaker'],
                properties: {
                    kind: { type: 'string', enum: ['text', 'voice', 'image', 'transfer', 'sticker'] },
                    speaker: { type: 'string' },
                    sourceText: { type: 'string' },
                    translatedText: { type: 'string' },
                    emotion: { type: 'string' },
                    imageDescription: { type: 'string' },
                    amount: { type: 'number' },
                    note: { type: 'string' },
                    stickerName: { type: 'string' },
                },
            },
        },
        proactiveCall: {
            type: 'object',
            additionalProperties: false,
            required: ['shouldCall', 'caller', 'reason', 'tone'],
            properties: {
                shouldCall: { type: 'boolean' },
                caller: { type: 'string' },
                reason: { type: 'string' },
                tone: { type: 'string' },
            },
        },
    },
});

export const SINGLE_CALL_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['caller', 'title', 'reason', 'tone', 'segments'],
    properties: {
        caller: { type: 'string' },
        title: { type: 'string' },
        reason: { type: 'string' },
        tone: { type: 'string' },
        segments: {
            type: 'array',
            minItems: 1,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['speaker', 'sourceText', 'translatedText', 'emotion'],
                properties: {
                    speaker: { type: 'string' },
                    sourceText: { type: 'string' },
                    translatedText: { type: 'string' },
                    emotion: { type: 'string' },
                },
            },
        },
    },
});

export const GROUP_CALL_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['sceneDescription', 'summary', 'speakers', 'threads', 'segments'],
    properties: {
        sceneDescription: { type: 'string' },
        summary: { type: 'string' },
        speakers: { type: 'array', items: { type: 'string' } },
        threads: { type: 'array', items: { type: 'string' } },
        segments: {
            type: 'array',
            minItems: 1,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['speaker', 'sourceText', 'translatedText', 'emotion'],
                properties: {
                    speaker: { type: 'string' },
                    sourceText: { type: 'string' },
                    translatedText: { type: 'string' },
                    emotion: { type: 'string' },
                },
            },
        },
    },
});

export const IMAGE_PROMPT_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['dynamicPositiveTags'],
    properties: {
        dynamicPositiveTags: { type: 'string' },
    },
});

function contentToText(value) {
    if (typeof value === 'string') return value;
    if (!Array.isArray(value)) return '';
    return value.map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item?.text === 'string') return item.text;
        if (typeof item?.text?.value === 'string') return item.text.value;
        if (typeof item?.content === 'string') return item.content;
        return '';
    }).filter(Boolean).join('\n');
}

/** 兼容 OpenAI choices、Responses output、message/content 和常见自定义包裹。 */
function unwrapStructuredResponse(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return { messages: value };
    if (Array.isArray(value.messages) || Array.isArray(value.segments) || typeof value.dynamicPositiveTags === 'string') return value;
    const candidates = [
        value.choices?.[0]?.message?.content,
        value.choices?.[0]?.text,
        value.message?.content,
        value.message?.text,
        value.output_text,
        value.content,
        value.response,
        value.result,
    ];
    for (const candidate of candidates) {
        const text = contentToText(candidate);
        if (text) return text;
        if (candidate && typeof candidate === 'object') {
            const nested = unwrapStructuredResponse(candidate);
            if (nested && nested !== candidate) return nested;
        }
    }
    if (Array.isArray(value.output)) {
        const text = value.output.map((item) => contentToText(item?.content || item)).filter(Boolean).join('\n');
        if (text) return text;
    }
    return value;
}

/** 从模型返回中稳健抽取 JSON；失败时保留解析位置而不是只报“没有内容”。 */
export function extractJsonObject(value) {
    const current = unwrapStructuredResponse(value);
    if (current && typeof current === 'object') return current;
    const text = String(current || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!text) throw new Error('模型没有返回可解析内容');
    const candidates = [];
    for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(match[1].trim());
    candidates.push(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
    const objectStart = text.indexOf('{');
    const objectEnd = text.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) candidates.push(text.slice(objectStart, objectEnd + 1));
    const arrayStart = text.indexOf('[');
    const arrayEnd = text.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(text.slice(arrayStart, arrayEnd + 1));
    let lastError = null;
    for (const candidate of [...new Set(candidates)]) {
        try {
            const parsed = JSON.parse(candidate);
            return Array.isArray(parsed) ? { messages: parsed } : parsed;
        } catch (error) {
            lastError = error;
        }
    }
    throw new Error(`模型返回内容不是有效 JSON：${lastError?.message || '无法定位结构'}`);
}
