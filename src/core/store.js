function clone(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value));
}

export function createStore(initialState) {
    let state = clone(initialState);
    const listeners = new Set();

    function notify(previousState) {
        for (const listener of listeners) {
            listener(state, previousState);
        }
    }

    return Object.freeze({
        getState() {
            return state;
        },

        setState(nextState) {
            const previousState = state;
            state = typeof nextState === 'function'
                ? nextState(state)
                : { ...state, ...nextState };
            notify(previousState);
            return state;
        },

        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        snapshot() {
            return clone(state);
        },
    });
}
