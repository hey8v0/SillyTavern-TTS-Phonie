import fetch from 'node-fetch';
import { readSecret, SECRET_KEYS } from '../../src/endpoints/secrets.js';

export const info = {
    id: 'tts-minimax-resources',
    name: 'TTS MiniMax 资源同步',
    description: '使用 SillyTavern 密钥保险箱安全同步 MiniMax 模型与账户音色。',
};

const ALLOWED_API_HOSTS = new Map([
    ['https://api.minimax.io', 'https://api.minimax.io'],
    ['https://api.minimaxi.com', 'https://api.minimaxi.com'],
]);
const SPEECH_DOCS_BY_HOST = new Map([
    ['https://api.minimax.io', 'https://platform.minimax.io/docs/api-reference/speech-t2a-http'],
    ['https://api.minimaxi.com', 'https://platform.minimaxi.com/docs/api-reference/speech-t2a-http'],
]);
const SPEECH_DOCS_CACHE_MS = 60 * 60 * 1000;
const speechDocsCache = new Map();
const AUDIO_MIME_TYPES = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
};
const EMOTION_NAMES = new Map([
    ['开心', 'happy'],
    ['快乐', 'happy'],
    ['happy', 'happy'],
    ['悲伤', 'sad'],
    ['难过', 'sad'],
    ['sad', 'sad'],
    ['生气', 'angry'],
    ['愤怒', 'angry'],
    ['angry', 'angry'],
    ['害怕', 'fearful'],
    ['恐惧', 'fearful'],
    ['fearful', 'fearful'],
    ['厌恶', 'disgusted'],
    ['disgusted', 'disgusted'],
    ['惊讶', 'surprised'],
    ['surprised', 'surprised'],
    ['平静', 'neutral'],
    ['中性', 'neutral'],
    ['neutral', 'neutral'],
]);

function resolveApiHost(value) {
    const normalized = String(value || '').trim().replace(/\/+$/, '');
    const apiHost = ALLOWED_API_HOSTS.get(normalized);
    if (!apiHost) {
        throw new Error('不支持的 MiniMax 服务区域。');
    }
    return apiHost;
}

async function readJson(response, label) {
    const data = await response.json().catch(() => null);
    if (!response.ok) {
        const detail = data?.base_resp?.status_msg
            || data?.error?.message
            || data?.message
            || `HTTP ${response.status}`;
        const error = new Error(`${label}失败：${detail}`);
        error.status = response.status;
        error.retryAfter = response.headers.get('retry-after') || '';
        throw error;
    }
    if (data?.base_resp && data.base_resp.status_code !== 0) {
        throw new Error(`${label}失败：${data.base_resp.status_msg || data.base_resp.status_code}`);
    }
    return data;
}

async function fetchModels(apiHost, apiKey) {
    const response = await fetch(`${apiHost}/v1/models`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });
    return readJson(response, '模型同步');
}

async function fetchVoices(apiHost, apiKey) {
    const response = await fetch(`${apiHost}/v1/get_voice`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ voice_type: 'all' }),
    });
    return readJson(response, '音色同步');
}

async function fetchSpeechModelsFromDocs(apiHost) {
    const cached = speechDocsCache.get(apiHost);
    if (cached && Date.now() - cached.fetchedAt < SPEECH_DOCS_CACHE_MS) {
        return cached.models;
    }

    const docsUrl = SPEECH_DOCS_BY_HOST.get(apiHost);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    try {
        const response = await fetch(docsUrl, {
            headers: { Accept: 'text/html,application/xhtml+xml' },
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`官方文档返回 HTTP ${response.status}`);
        }
        const source = await response.text();
        const modelIds = [...new Set(
            (source.match(/speech-(?:\d+(?:\.\d+)*|\d+)-(?:hd|turbo)/gi) || [])
                .map(value => value.toLowerCase()),
        )];
        if (!modelIds.length) {
            throw new Error('官方文档中没有识别到 speech 模型');
        }
        const models = modelIds.map(id => ({
            id,
            name: id.replace(/^speech-/i, 'Speech ').replace(/-(hd|turbo)$/i, ' $1').toUpperCase(),
            note: 'MiniMax 官方 T2A 文档',
        }));
        speechDocsCache.set(apiHost, { fetchedAt: Date.now(), models });
        return models;
    } finally {
        clearTimeout(timer);
    }
}

function normalizeEmotion(value) {
    return EMOTION_NAMES.get(String(value || '').trim().toLowerCase()) || '';
}

function decodeHexAudio(value) {
    const cleanHex = String(value || '').replace(/^0x/i, '').replace(/\s/g, '');
    if (!cleanHex || !/^[0-9a-f]+$/i.test(cleanHex) || cleanHex.length % 2 !== 0) {
        throw new Error('MiniMax 返回了无效的音频数据。');
    }
    return Buffer.from(cleanHex, 'hex');
}

