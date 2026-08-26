import { createPhonieApp } from './src/app.js';

let appPromise = null;

function removeObsoleteRuntime() {
    try {
        globalThis.__phonieApp?.dispose?.();
    } catch (error) {
        console.debug('[Phonie] Previous runtime cleanup failed; continuing with a clean mount.', error);
    }
    document.getElementById('phonie-root')?.remove();
    document.getElementById('phonie-orb')?.remove();
    document.getElementById('phonie-settings-launcher')?.remove();
    document.getElementById('phonie-wand-menu-item')?.remove();
}

export async function init() {
    if (!appPromise) {
        removeObsoleteRuntime();
        appPromise = createPhonieApp().catch((error) => {
            appPromise = null;
            console.error('[Phonie] Initialization failed.', error);
            throw error;
        });
    }

    return appPromise;
}
