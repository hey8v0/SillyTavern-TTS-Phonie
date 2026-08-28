import { MESSAGE_KINDS, SCHEMA_VERSION } from '../core/constants.js';
import { createId } from '../core/id.js';

export function createConversationId(participants = []) {
    const ids = [...new Set((participants || []).map((entry) => String(entry?.id || entry || '').trim()).filter(Boolean))].sort();
    return `${ids.length > 1 ? 'group' : 'private'}:${ids.map(encodeURIComponent).join('|') || 'unknown'}`;
}

export function createConversation(value = {}, participants = []) {
    const participantIds = [...new Set((value.participantIds || participants || [])
        .map((entry) => String(entry?.id || entry || '').trim()).filter(Boolean))].sort();
    const id = String(value.id || createConversationId(participantIds));
    return {
        id,
        type: participantIds.length > 1 ? 'group' : 'private',
        participantIds,
        title: String(value.title || '').trim().slice(0, 80),
        messages: Array.isArray(value.messages) ? value.messages : [],
        pendingUserMessageIds: Array.isArray(value.pendingUserMessageIds)
            ? value.pendingUserMessageIds.map(String).filter(Boolean) : [],
        settings: value.settings && typeof value.settings === 'object' ? { ...value.settings } : {},
        updatedAt: Number(value.updatedAt) || 0,
    };
}

export function createPhoneMetadata(value = {}) {
    const conversations = {};
    for (const [id, conversation] of Object.entries(value.conversations || {})) {
        conversations[id] = createConversation({ ...conversation, id });
    }
    return {
        schemaVersion: SCHEMA_VERSION,
        messages: Array.isArray(value.messages) ? value.messages : [],
        calls: Array.isArray(value.calls) ? value.calls : [],
        pendingUserMessageIds: Array.isArray(value.pendingUserMessageIds)
            ? value.pendingUserMessageIds
                .filter((id) => id !== null && id !== undefined && id !== '')
                .map((id) => String(id))
            : [],
        conversations,
        activeConversationId: String(value.activeConversationId || ''),
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
    imageUrl = '',
    replyToId = null,
    replySnapshot = null,
    channel = 'chat',
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
        imageUrl: String(imageUrl || ''),
        replyToId: replyToId ? String(replyToId) : null,
        replySnapshot: replySnapshot && typeof replySnapshot === 'object' ? { ...replySnapshot } : null,
        channel: channel === 'call' ? 'call' : 'chat',
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
    title = '',
    summary = '',
    direction = 'outgoing',
    outcome = 'completed',
    messageIds = [],
    messages = [],
    participants = [],
}) {
    return {
        id: createId('call'),
        contactName,
        startedAt,
        endedAt,
        title: String(title || '').trim().slice(0, 80),
        summary: String(summary || '').trim(),
        direction,
        outcome,
        messageIds: Array.isArray(messageIds) ? [...new Set(messageIds.map(String).filter(Boolean))] : [],
        messages: Array.isArray(messages)
            ? messages.map((message) => ({ ...message, channel: 'call' }))
            : [],
        participants: Array.isArray(participants)
            ? participants.map((entry) => ({
                id: String(entry?.id || ''),
                name: String(entry?.name || '').trim(),
                avatarUrl: String(entry?.avatarUrl || ''),
            })).filter((entry) => entry.name)
            : [],
    };
}