export async function init(router) {
    router.post('/generate', async (request, response) => {
        try {
            const apiKey = readSecret(request.user.directories, SECRET_KEYS.MINIMAX);
            if (!apiKey) {
                return response.status(400).json({ error: '请先在 SillyTavern 密钥保险箱保存 MiniMax API Key。' });
            }

            const {
                text,
                voiceId,
                model = 'speech-2.8-hd',
                speed = 1,
                volume = 1,
                pitch = 0,
                audioSampleRate = 32000,
                bitrate = 128000,
                format = 'mp3',
                emotion = '',
            } = request.body || {};
            if (!String(text || '').trim() || !String(voiceId || '').trim()) {
                return response.status(400).json({ error: '合成文本和音色 ID 不能为空。' });
            }
            if (!/^speech-/i.test(String(model))) {
                return response.status(400).json({ error: '请选择 MiniMax speech 系列语音模型。' });
            }
            if (!AUDIO_MIME_TYPES[format]) {
                return response.status(400).json({ error: 'MiniMax 当前仅支持 MP3、WAV 或 FLAC。' });
            }

            const apiHost = resolveApiHost(request.body?.apiHost);
            const normalizedEmotion = normalizeEmotion(emotion);
            const voiceSetting = {
                voice_id: String(voiceId).trim(),
                speed: Number(speed),
                vol: Number(volume),
                pitch: Number(pitch),
            };
            if (normalizedEmotion) voiceSetting.emotion = normalizedEmotion;
            const requestAudio = () => fetch(`${apiHost}/v1/t2a_v2`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'MM-API-Source': 'SillyTavern-TTS',
                },
                body: JSON.stringify({
                    model: String(model),
                    text: String(text),
                    stream: false,
                    voice_setting: voiceSetting,
                    audio_setting: {
                        sample_rate: Number(audioSampleRate),
                        bitrate: Number(bitrate),
                        format,
                        channel: 1,
                    },
                    language_boost: 'auto',
                    output_format: 'hex',
                }),
            });
            let data;
            try {
                data = await readJson(await requestAudio(), '语音合成');
            } catch (error) {
                if (!voiceSetting.emotion || !/voice_setting[\s._-]*emotion|emotion[^\n]*(?:invalid|参数)/i.test(String(error?.message || error))) {
                    throw error;
                }
                delete voiceSetting.emotion;
                data = await readJson(await requestAudio(), '语音合成');
            }
            const audio = decodeHexAudio(data?.data?.audio);
            response.setHeader('Content-Type', AUDIO_MIME_TYPES[format]);
            response.setHeader('Content-Length', audio.length);
            return response.send(audio);
        } catch (error) {
            if (error?.retryAfter) response.setHeader('Retry-After', error.retryAfter);
            return response.status(Number(error?.status) === 429 ? 429 : 502).json({ error: error?.message || 'MiniMax 语音合成失败。' });
        }
    });

    router.post('/catalog', async (request, response) => {
        try {
            const apiKey = readSecret(request.user.directories, SECRET_KEYS.MINIMAX);
            if (!apiKey) {
                return response.status(400).json({ error: '请先在 SillyTavern 密钥保险箱保存 MiniMax API Key。' });
            }

            const apiHost = resolveApiHost(request.body?.apiHost);
            const [modelsResult, voicesResult, speechModelsResult] = await Promise.allSettled([
                fetchModels(apiHost, apiKey),
                fetchVoices(apiHost, apiKey),
                fetchSpeechModelsFromDocs(apiHost),
            ]);
            const warnings = [];
            if (modelsResult.status === 'rejected') warnings.push(modelsResult.reason?.message || '模型同步失败');
            if (voicesResult.status === 'rejected') warnings.push(voicesResult.reason?.message || '音色同步失败');
            if (speechModelsResult.status === 'rejected') {
                warnings.push(`最新语音模型同步失败：${speechModelsResult.reason?.message || '无法读取官方文档'}`);
            }
            if (
                modelsResult.status === 'rejected'
                && voicesResult.status === 'rejected'
                && speechModelsResult.status === 'rejected'
            ) {
                return response.status(502).json({ error: warnings.join('；') });
            }

            return response.json({
                models: modelsResult.status === 'fulfilled' ? modelsResult.value : null,
                voices: voicesResult.status === 'fulfilled' ? voicesResult.value : null,
                speechModels: speechModelsResult.status === 'fulfilled' ? speechModelsResult.value : [],
                warnings,
                syncedAt: new Date().toISOString(),
            });
        } catch (error) {
            return response.status(400).json({ error: error?.message || 'MiniMax 资源同步失败。' });
        }
    });
}
