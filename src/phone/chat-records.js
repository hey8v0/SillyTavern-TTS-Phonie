import { MESSAGE_KINDS, SCHEMA_VERSION } from '../core/constants.js';
import { createId } from '../core/id.js';

export function createPhoneMetadata(value = {}) {
    return {
        schemaVersion: SCHEMA_VERSION,
        messages: Array.isArray(value.messages) ? value.messages : [],
        calls: Array.isArray(value.calls) ? value.calls : [],
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
        createdAt: Date.now(),
        audioCacheKey: null,
    };
}

export function createCallRecord({ contactName, startedAt, endedAt, summary = '', direction = 'outgoing', outcome = 'completed' }) {
    return {
        id: createId('call'),
        contactName,
        startedAt,
        endedAt,
        summary: String(summary || '').trim(),
        direction,
        outcome,
    };
}
