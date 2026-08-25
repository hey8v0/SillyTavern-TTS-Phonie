import { createPhoenApp } from './src/app.js';

let appPromise = null;

export async function init() {
    if (!appPromise) {
        appPromise = createPhoenApp().catch((error) => {
            appPromise = null;
            console.error('[Phoen] Initialization failed.', error);
            throw error;
        });
    }

    return appPromise;
}
