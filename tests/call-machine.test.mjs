import test from 'node:test';
import assert from 'node:assert/strict';

import { CALL_STATES } from '../src/core/constants.js';
import { CallMachine } from '../src/phone/call-machine.js';

test('call machine follows a valid outgoing call path', () => {
    const machine = new CallMachine();
    machine.transition(CALL_STATES.DIALING);
    machine.transition(CALL_STATES.CONNECTED);
    machine.transition(CALL_STATES.GENERATING);
    machine.transition(CALL_STATES.SPEAKING);
    machine.transition(CALL_STATES.CONNECTED);
    machine.transition(CALL_STATES.ENDED);
    assert.equal(machine.state, CALL_STATES.ENDED);
    assert.ok(machine.startedAt);
});

test('call machine rejects impossible transitions', () => {
    const machine = new CallMachine();
    assert.throws(() => machine.transition(CALL_STATES.SPEAKING), /Invalid call transition/);
});
