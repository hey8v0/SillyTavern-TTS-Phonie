import { PHONE_REPLY_SCHEMA } from '../core/constants.js';
import { DEFAULT_PHONE_PROMPT_PRESET, assemblePhonePromptMessages } from './prompt-preset.js';

function compactHistory(history, limit = 10) {
    return history
        .slice(-limit)
        .map((message) => ({
            speaker: message.direction === 'outgoing' ? 'user' : 'character',
            type: String(message.kind || 'text'),
            text: message.kind === 'recalled'
                ? '[原消息已撤回]'
                : String(message.originalText || '').slice(0, 600),
            amount: message.amount ?? undefined,
            note: message.note || undefined,
            replyTo: message.replySnapshot?.content || undefined,
        }));
}

export function resolveCallTurnRange(callLength = 'normal', participantCount = 1) {
    if (Number(participantCount) > 1) return { minimum: 20, maximum: 28, label: '多人通话' };
    if (callLength === 'short') return { minimum: 4, maximum: 6, label: '短来电' };
    if (callLength === 'long') return { minimum: 12, maximum: 18, label: '长来电' };
    return { minimum: 7, maximum: 10, label: '普通来电' };
}

export function buildPhoneReplyMessages({
    contactName,
    userName = 'User',
    sourceLanguage,
    targetLanguage,
    history = [],
    callMode = false,
    preset = DEFAULT_PHONE_PROMPT_PRESET,
    storyContext = '',
    participants = [],
    topic = '',
    strategy = 'context',
    scriptMode = false,
    callLength = 'normal',
}) {
    const compact = compactHistory(history);
    const historyMessages = compact.map((message) => ({
        role: message.speaker === 'user' ? 'user' : 'assistant',
        content: JSON.stringify(message),
    }));
    const latestInput = [...history].reverse().find((message) => message.direction === 'outgoing')?.originalText || '';
    const participantNames = participants.map((entry) => String(entry?.name || entry || '').trim()).filter(Boolean);
    const groupChatMode = !callMode && participantNames.length > 1;
    const turnRange = resolveCallTurnRange(callLength, participantNames.length);
    const messages = assemblePhonePromptMessages({
        preset,
        history: historyMessages,
        variables: {
            character: contactName,
            user: userName,
            sourceLanguage,
            targetLanguage,
            mode: callMode ? '电话通话' : groupChatMode ? '多人手机群聊' : '手机私信',
            history: JSON.stringify(compact),
            input: latestInput,
            format: callMode
                ? scriptMode
                    ? `一次写完整段电话内容。${turnRange.label}必须包含 ${turnRange.minimum} 到 ${turnRange.maximum} 段自然口语。每段 speaker 必须从这些参与者中选择：${participantNames.join('、') || contactName}。不要让用户逐轮输入。`
                    : `只写一轮自然、适合直接朗读的简短口语；speaker 必须从这些参与者中选择：${participantNames.join('、') || contactName}。`
                : groupChatMode
                    ? `返回一个 JSON 对象，包含 turns 和 action。turns 必须有 2 到 8 条，每条都包含 speaker、originalText、translationText 与 emotion；speaker 只能从这些参与者中选择：${participantNames.join('、')}。角色可以连续发送多条短消息，也可以多人交替，但不要代替用户发言，不要强迫所有角色都出现，不要把多条手机消息合并成长段。action 固定为 reply。`
                    : '返回一个 JSON 对象，包含 originalText、translationText、emotion 与 action。像私人聊天消息一样简短自然地回复；除非理解语音必须，否则不要写舞台指示。',
            context: storyContext,
            participants: participantNames.join('、') || contactName,
            topic: topic || '根据当前剧情自然继续',
            strategy: strategy === 'topic' ? '优先围绕用户指定主题' : '根据酒馆上下文自主规划',
        },
    });
    if (groupChatMode) {
        messages.unshift({
            role: 'system',
            content: [
                '[多人手机群聊编排]',
                `群聊参与者：${participantNames.join('、')}`,
                '一次回复可以由一位角色连续发出多条短消息，也可以由多位角色自然接话。',
                '只允许群聊参与者发言；绝对不要替用户补写消息，也不要为了轮流而强迫所有角色出现。',
                '输出 2 到 8 条 turns，保持手机聊天的短句、停顿和消息颗粒感。',
            ].join('\n'),
        });
    }
    if (callMode) {
        messages.unshift({
            role: 'system',
            content: [
                '[通话编排上下文]',
                `参与者：${participantNames.join('、') || contactName}`,
                `编排方式：${strategy === 'topic' ? '优先围绕用户指定主题' : '根据酒馆上下文自主规划'}`,
                `通话主题：${topic || '根据当前剧情自然继续'}`,
                scriptMode ? `输出一段可连续播放的完整电话或电话留言。turns 必须有 ${turnRange.minimum} 到 ${turnRange.maximum} 段，每段都包含 speaker、originalText、translationText 与 emotion；同时输出简短 title 和 summary，供通话记录显示主题。禁止返回空对象、空数组、空台词或省略字段。` : '',
                storyContext ? `[酒馆剧情、世界书与摘要]\n${storyContext}` : '',
                '以上内容只用于保持剧情连续性，不要逐字复述。',
            ].filter(Boolean).join('\n'),
        });
    }
    return messages;
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
        const turns = Array.isArray(data?.turns)
            ? data.turns.slice(0, 28).map((turn) => ({
                speaker: String(turn?.speaker || '').trim(),
                originalText: String(turn?.originalText || '').trim(),
                translationText: String(turn?.translationText || '').trim(),
                emotion: PHONE_REPLY_SCHEMA.properties.emotion.enum.includes(turn?.emotion) ? turn.emotion : 'neutral',
            })).filter((turn) => turn.speaker && turn.originalText)
            : [];
        if (turns.length) {
            return {
                ...turns[0],
                turns,
                action: data.action === 'end_call' ? 'end_call' : 'reply',
                title: String(data.title || '').trim(),
                summary: String(data.summary || '').trim(),
            };
        }
        const originalText = String(data?.originalText || '').trim();
        if (!originalText) throw new Error('Missing originalText');
        const speaker = String(data.speaker || '').trim();

        return {
            originalText,
            translationText: String(data.translationText || '').trim(),
            emotion: PHONE_REPLY_SCHEMA.properties.emotion.enum.includes(data.emotion) ? data.emotion : 'neutral',
            action: PHONE_REPLY_SCHEMA.properties.action.enum.includes(data.action) ? data.action : 'reply',
            ...(speaker ? { speaker } : {}),
        };
    } catch (error) {
        const fallback = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const looksStructured = /^[{[]/.test(fallback);
        if (!fallback || looksStructured) {
            throw new Error('模型没有返回可播放的电话内容', { cause: error });
        }
        return {
            originalText: fallback,
            translationText: targetLanguage ? '' : fallback,
            emotion: 'neutral',
            action: 'reply',
        };
    }
}
export function buildContinuityPrompt({ contactName, messages = [], calls = [], maxChars = 1800 }) {
    if (messages.length === 0 && calls.length === 0) return '';

    const recentMessages = messages.slice(-6).map((message) => {
        const speaker = message.direction === 'outgoing' ? '用户' : contactName;
        return `${speaker}: ${String(message.originalText || '').replace(/\s+/g, ' ').slice(0, 220)}`;
    });
    const recentCall = calls.at(-1)?.summary
        ? `最近一次通话：${String(calls.at(-1).summary).slice(0, 360)}`
        : '';

    return [
        '[Phonie 私人通信连续性]',
        `用户与${contactName}在故事世界中拥有一条私人手机频道。`,
        ...recentMessages,
        recentCall,
        '将这些手机事件视为已经发生的连续剧情，不要逐字复述本段。',
    ].filter(Boolean).join('\n').slice(0, maxChars);
}
