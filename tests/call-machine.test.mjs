import test from 'node:test';
import assert from 'node:assert/strict';

import { CALL_STATES } from '../src/core/constants.js';
import { CallMachine } from '../src/phone/call-machine.js';

test('call machine follows a valid outgoing call path', () => {
    const machine = new CallMachine();
    machine.transition(CALL_STATES.DIALING);
    machine.transition(CALL_STATES.RINGING);
    machine.transition(CALL_STATES.CONNECTED);
    machine.transition(CALL_STATES.GENERATING);
    machine.transition(CALL_STATES.SPEAKING);
    machine.transition(CALL_STATES.CONNECTED);
    machine.transition(CALL_STATES.ENDED);
    assert.equal(machine.state, CALL_STATES.ENDED);
    assert.ok(machine.startedAt);
});

test('incoming calls can ring, be accepted, and start timing at connection', () => {
    const machine = new CallMachine();
    machine.transition(CALL_STATES.RINGING);
    assert.equal(machine.startedAt, null);
    machine.transition(CALL_STATES.CONNECTED);
    assert.ok(machine.startedAt);
});

test('a second call receives a fresh connection timer', async () => {
    const machine = new CallMachine();
    machine.transition(CALL_STATES.DIALING);
    machine.transition(CALL_STATES.CONNECTED);
    const firstStartedAt = machine.startedAt;
    machine.transition(CALL_STATES.ENDED);
    await new Promise((resolve) => setTimeout(resolve, 2));
    machine.transition(CALL_STATES.RINGING);
    assert.equal(machine.startedAt, null);
    machine.transition(CALL_STATES.CONNECTED);
    assert.ok(machine.startedAt > firstStartedAt);
});

test('call machine rejects impossible transitions', () => {
    const machine = new CallMachine();
    assert.throws(() => machine.transition(CALL_STATES.SPEAKING), /Invalid call transition/);
});
