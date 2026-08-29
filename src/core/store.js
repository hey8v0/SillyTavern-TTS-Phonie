function clone(value) {
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch {
            // 回退到 JSON 克隆。
        }
    }
    return JSON.parse(JSON.stringify(value));
}

/**
 * 极简响应式状态容器：与 SillyTavern 解耦，可在浏览器与 Node 测试中复用。
 */
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
