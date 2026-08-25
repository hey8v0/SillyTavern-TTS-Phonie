import { PHONE_REPLY_SCHEMA } from '../core/constants.js';
import { DEFAULT_PHONE_PROMPT_PRESET, assemblePhonePromptMessages } from './prompt-preset.js';

function compactHistory(history, limit = 10) {
    return history
        .slice(-limit)
        .map((message) => ({
            speaker: message.direction === 'outgoing' ? 'user' : 'character',
            text: String(message.originalText || '').slice(0, 600),
        }));
}

export function buildPhoneReplyMessages({
    contactName,
    userName = 'User',
    sourceLanguage,
    targetLanguage,
    history = [],
    callMode = false,
    preset = DEFAULT_PHONE_PROMPT_PRESET,
}) {
    const compact = compactHistory(history);
    const historyMessages = compact.map((message) => ({
        role: message.speaker === 'user' ? 'user' : 'assistant',
        content: message.text,
    }));
    const latestInput = [...history].reverse().find((message) => message.direction === 'outgoing')?.originalText || '';
    return assemblePhonePromptMessages({
        preset,
        history: historyMessages,
        variables: {
            character: contactName,
            user: userName,
            sourceLanguage,
            targetLanguage,
            mode: callMode ? 'live phone call（电话通话）' : 'private phone chat（手机私信）',
            history: JSON.stringify(compact),
            input: latestInput,
            format: callMode
                ? 'Use one natural spoken turn concise enough to say aloud.'
                : 'Reply like a private message; avoid stage directions unless needed to understand the voice.',
        },
    });
}

export function buildPhoneReplyPrompt(options) {
    return buildPhoneReplyMessages(options)
        .map((message) => `[${message.role}]\n${message.content}`)
        .join('\n\n');
}

function unwrapPhoneReply(value) {
    let current = value;
    for (let depth = 0; depth < 6; depth++) {
        if (typeof current === 'string') {
            const unfenced = current.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
            current = JSON.parse(unfenced);
            continue;
        }
        if (Array.isArray(current)) {
            current = current[0];
            continue;
        }
        if (!current || typeof current !== 'object' || current.originalText) return current;
        if (current.choices?.[0]?.message?.content != null) {
            current = current.choices[0].message.content;
            continue;
        }
        if (Array.isArray(current.messages) && current.messages.length) {
            const last = current.messages.at(-1);
            current = last?.content ?? last;
            continue;
        }
        if (current.content != null) {
            current = current.content;
            continue;
        }
        return current;
    }
    return current;
}

export function parsePhoneReply(value, { targetLanguage = 'zh-CN' } = {}) {
    const raw = typeof value === 'string'
        ? value.trim()
        : JSON.stringify(value ?? '');

    try {
        const data = unwrapPhoneReply(value);
        const originalText = String(data?.originalText || '').trim();
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
        '[Phonie private communication continuity]',
        `The user and ${contactName} have a private phone channel inside the story.`,
        ...recentMessages,
        recentCall,
        'Treat these phone events as established continuity. Do not reproduce this block verbatim.',
    ].filter(Boolean).join('\n').slice(0, maxChars);
}
