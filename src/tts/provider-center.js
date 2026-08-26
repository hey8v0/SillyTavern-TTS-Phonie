import { MINIMAX_EMOTIONS, TTS_PROVIDERS, getProviderDefinition, normalizeProviderSettings } from './provider-catalog.js';
import { resolveCharacterRoute } from '../dialogue/character-directory.js';

const MINIMAX_MODELS = Object.freeze([
    { id: 'speech-2.8-hd', name: 'Speech 2.8 HD' },
    { id: 'speech-2.8-turbo', name: 'Speech 2.8 Turbo' },
    { id: 'speech-2.6-hd', name: 'Speech 2.6 HD' },
    { id: 'speech-2.6-turbo', name: 'Speech 2.6 Turbo' },
    { id: 'speech-02-hd', name: 'Speech 02 HD' },
    { id: 'speech-02-turbo', name: 'Speech 02 Turbo' },
]);

const MINIMAX_VOICES = Object.freeze([
    { id: 'Chinese (Mandarin)_Unrestrained_Young_Man', name: '不羁青年男声' },
    { id: 'Chinese (Mandarin)_Gentleman', name: '沉稳绅士' },
    { id: 'Chinese (Mandarin)_Warm_Bestie', name: '温暖闺蜜' },
    { id: 'Chinese (Mandarin)_Sweet_Lady', name: '甜美女声' },
    { id: 'female-shaonv', name: '少女' },
    { id: 'female-yujie', name: '御姐' },
]);

