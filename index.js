import { TTS_Mobile } from './src/ui/mobile-ui-v3.js';

let initPromise = null;

export function init() {
    if (initPromise) return initPromise;
    initPromise = Promise.resolve()
        .then(() => {
            TTS_Mobile.init();
            return TTS_Mobile;
        })
        .catch((error) => {
            initPromise = null;
            console.error('[Phonie] 初始化失败：', error);
            throw error;
        });
    return initPromise;
}

// 兼容旧版酒馆：1.15 会把 index.js 当普通 ES Module 加载但不支持 manifest hooks，
// 需要模块自启动；1.18+ 会通过 hooks.activate 再调用一次 init()，initPromise 会拦住重复初始化。
void init().catch(() => {});
