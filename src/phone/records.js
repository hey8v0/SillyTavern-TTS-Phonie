import { createId } from '../core/id.js';

/** 生成一条 QQ / 通话消息。 */
export function createMessage(partial = {}) {
    return {
        id: partial.id || createId('msg'),
        direction: partial.direction || 'incoming',
        author: String(partial.author || ''),
        kind: partial.kind || 'text',
        originalText: String(partial.originalText || ''),
        translatedText: String(partial.translatedText || ''),
        emotion: String(partial.emotion || 'neutral'),
        amount: Number.isFinite(Number(partial.amount)) ? Number(partial.amount) : undefined,
        note: String(partial.note || ''),
        stickerName: String(partial.stickerName || ''),
        imageDescription: String(partial.imageDescription || ''),
        imageStatus: partial.imageStatus,
        imageUrl: String(partial.imageUrl || ''),
        replyToId: partial.replyToId || '',
        replySnapshot: partial.replySnapshot || null,
        channel: partial.channel || 'chat',
        createdAt: Number(partial.createdAt) || Date.now(),
        audioStatus: partial.audioStatus || 'idle',
        isPlaying: false,
        recalledAt: partial.recalledAt || null,
    };
}

/** 撤回是状态变化，保留原始内容。 */
export function recallMessage(message) {
    return { ...message, kind: 'recalled', recalledAt: Date.now() };
}

/** 生成一条通话记录。 */
export function createCallRecord(partial = {}) {
    return {
        id: partial.id || createId('call'),
        contactName: String(partial.contactName || ''),
        direction: partial.direction || 'outgoing',
        outcome: partial.outcome || 'completed',
        title: String(partial.title || ''),
        summary: String(partial.summary || ''),
        startedAt: Number(partial.startedAt) || Date.now(),
        endedAt: Number(partial.endedAt) || Date.now(),
        participants: Array.isArray(partial.participants) ? partial.participants : [],
        messageIds: Array.isArray(partial.messageIds) ? partial.messageIds : [],
        messages: Array.isArray(partial.messages) ? partial.messages : [],
    };
}
