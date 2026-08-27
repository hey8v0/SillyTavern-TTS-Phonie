import test from 'node:test';
import assert from 'node:assert/strict';

import { createPhoneMessage, createPhoneMetadata, recallPhoneMessage } from '../src/phone/chat-records.js';

test('phone metadata preserves the pending multi-message reply queue', () => {
    const metadata = createPhoneMetadata({
        messages: [{ id: 'message-a' }],
        calls: [],
        pendingUserMessageIds: ['message-a', 22, '', null],
    });

    assert.deepEqual(metadata.pendingUserMessageIds, ['message-a', '22']);
});

test('legacy phone metadata receives an empty pending queue', () => {
    assert.deepEqual(createPhoneMetadata({ messages: [], calls: [] }).pendingUserMessageIds, []);
});

test('rich phone messages preserve transfer and reply metadata', () => {
    const message = createPhoneMessage({
        direction: 'outgoing',
        author: 'Nana',
        originalText: '转账 ¥20.00',
        kind: 'transfer',
        amount: 20,
        note: '早餐',
        replyToId: 'message-a',
        replySnapshot: { sender: 'Aoi', type: 'text', content: '早上好' },
    });
    assert.equal(message.amount, 20);
    assert.equal(message.replySnapshot.content, '早上好');
});

test('recall is a state change that keeps original content', () => {
    const message = createPhoneMessage({
        direction: 'outgoing',
        author: 'Nana',
        originalText: '撤回前的内容',
    });
    const recalled = recallPhoneMessage(message, 123);
    assert.equal(recalled.kind, 'recalled');
    assert.equal(recalled.originalContent, '撤回前的内容');
    assert.equal(recalled.recalledAt, 123);
});
