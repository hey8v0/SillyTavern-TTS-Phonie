import test from 'node:test';
import assert from 'node:assert/strict';

import { createPhoneMetadata } from '../src/phone/chat-records.js';

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
