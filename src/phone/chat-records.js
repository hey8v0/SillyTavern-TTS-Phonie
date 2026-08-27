import { MESSAGE_KINDS, SCHEMA_VERSION } from '../core/constants.js';
import { createId } from '../core/id.js';

export function createPhoneMetadata(value = {}) {
    return {
        schemaVersion: SCHEMA_VERSION,
        messages: Array.isArray(value.messages) ? value.messages : [],
        calls: Array.isArray(value.calls) ? value.calls : [],
        pendingUserMessageIds: Array.isArray(value.pendingUserMessageIds)
            ? value.pendingUserMessageIds
                .filter((id) => id !== null && id !== undefined && id !== '')
                .map((id) => String(id))
            : [],
        updatedAt: Number(value.updatedAt) || 0,
    };
}

export function createPhoneMessage({
    direction,
    author,
    originalText,
    translationText = '',
    kind = MESSAGE_KINDS.TEXT,
    emotion = 'neutral',
    status = 'delivered',
    amount = null,
    note = '',
    attachmentName = '',
    description = '',
    replyToId = null,
    replySnapshot = null,
}) {
    return {
        id: createId('message'),
        direction,
        author,
        originalText: String(originalText || '').trim(),
        translationText: String(translationText || '').trim(),
        kind,
        emotion,
        status,
        amount: Number.isFinite(Number(amount)) ? Number(amount) : null,
        note: String(note || '').trim(),
        attachmentName: String(attachmentName || '').trim(),
        description: String(description || '').trim(),
        replyToId: replyToId ? String(replyToId) : null,
        replySnapshot: replySnapshot && typeof replySnapshot === 'object' ? { ...replySnapshot } : null,
        originalType: null,
        originalContent: '',
        recalledAt: null,
        createdAt: Date.now(),
        audioCacheKey: null,
    };
}

export function recallPhoneMessage(message, recalledAt = Date.now()) {
    if (!message || message.kind === MESSAGE_KINDS.RECALLED || message.direction !== 'outgoing') return message;
    return {
        ...message,
        originalType: message.kind,
        originalContent: message.originalText,
        kind: MESSAGE_KINDS.RECALLED,
        originalText: '你撤回了一条消息',
        translationText: '',
        status: 'recalled',
        recalledAt,
    };
}

export function createCallRecord({
    contactName,
    startedAt,
    endedAt,
    summary = '',
    direction = 'outgoing',
    outcome = 'completed',
    messageIds = [],
    participants = [],
}) {
    return {
        id: createId('call'),
        contactName,
        startedAt,
        endedAt,
        summary: String(summary || '').trim(),
        direction,
        outcome,
        messageIds: Array.isArray(messageIds) ? [...new Set(messageIds.map(String).filter(Boolean))] : [],
        participants: Array.isArray(participants)
            ? participants.map((entry) => ({
                id: String(entry?.id || ''),
                name: String(entry?.name || '').trim(),
                avatarUrl: String(entry?.avatarUrl || ''),
            })).filter((entry) => entry.name)
            : [],
    };
}