function joinUrl(base, path) {
    return `${String(base || '').replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;
}

function clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeEmotion(value) {
    const emotion = String(value || '').trim().toLowerCase();
    if (!emotion || ['default', 'neutral', 'warm', 'quiet'].includes(emotion)) return '';
    const normalized = ({ bright: 'happy', tense: 'fearful' })[emotion] || emotion;
    return MINIMAX_EMOTIONS.includes(normalized) ? normalized : '';
}

function toArray(value) {
    return Array.isArray(value) ? value : [];
}

function uniqueResources(items) {
    const seen = new Set();
    return items.filter((item) => {
        if (!item.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    });
}

export function normalizeMiniMaxCatalog(payload = {}) {
    const remoteModels = payload.models;
    const modelItems = [
        ...toArray(payload.speechModels),
        ...toArray(remoteModels?.data),
        ...toArray(remoteModels?.models),
        ...toArray(remoteModels),
    ];
    const voicePayload = payload.voices?.data || payload.voices || {};
    const voiceItems = [
        ...toArray(voicePayload),
        ...toArray(voicePayload.system_voice),
        ...toArray(voicePayload.voice_cloning),
        ...toArray(voicePayload.voice_generation),
        ...toArray(voicePayload.voice_list),
    ];
    return {
        models: uniqueResources(modelItems.map((item) => ({
            id: String(item?.id || item?.model || item?.model_name || ''),
            name: String(item?.name || item?.model_name || item?.id || item?.model || ''),
        }))),
        voices: uniqueResources(voiceItems.map((item) => ({
            id: String(item?.id || item?.voice_id || ''),
            name: String(item?.name || item?.voice_name || item?.voice_id || item?.id || ''),
        }))),
    };
}

function abortableDelay(duration, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('语音生成已取消', 'AbortError'));
            return;
        }
        const timer = setTimeout(resolve, duration);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('语音生成已取消', 'AbortError'));
        }, { once: true });
    });
}

async function responseError(response, fallback) {
    const error = new Error(await readError(response, fallback));
    error.status = response?.status;
    const retryAfter = response?.headers?.get?.('retry-after');
    if (retryAfter) error.retryAfterMs = Number(retryAfter) * 1000;
    return error;
}

function hexToBlob(value, format = 'mp3') {
    const hex = String(value || '').replace(/^0x/i, '').replace(/\s/g, '');
    if (!hex || !/^[\da-f]+$/i.test(hex) || hex.length % 2) throw new Error('MiniMax 返回了无效音频');
    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    return new Blob([bytes], { type: ({ mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac' })[format] || 'application/octet-stream' });
}

async function runtimeModules() {
    const [script, secrets] = await Promise.all([import('/script.js'), import('/scripts/secrets.js')]);
    return { getRequestHeaders: script.getRequestHeaders, secrets };
}

async function readError(response, fallback) {
    const text = await response.text().catch(() => '');
    try {
        const payload = JSON.parse(text);
        return String(payload?.detail?.message || payload?.detail || payload?.error?.message || payload?.error || payload?.message || fallback);
    } catch {
        return text || fallback;
    }
}

async function responseToAudio(response, baseUrl = '') {
    if (!response?.ok) {
        throw await responseError(response, `语音生成失败（${response?.status || '无响应'}）`);
    }
    const type = String(response.headers?.get?.('content-type') || '');
    if (type.includes('audio/') || type.includes('application/octet-stream')) return response.blob();
    const payload = await response.json();
    const base64 = payload?.audio || payload?.data?.audio || payload?.audio_base64 || payload?.data?.audio_base64;
    if (base64) {
        const binary = atob(String(base64).replace(/^data:[^,]+,/, ''));
        return new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], { type: payload?.mime_type || 'audio/wav' });
    }
    const path = payload?.url || payload?.audio_url || payload?.data?.url || payload?.data?.audio_url;
    if (path) {
        const audioResponse = await fetch(/^https?:/i.test(path) ? path : joinUrl(baseUrl, path));
        if (!audioResponse.ok) throw new Error('语音服务返回了无法下载的音频地址');
        return audioResponse.blob();
    }
    throw new Error('语音服务没有返回可识别的音频');
}

export class PhonieProviderCenter {
    #bridge;
    #runtime = new Map();
    #listeners = new Set();
    #controller = null;

    constructor({ bridge }) {
        this.#bridge = bridge;
        for (const provider of TTS_PROVIDERS) this.#runtime.set(provider.id, { status: 'idle', message: provider.mode });
    }

    #emit() {
        const snapshot = this.snapshot();
        for (const listener of this.#listeners) listener(snapshot);
    }

    #setRuntime(providerId, patch) {
        this.#runtime.set(providerId, { ...this.#runtime.get(providerId), ...patch });
        this.#emit();
    }

    subscribe(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    snapshot() {
        const settings = this.#bridge.getSettings();
        const configs = normalizeProviderSettings(settings.ttsProviderSettings);
        const catalogs = settings.ttsResourceCatalogs && typeof settings.ttsResourceCatalogs === 'object' ? settings.ttsResourceCatalogs : {};
        return {
            activeProvider: settings.ttsActiveProvider,
            fallbackProvider: settings.ttsFallbackProvider,
            providers: TTS_PROVIDERS.map((provider) => ({
                ...provider,
                selected: provider.id === settings.ttsActiveProvider,
                settings: configs[provider.id],
                runtime: { ...this.#runtime.get(provider.id) },
                catalog: catalogs[provider.id] || (provider.id === 'minimax'
                    ? { models: MINIMAX_MODELS, voices: MINIMAX_VOICES }
                    : { models: [], voices: [] }),
            })),
        };
    }

    getActiveLabel() {
        return getProviderDefinition(this.#bridge.getSettings().ttsActiveProvider)?.name || '语音未配置';
    }

    setActive(providerId) {
        const provider = getProviderDefinition(providerId);
        if (!provider) throw new Error('未知的 Phonie 语音引擎');
        const current = this.#bridge.getSettings();
        const settings = this.#bridge.updateSettings({
            ttsActiveProvider: provider.id,
            ...(current.ttsFallbackProvider === provider.id ? { ttsFallbackProvider: '' } : {}),
        });
        this.#emit();
        return settings;
    }

    updateProvider(providerId, patch) {
        if (!getProviderDefinition(providerId)) throw new Error('未知的 Phonie 语音引擎');
        const settings = this.#bridge.getSettings();
        const providers = normalizeProviderSettings(settings.ttsProviderSettings);
        providers[providerId] = { ...providers[providerId], ...patch };
        this.#bridge.updateSettings({ ttsProviderSettings: providers });
        this.#setRuntime(providerId, { status: 'idle', message: '配置已更新，等待检测' });
        return providers[providerId];
    }

    setCharacterRoute(character, route) {
        const identity = typeof character === 'string' ? { name: character } : (character || {});
        const name = String(identity.name || '').trim();
        if (!name) throw new Error('角色名称不能为空');
        const settings = this.#bridge.getSettings();
        const routes = settings.ttsCharacterRoutes && typeof settings.ttsCharacterRoutes === 'object' ? { ...settings.ttsCharacterRoutes } : {};
        const key = String(identity.id || name).trim();
        routes[key] = {
            ...resolveCharacterRoute(routes, identity),
            ...route,
            characterId: key,
            characterName: name,
            updatedAt: Date.now(),
        };
        this.#bridge.updateSettings({ ttsCharacterRoutes: routes });
        this.#emit();
        return routes[key];
    }

    resolveRoute(character) {
        const settings = this.#bridge.getSettings();
        const identity = typeof character === 'string' ? { name: character } : (character || {});
        const route = resolveCharacterRoute(settings.ttsCharacterRoutes, identity);
        return {
            ...route,
            providerId: route.providerId || settings.ttsActiveProvider,
            fallbackProviderId: route.fallbackProviderId || settings.ttsFallbackProvider || '',
        };
    }

    getCacheSignature(characterName) {
        const route = this.resolveRoute(characterName);
        const providers = normalizeProviderSettings(this.#bridge.getSettings().ttsProviderSettings);
        const config = providers[route.providerId] || {};
        return [
            route.providerId,
            route.voiceId || config.voice || config.speaker || config.speakerAudio || '',
            route.modelId || config.model || '',
            route.referenceAudio || config.referenceAudio || config.refAudioPath || '',
        ].join('|');
    }

    getLabelForSpeaker(characterName) {
        return getProviderDefinition(this.resolveRoute(characterName).providerId)?.name || this.getActiveLabel();
    }

    async saveSecret(providerId, secretKey, value) {
        const input = String(value || '').trim();
        if (!input) throw new Error('请输入密钥');
        const { secrets } = await runtimeModules();
        const map = {
            api_key_elevenlabs: secrets.SECRET_KEYS?.ELEVENLABS,
            api_key_minimax: secrets.SECRET_KEYS?.MINIMAX,
            volcengine_app_id: secrets.SECRET_KEYS?.VOLCENGINE_APP_ID,
            volcengine_access_key: secrets.SECRET_KEYS?.VOLCENGINE_ACCESS_KEY,
        };
        const key = map[secretKey];
        if (!key || typeof secrets.writeSecret !== 'function') throw new Error('当前酒馆版本没有对应的安全密钥槽');
        await secrets.writeSecret(key, input, `Phonie · ${getProviderDefinition(providerId)?.name || providerId}`);
        this.#setRuntime(providerId, { status: 'idle', message: '密钥已安全保存，等待检测' });
    }

    async syncResources(providerId) {
        const config = normalizeProviderSettings(this.#bridge.getSettings().ttsProviderSettings)[providerId];
        this.#setRuntime(providerId, { status: 'checking', message: '正在同步模型与音色' });
        try {
            const { getRequestHeaders } = await runtimeModules();
            let catalog = { models: [], voices: [] };
            if (providerId === 'elevenlabs') {
                const response = await fetch('/api/speech/elevenlabs/voices', { method: 'POST', headers: getRequestHeaders() });
                if (!response.ok) throw new Error(await readError(response, 'ElevenLabs 音色同步失败'));
                const payload = await response.json();
                catalog.voices = (payload.voices || []).map((voice) => ({
                    id: String(voice.voice_id || ''),
                    name: String(voice.name || voice.voice_id || ''),
                })).filter((voice) => voice.id);
                catalog.models = [
                    { id: 'eleven_v3', name: 'Eleven v3' },
                    { id: 'eleven_multilingual_v2', name: 'Eleven Multilingual v2' },
                    { id: 'eleven_flash_v2_5', name: 'Eleven Flash v2.5' },
                ];
            } else if (providerId === 'minimax') {
                if (config.credentialMode === 'direct') {
                    if (!config.directApiKey) throw new Error('请先填写 MiniMax 直连 API Key');
                    const response = await fetch(`${config.apiHost.replace(/\/+$/, '')}/v1/get_voice`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${config.directApiKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ voice_type: 'all' }),
                    });
                    if (!response.ok) throw new Error(await readError(response, 'MiniMax 音色同步失败'));
                    const payload = await response.json();
                    catalog = normalizeMiniMaxCatalog({ voices: payload, speechModels: MINIMAX_MODELS });
                } else {
                    const response = await fetch('/api/plugins/tts-minimax-resources/catalog', {
                        method: 'POST',
                        headers: getRequestHeaders(),
                        body: JSON.stringify({ apiHost: config.apiHost }),
                    });
                    if (!response.ok) throw new Error(await readError(response, 'MiniMax 资源代理未启用'));
                    const payload = await response.json();
                    catalog = normalizeMiniMaxCatalog(payload);
                }
                if (!catalog.models.length) catalog.models = MINIMAX_MODELS;
                if (!catalog.voices.length) catalog.voices = MINIMAX_VOICES;
            } else {
                await this.checkProvider(providerId);
                return this.snapshot();
            }
            const settings = this.#bridge.getSettings();
            this.#bridge.updateSettings({
                ttsResourceCatalogs: {
                    ...(settings.ttsResourceCatalogs || {}),
                    [providerId]: { ...catalog, syncedAt: Date.now() },
                },
            });
            this.#setRuntime(providerId, { status: 'ready', message: `已同步 ${catalog.models.length} 个模型、${catalog.voices.length} 个音色` });
            return this.snapshot();
        } catch (error) {
            this.#setRuntime(providerId, { status: 'error', message: error?.message || '同步失败' });
            throw error;
        }
    }

    async checkProvider(providerId) {
        const provider = getProviderDefinition(providerId);
        if (!provider) throw new Error('未知的 Phonie 语音引擎');
        const config = normalizeProviderSettings(this.#bridge.getSettings().ttsProviderSettings)[providerId];
        this.#setRuntime(providerId, { status: 'checking', message: '正在检测连接' });
        try {
            if (['elevenlabs', 'minimax'].includes(providerId)) return this.syncResources(providerId);
            if (providerId === 'doubao') {
                if (!config.resourceId) throw new Error('请先填写资源 ID 并保存密钥');
            } else {
                const base = config.managerEndpoint || config.serviceBase || config.endpoint;
                const response = await fetch(base, { method: 'GET' });
                if (!response.ok && response.status !== 404 && response.status !== 405) throw new Error(`服务返回 ${response.status}`);
            }
            this.#setRuntime(providerId, { status: 'ready', message: '连接可用' });
            return this.snapshot();
        } catch (error) {
            this.#setRuntime(providerId, { status: 'offline', message: error?.message || '服务未启动' });
            throw error;
        }
    }

    cancel() {
        this.#controller?.abort();
        this.#controller = null;
    }

    async synthesize(request = {}) {
        this.cancel();
        this.#controller = new AbortController();
        const route = this.resolveRoute(request.speaker);
        const candidates = [request.providerId || route.providerId, route.fallbackProviderId]
            .filter((id, index, list) => id && list.indexOf(id) === index);
        const failures = [];
        for (const providerId of candidates) {
            try {
                return await this.#synthesizeWith(providerId, {
                    ...request,
                    signal: request.signal || this.#controller.signal,
                    route,
                });
            } catch (error) {
                failures.push(error);
                if (error?.name === 'AbortError') throw error;
            }
        }
        throw new AggregateError(failures, failures.at(-1)?.message || 'Phonie 语音生成失败');
    }

    async #synthesizeWith(providerId, request) {
        const provider = getProviderDefinition(providerId);
        if (!provider) throw new Error(`未知语音引擎：${providerId}`);
        const settings = normalizeProviderSettings(this.#bridge.getSettings().ttsProviderSettings)[providerId];
        const text = String(request.text || '').trim();
        if (!text) throw new Error('合成文本不能为空');
        this.#setRuntime(providerId, { status: 'generating', message: '正在生成语音' });
        try {
            const maxAttempts = providerId === 'minimax' ? 4 : 1;
            let blob;
            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
                try {
                    blob = await this.#requestAudio(providerId, settings, { ...request, text });
                    break;
                } catch (error) {
                    const throttled = error?.status === 429 || /429|rate.?limit|限流/i.test(String(error?.message || ''));
                    if (!throttled || attempt === maxAttempts - 1) throw error;
                    const delay = Math.max(500, Number(error.retryAfterMs) || (650 * (2 ** attempt)));
                    this.#setRuntime(providerId, {
                        status: 'generating',
                        message: `服务繁忙，${Math.ceil(delay / 1000)} 秒后自动重试（${attempt + 2}/${maxAttempts}）`,
                    });
                    await abortableDelay(delay, request.signal);
                }
            }
            this.#setRuntime(providerId, { status: 'ready', message: '语音生成成功' });
            return { blob, providerId, providerLabel: provider.name };
        } catch (error) {
            this.#setRuntime(providerId, {
                status: error?.name === 'AbortError' ? 'idle' : 'error',
                message: error?.message || '语音生成失败',
            });
            throw error;
        }
    }

    async #requestAudio(providerId, settings, request) {
        const { getRequestHeaders } = await runtimeModules();
        const headers = getRequestHeaders();
        let response;
        if (providerId === 'elevenlabs') {
            if (!settings.voice) throw new Error('请先同步并选择 ElevenLabs 音色');
            const body = {
                text: request.text,
                model_id: request.model || request.route.modelId || settings.model,
                voice_settings: {
                    stability: clamp(settings.stability, 0, 1, 0.5),
                    similarity_boost: clamp(settings.similarityBoost, 0, 1, 0.75),
                    style: clamp(settings.style, 0, 1, 0),
                    use_speaker_boost: Boolean(settings.speakerBoost),
                    speed: clamp(settings.speed, 0.7, 1.2, 1),
                },
            };
            const language = String(request.language || settings.languageCode || '').split('-')[0].toLowerCase();
            if (language) body.language_code = language;
            response = await fetch('/api/speech/elevenlabs/synthesize', {
                method: 'POST', headers, signal: request.signal,
                body: JSON.stringify({ voiceId: request.voice || request.route.voiceId || settings.voice, request: body }),
            });
        } else if (providerId === 'minimax') {
            const emotion = normalizeEmotion(request.emotion);
            const voiceSetting = {
                voice_id: request.voice || request.route.voiceId || settings.voice,
                speed: Number(settings.speed),
                vol: Number(settings.volume),
                pitch: Number(settings.pitch),
                ...(emotion ? { emotion } : {}),
            };
            if (settings.credentialMode === 'direct') {
                if (!settings.directApiKey) throw new Error('请先填写 MiniMax 直连 API Key');
                const makeBody = () => ({
                    model: request.model || request.route.modelId || settings.model, text: request.text, stream: false,
                    voice_setting: voiceSetting,
                    audio_setting: { sample_rate: 32000, bitrate: 128000, format: settings.format, channel: 1 },
                    language_boost: 'auto', output_format: 'hex',
                });
                const send = () => fetch(`${settings.apiHost.replace(/\/+$/, '')}/v1/t2a_v2`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${settings.directApiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(makeBody()),
                    signal: request.signal,
                });
                response = await send();
                if (!response.ok && emotion) {
                    const detail = await readError(response.clone(), '');
                    if (/emotion/i.test(detail)) {
                        delete voiceSetting.emotion;
                        response = await send();
                    }
                }
                if (!response.ok) throw await responseError(response, 'MiniMax 合成失败');
                const payload = await response.json();
                return hexToBlob(payload?.data?.audio, settings.format);
            }
            response = await fetch('/api/plugins/tts-minimax-resources/generate', {
                method: 'POST', headers, signal: request.signal,
                body: JSON.stringify({
                    text: request.text, voiceId: voiceSetting.voice_id, apiHost: settings.apiHost,
                    model: request.model || request.route.modelId || settings.model, speed: Number(settings.speed),
                    volume: Number(settings.volume), pitch: Number(settings.pitch),
                    format: settings.format, emotion,
                }),
            });
        } else if (providerId === 'doubao') {
            response = await fetch('/api/volcengine/generate-voice', {
                method: 'POST', headers, signal: request.signal,
                body: JSON.stringify({
                    provider_endpoint: settings.providerEndpoint, resource_id: settings.resourceId,
                    text: request.text, voice_speaker: request.voice || request.route.voiceId || settings.voice,
                    speed: Number(settings.speed),
                }),
            });
        } else if (providerId === 'edge') {
            response = await fetch(joinUrl(settings.serviceBase, '/generate'), {
                method: 'POST', headers, signal: request.signal,
                body: JSON.stringify({
                    text: request.text, voice: request.voice || request.route.voiceId || settings.voice,
                    rate: Number(settings.rate),
                }),
            });
        } else if (providerId === 'gpt_sovits') {
            const referenceAudio = request.referenceAudio || request.route.referenceAudio || settings.refAudioPath;
            if (!referenceAudio) throw new Error('请先为 GPT-SoVITS 配置参考音频');
            response = await fetch(joinUrl(settings.managerEndpoint, '/tts_proxy_v2'), {
                method: 'POST', signal: request.signal, headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: request.text, text_lang: String(request.language || settings.textLang).split('-')[0],
                    ref_audio_path: referenceAudio, prompt_lang: settings.promptLang,
                    prompt_text: settings.promptText, speed_factor: Number(settings.speedFactor),
                    streaming_mode: false, emotion: request.emotion || 'default',
                    engine_endpoint: settings.engineEndpoint,
                }),
            });
        } else if (providerId === 'indextts2') {
            if (settings.adapter === 'gradio') throw new Error('IndexTTS2 Gradio 模式暂需配合服务组件；请先使用 JSON 模式');
            response = await fetch(joinUrl(settings.endpoint, settings.generatePath), {
                method: 'POST', signal: request.signal, headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: request.text,
                    speaker_audio: request.referenceAudio || request.route.referenceAudio || settings.speakerAudio,
                    emotion: request.emotion || 'default', emotion_audio: settings.emotionAudio,
                    emotion_weight: Number(settings.emotionWeight), output_format: settings.outputFormat,
                }),
            });
        } else if (providerId === 'voxcpm2') {
            response = await fetch(joinUrl(settings.endpoint, settings.generatePath), {
                method: 'POST', signal: request.signal, headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: request.model || request.route.modelId || settings.model, input: request.text,
                    voice: request.voice || request.route.voiceId || settings.speaker,
                    response_format: settings.outputFormat,
                    ...(request.referenceAudio || request.route.referenceAudio || settings.referenceAudio
                        ? { ref_audio: request.referenceAudio || request.route.referenceAudio || settings.referenceAudio } : {}),
                    instructions: [settings.controlInstruction, request.emotion].filter(Boolean).join('，'),
                }),
            });
        }
        return responseToAudio(response, settings.endpoint || settings.managerEndpoint || '');
    }

    dispose() {
        this.cancel();
        this.#listeners.clear();
    }
}
