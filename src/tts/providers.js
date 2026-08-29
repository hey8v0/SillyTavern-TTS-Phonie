import { ENGINES } from '../core/constants.js';
import { PHONIE_SECRET_KINDS, revealPhonieSecret } from '../integrations/secrets.js';
import { normalizeEmotion } from './emotion.js';

const MINIMAX_PLUGIN_BASE = '/api/plugins/tts-minimax-resources';

function normalizeConfig(settings, providerId) {
    return settings?.ttsProviderSettings?.[providerId] || {};
}

/**
 * 六个引擎的合成中心。
 * - edge：浏览器 Web Speech（无需配置，不产生可缓存 blob）。
 * - http-json：IndexTTS2 / GPT-SoVITS / VoxCPM2 的 JSON HTTP 接口。
 * - rest：ElevenLabs REST。
 * - server-plugin：MiniMax 走随项目提供的酒馆服务插件。
 */
export class ProviderCenter {
    #bridge;
    #audio = null;

    constructor({ bridge }) {
        this.#bridge = bridge;
    }

    getActiveLabel() {
        const id = this.#bridge.getSettings().ttsActiveProvider;
        return ENGINES.find((engine) => engine.id === id)?.name || 'Edge TTS';
    }

    async synthesize({ text, speaker = '', language = 'zh-CN', providerId, emotion = '' } = {}) {
        const settings = this.#bridge.getSettings();
        const id = providerId || settings.ttsActiveProvider;
        const engine = ENGINES.find((entry) => entry.id === id);
        if (!engine) throw new Error('未知语音引擎');
        const config = normalizeConfig(settings, id);
        const cleanText = String(text || '').trim();
        if (!cleanText) throw new Error('没有可朗读的文本');

        if (engine.kind === 'webspeech') {
            return { blob: null, speech: { text: cleanText, lang: config.lang || language, voice: config.voice || '' }, providerLabel: engine.name };
        }

        if (engine.kind === 'http-json') {
            const baseUrl = String(config.baseUrl || '').trim().replace(/\/+$/, '');
            if (!baseUrl) throw new Error(`${engine.name} 缺少服务地址`);
            const voice = String(config.voice || speaker || '').trim();
            const response = await fetch(`${baseUrl}/synthesize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: cleanText, voice, emotion, language }),
            });
            if (!response.ok) throw new Error(`${engine.name} 合成失败（HTTP ${response.status}）`);
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const data = await response.json();
                const base64 = data.audio || data.audio_base64 || data.data || '';
                if (!base64) throw new Error(`${engine.name} 没有返回音频`);
                const bytes = Uint8Array.from(atob(base64.replace(/^data:audio\/[^;]+;base64,/, '')), (char) => char.charCodeAt(0));
                return { blob: new Blob([bytes], { type: 'audio/wav' }), speech: null, providerLabel: engine.name };
            }
            return { blob: await response.blob(), speech: null, providerLabel: engine.name };
        }

        if (engine.kind === 'rest') {
            const apiKey = await revealPhonieSecret(PHONIE_SECRET_KINDS.ELEVENLABS, config.secretId);
            const voiceId = String(config.voice || speaker || '').trim();
            if (!config.secretId || !apiKey) throw new Error('ElevenLabs 缺少 Secrets 密钥');
            if (!voiceId) throw new Error('ElevenLabs 缺少音色 ID');
            const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
                body: JSON.stringify({ text: cleanText, model_id: 'eleven_multilingual_v2' }),
            });
            if (!response.ok) throw new Error(`ElevenLabs 合成失败（HTTP ${response.status}）`);
            return { blob: await response.blob(), speech: null, providerLabel: engine.name };
        }

        if (engine.kind === 'server-plugin') {
            const response = await fetch(`${MINIMAX_PLUGIN_BASE}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: cleanText,
                    voiceId: String(config.voice || speaker || '').trim(),
                    model: String(config.model || 'speech-2.8-hd').trim(),
                    apiHost: String(config.apiHost || 'https://api.minimax.io').trim(),
                    emotion: normalizeEmotion(emotion),
                    format: 'mp3',
                }),
            });
            if (!response.ok) {
                const detail = await response.json().catch(() => null);
                if (response.status === 404) throw new Error('缺少 MiniMax 服务插件');
                throw new Error(detail?.error || `MiniMax 合成失败（HTTP ${response.status}）`);
            }
            return { blob: await response.blob(), speech: null, providerLabel: engine.name };
        }

        throw new Error(`${engine.name} 暂不支持`);
    }

    async checkProvider(providerId) {
        const settings = this.#bridge.getSettings();
        const engine = ENGINES.find((entry) => entry.id === providerId);
        if (!engine) throw new Error('未知语音引擎');
        const config = normalizeConfig(settings, providerId);
        if (engine.kind === 'webspeech') {
            if (typeof globalThis.speechSynthesis === 'undefined') throw new Error('当前浏览器不支持语音合成');
            return true;
        }
        if (engine.kind === 'http-json') {
            if (!String(config.baseUrl || '').trim()) throw new Error(`${engine.name} 缺少服务地址`);
            return true;
        }
        if (engine.kind === 'rest') {
            if (!String(config.secretId || '').trim()) throw new Error('ElevenLabs 缺少 Secrets 密钥');
            if (!String(config.voice || '').trim()) throw new Error('ElevenLabs 缺少音色 ID');
            await revealPhonieSecret(PHONIE_SECRET_KINDS.ELEVENLABS, config.secretId);
            return true;
        }
        if (engine.kind === 'server-plugin') {
            const response = await fetch(`${MINIMAX_PLUGIN_BASE}/catalog`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiHost: String(config.apiHost || 'https://api.minimax.io').trim() }),
            });
            if (!response.ok) {
                const detail = await response.json().catch(() => null);
                if (response.status === 404) throw new Error('缺少 MiniMax 服务插件或插件未就绪');
                throw new Error(detail?.error || `MiniMax 连接检测失败（HTTP ${response.status}）`);
            }
            return true;
        }
        throw new Error('无法检测该引擎');
    }

    /** 同步 MiniMax 模型与账户音色目录（仅 MiniMax 支持）。 */
    async syncResources(providerId) {
        if (providerId !== 'minimax') throw new Error('只有 MiniMax 支持资源同步');
        const settings = this.#bridge.getSettings();
        const config = normalizeConfig(settings, providerId);
        const response = await fetch(`${MINIMAX_PLUGIN_BASE}/catalog`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiHost: String(config.apiHost || 'https://api.minimax.io').trim() }),
        });
        if (!response.ok) {
            const detail = await response.json().catch(() => null);
            if (response.status === 404) throw new Error('缺少 MiniMax 服务插件');
            throw new Error(detail?.error || `MiniMax 资源同步失败（HTTP ${response.status}）`);
        }
        const catalog = await response.json();
        return {
            models: [...(Array.isArray(catalog?.speechModels) ? catalog.speechModels : []), ...(Array.isArray(catalog?.models) ? catalog.models.map((entry) => ({ id: entry?.id, name: entry?.name, note: '模型目录' })) : [])],
            voices: Array.isArray(catalog?.voices) ? catalog.voices.map((entry) => ({ id: entry?.voice_id, name: entry?.name || entry?.voice_id })) : [],
            warnings: catalog?.warnings || [],
        };
    }

    updateProvider(providerId, patch) {
        const settings = this.#bridge.getSettings();
        const providerSettings = { ...(settings.ttsProviderSettings || {}) };
        providerSettings[providerId] = { ...(providerSettings[providerId] || {}), ...patch };
        return this.#bridge.updateSettings({ ttsProviderSettings: providerSettings });
    }
}

