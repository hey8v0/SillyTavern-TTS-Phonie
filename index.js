import { TTS_Mobile } from './src/ui/mobile-ui-v3.js';

let initialized = false;

export async function init() {
    if (initialized && document.getElementById('tts-mobile-root')) return TTS_Mobile;
    initialized = true;
    TTS_Mobile.init();
    return TTS_Mobile;
}
