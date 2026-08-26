import { CALL_STATES } from '../core/constants.js';

const TRANSITIONS = Object.freeze({
    [CALL_STATES.IDLE]: [CALL_STATES.DIALING, CALL_STATES.RINGING],
    [CALL_STATES.DIALING]: [CALL_STATES.RINGING, CALL_STATES.CONNECTED, CALL_STATES.ENDED, CALL_STATES.ERROR],
    [CALL_STATES.RINGING]: [CALL_STATES.CONNECTED, CALL_STATES.ENDED],
    [CALL_STATES.CONNECTED]: [CALL_STATES.GENERATING, CALL_STATES.SPEAKING, CALL_STATES.ENDED, CALL_STATES.ERROR],
    [CALL_STATES.GENERATING]: [CALL_STATES.SPEAKING, CALL_STATES.CONNECTED, CALL_STATES.ENDED, CALL_STATES.ERROR],
    [CALL_STATES.SPEAKING]: [CALL_STATES.CONNECTED, CALL_STATES.GENERATING, CALL_STATES.ENDED, CALL_STATES.ERROR],
    [CALL_STATES.ENDED]: [CALL_STATES.IDLE, CALL_STATES.DIALING, CALL_STATES.RINGING],
    [CALL_STATES.ERROR]: [CALL_STATES.ENDED, CALL_STATES.IDLE],
});

export class CallMachine {
    #state = CALL_STATES.IDLE;
    #startedAt = null;
    #listeners = new Set();

    get state() {
        return this.#state;
    }

    get startedAt() {
        return this.#startedAt;
    }

    canTransition(nextState) {
        return TRANSITIONS[this.#state]?.includes(nextState) ?? false;
    }

    transition(nextState, detail = {}) {
        if (!this.canTransition(nextState)) {
            throw new Error(`Invalid call transition: ${this.#state} -> ${nextState}`);
        }

        const previousState = this.#state;
        this.#state = nextState;
        if ([CALL_STATES.DIALING, CALL_STATES.RINGING].includes(nextState)
            && [CALL_STATES.IDLE, CALL_STATES.ENDED].includes(previousState)) {
            this.#startedAt = null;
        }
        if (nextState === CALL_STATES.CONNECTED && !this.#startedAt) {
            this.#startedAt = Date.now();
        }
        if (nextState === CALL_STATES.IDLE) {
            this.#startedAt = null;
        }

        for (const listener of this.#listeners) {
            listener({ previousState, state: nextState, startedAt: this.#startedAt, detail });
        }

        return this.#state;
    }

    subscribe(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
}