/** 单一音频焦点控制器：电话 > QQ 语音 > 正文播放器。 */
export class AudioFocusController {
    #audio = null;
    #currentOwner = null;

    get element() {
        if (!this.#audio) {
            this.#audio = new Audio();
            this.#audio.preload = 'auto';
        }
        return this.#audio;
    }

    async playBlob(blob, { owner = 'phone' } = {}) {
        this.stop();
        const url = URL.createObjectURL(blob);
        this.element.src = url;
        this.element.onended = () => URL.revokeObjectURL(url);
        this.#currentOwner = owner;
        try {
            await this.element.play();
        } catch (error) {
            URL.revokeObjectURL(url);
            throw error;
        }
    }

    async playSpeech(text, { lang = 'zh-CN', owner = 'phone' } = {}) {
        if (typeof globalThis.speechSynthesis === 'undefined') throw new Error('当前浏览器不支持语音合成');
        this.stop();
        globalThis.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        this.#currentOwner = owner;
        return new Promise((resolve, reject) => {
            utterance.onend = () => resolve();
            utterance.onerror = (event) => (event.error === 'interrupted' || event.error === 'canceled' ? resolve() : reject(new Error('语音合成失败')));
            globalThis.speechSynthesis.speak(utterance);
        });
    }

    stop() {
        try {
            this.element?.pause();
        } catch {
            // 忽略。
        }
        if (typeof globalThis.speechSynthesis !== 'undefined') globalThis.speechSynthesis.cancel();
        this.#currentOwner = null;
    }

    dispose() {
        this.stop();
        this.#audio = null;
    }
}
