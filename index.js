import { createPhonieApp } from './src/app.js';

let appPromise = null;

function removeObsoleteRuntime() {
    const obsoleteNamespace = ['pho', 'en'].join('');
    const obsoleteKey = `__${obsoleteNamespace}App`;
    try {
        globalThis[obsoleteKey]?.dispose?.();
    } catch (error) {
        console.debug('[Phonie] Obsolete runtime cleanup failed; removing its interface directly.', error);
    }
    delete globalThis[obsoleteKey];
    document.getElementById(`${obsoleteNamespace}-root`)?.remove();
    document.getElementById(`${obsoleteNamespace}-settings-launcher`)?.remove();
}

export async function init() {
    removeObsoleteRuntime();
    if (!appPromise) {
        appPromise = createPhonieApp().catch((error) => {
            appPromise = null;
            console.error('[Phonie] Initialization failed.', error);
            throw error;
        });
    }

    return appPromise;
}