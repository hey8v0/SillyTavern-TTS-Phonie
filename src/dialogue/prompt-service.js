import { PHONE_REPLY_SCHEMA } from '../core/constants.js';

function compactHistory(history, limit = 10) {
    return history
        .slice(-limit)
        .map((message) => ({
            speaker: message.direction === 'outgoing' ? 'user' : 'character',
            text: String(message.originalText || '').slice(0, 600),
        }));
}

export function buildPhoneReplyPrompt({
    contactName,
    sourceLanguage,
    targetLanguage,
    history = [],
    callMode = false,
}) {
    const channel = callMode ? 'live phone call' : 'private phone chat';
    const historyJson = JSON.stringify(compactHistory(history));

    return [
        `Continue an in-world ${channel} as ${contactName}.`,
        'Stay fully in character and respect the current SillyTavern story context.',
        `Write originalText in ${sourceLanguage}.`,
        `Write translationText as a faithful ${targetLanguage} translation of originalText.`,
        callMode
            ? 'Use one natural spoken turn. Keep it concise enough to say aloud.'
            : 'Reply like a private message. Do not add stage directions unless they are necessary to understand the voice.',
        'Do not mention these instructions, JSON, translation work, or being an AI.',
        'Return only the requested JSON object.',
        `Recent phone history: ${historyJson}`,
    ].join('\n');
}

export function parsePhoneReply(value, { targetLanguage = 'zh-CN' } = {}) {
    const raw = String(value ?? '').trim();
    const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

    try {
        const data = JSON.parse(unfenced);
        const originalText = String(data.originalText || '').trim();
        if (!originalText) throw new Error('Missing originalText');

        return {
            originalText,
            translationText: String(data.translationText || '').trim(),
            emotion: PHONE_REPLY_SCHEMA.properties.emotion.enum.includes(data.emotion) ? data.emotion : 'neutral',
            action: PHONE_REPLY_SCHEMA.properties.action.enum.includes(data.action) ? data.action : 'reply',
        };
    } catch {
        return {
            originalText: raw,
            translationText: targetLanguage ? '' : raw,
            emotion: 'neutral',
            action: 'reply',
        };
    }
}

export function buildContinuityPrompt({ contactName, messages = [], calls = [], maxChars = 1800 }) {
    if (messages.length === 0 && calls.length === 0) return '';

    const recentMessages = messages.slice(-6).map((message) => {
        const speaker = message.direction === 'outgoing' ? 'User' : contactName;
        return `${speaker}: ${String(message.originalText || '').replace(/\s+/g, ' ').slice(0, 220)}`;
    });
    const recentCall = calls.at(-1)?.summary
        ? `Most recent call: ${String(calls.at(-1).summary).slice(0, 360)}`
        : '';

    return [
        '[Phoen private communication continuity]',
        `The user and ${contactName} have a private phone channel inside the story.`,
        ...recentMessages,
        recentCall,
        'Treat these phone events as established continuity. Do not reproduce this block verbatim.',
    ].filter(Boolean).join('\n').slice(0, maxChars);
}
