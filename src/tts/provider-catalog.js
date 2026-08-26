export const MINIMAX_EMOTIONS = Object.freeze([
    'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm', 'fluent',
]);

export const TTS_PROVIDERS = Object.freeze([
    {
        id: 'indextts2', name: 'IndexTTS2', category: '本地推理', mode: '按需启动', icon: 'layers',
        defaults: { endpoint: 'http://127.0.0.1:7860', generatePath: '/tts', adapter: 'json', speakerAudio: '', emotionAudio: '', emotionWeight: 0.65, outputFormat: 'wav' },
        fields: [
            { key: 'endpoint', label: '服务地址', type: 'url' },
            { key: 'adapter', label: '接口模式', type: 'select', options: [['json', '通用 JSON'], ['gradio', 'Gradio WebUI']] },
            { key: 'generatePath', label: '生成路径', type: 'text' },
            { key: 'speakerAudio', label: '音色参考音频', type: 'text' },
            { key: 'emotionAudio', label: '情绪参考音频', type: 'text' },
            { key: 'emotionWeight', label: '情绪权重', type: 'range', min: 0, max: 1, step: 0.05 },
            { key: 'outputFormat', label: '输出格式', type: 'select', options: [['wav', 'WAV'], ['mp3', 'MP3'], ['flac', 'FLAC']] },
        ],
    },
    {
        id: 'gpt_sovits', name: 'GPT-SoVITS', category: '本地推理', mode: '需要管理后端', icon: 'wave',
        defaults: { managerEndpoint: 'http://127.0.0.1:3000', engineEndpoint: 'http://127.0.0.1:9880', refAudioPath: '', promptText: '', textLang: 'ja', promptLang: 'ja', speedFactor: 1 },
        fields: [
            { key: 'managerEndpoint', label: '管理服务地址', type: 'url', help: '手机访问时填写电脑局域网 IP。' },
            { key: 'engineEndpoint', label: '推理服务地址', type: 'url' },
            { key: 'refAudioPath', label: '参考音频', type: 'text' },
            { key: 'promptText', label: '参考音频文本', type: 'text' },
            { key: 'textLang', label: '台词语言', type: 'select', options: [['zh', '中文'], ['yue', '粤语'], ['ja', '日语'], ['en', '英语'], ['auto', '自动']] },
            { key: 'promptLang', label: '参考音频语言', type: 'select', options: [['zh', '中文'], ['ja', '日语'], ['en', '英语']] },
            { key: 'speedFactor', label: '语速', type: 'range', min: 0.6, max: 1.6, step: 0.05 },
        ],
    },
    {
        id: 'voxcpm2', name: 'VoxCPM2', category: '本地推理', mode: '按需启动', icon: 'spark',
        defaults: { endpoint: 'http://127.0.0.1:8808', generatePath: '/v1/audio/speech', model: 'openbmb/VoxCPM2', speaker: 'default', referenceAudio: '', controlInstruction: '', outputFormat: 'wav' },
        fields: [
            { key: 'endpoint', label: '服务地址', type: 'url' },
            { key: 'generatePath', label: '生成路径', type: 'text' },
            { key: 'model', label: '模型标识', type: 'text' },
            { key: 'speaker', label: '说话人', type: 'text' },
            { key: 'referenceAudio', label: '克隆参考音频', type: 'text' },
            { key: 'controlInstruction', label: '声线与风格描述', type: 'text' },
            { key: 'outputFormat', label: '输出格式', type: 'select', options: [['wav', 'WAV'], ['mp3', 'MP3'], ['flac', 'FLAC']] },
        ],
    },
    {
        id: 'doubao', name: '豆包 TTS', category: '云端服务', mode: '安全代理', icon: 'signal',
        defaults: { providerEndpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional', resourceId: '', voice: 'zh_female_xiaohe_uranus_bigtts', speed: 0 },
        fields: [
            { key: 'volcengine_app_id', label: '应用 ID', type: 'secret' },
            { key: 'volcengine_access_key', label: '访问密钥', type: 'secret' },
            { key: 'resourceId', label: '资源 ID', type: 'text' },
            { key: 'voice', label: '音色 ID', type: 'text' },
            { key: 'speed', label: '语速偏移', type: 'range', min: -50, max: 100, step: 5 },
        ],
    },
    {
        id: 'edge', name: 'Edge TTS', category: '宿主服务', mode: '需要服务插件', icon: 'signal',
        defaults: { serviceBase: '/api/plugins/edge-tts', voice: 'ja-JP-NanamiNeural', rate: 0 },
        fields: [
            { key: 'serviceBase', label: '服务路径', type: 'text' },
            { key: 'voice', label: '音色 ID', type: 'text' },
            { key: 'rate', label: '语速偏移', type: 'range', min: -100, max: 100, step: 5 },
        ],
    },
    {
        id: 'elevenlabs', name: 'ElevenLabs', category: '云端服务', mode: 'Phonie 安全代理', icon: 'spark',
        defaults: { model: 'eleven_multilingual_v2', voice: '', languageCode: '', stability: 0.5, similarityBoost: 0.75, style: 0, speakerBoost: true, speed: 1 },
        fields: [
            { key: 'api_key_elevenlabs', label: 'API Key', type: 'secret' },
            { key: 'model', label: '语音模型', type: 'resource', resource: 'models' },
            { key: 'voice', label: '账号音色', type: 'resource', resource: 'voices' },
            { key: 'languageCode', label: '发音语言', type: 'text', help: '留空自动识别；日语可填 ja。' },
            { key: 'stability', label: '稳定度', type: 'range', min: 0, max: 1, step: 0.05 },
            { key: 'similarityBoost', label: '音色相似度', type: 'range', min: 0, max: 1, step: 0.05 },
            { key: 'style', label: '风格强度', type: 'range', min: 0, max: 1, step: 0.05 },
            { key: 'speakerBoost', label: '说话人增强', type: 'switch' },
            { key: 'speed', label: '语速', type: 'range', min: 0.7, max: 1.2, step: 0.05 },
        ],
    },
    {
        id: 'minimax', name: 'MiniMax', category: '云端服务', mode: '直连或安全代理', icon: 'wave',
        defaults: { credentialMode: 'vault', directApiKey: '', apiHost: 'https://api.minimax.io', model: 'speech-2.8-hd', voice: 'Chinese (Mandarin)_Unrestrained_Young_Man', speed: 1, volume: 1, pitch: 0, format: 'mp3' },
        fields: [
            { key: 'credentialMode', label: '连接方式', type: 'select', options: [['vault', '安全代理'], ['direct', '浏览器直连']] },
            { key: 'api_key_minimax', label: '安全代理 API Key', type: 'secret', when: ['credentialMode', 'vault'] },
            { key: 'directApiKey', label: '直连 API Key', type: 'password', when: ['credentialMode', 'direct'] },
            { key: 'apiHost', label: '服务区域', type: 'select', options: [['https://api.minimax.io', '国际站'], ['https://api.minimaxi.com', '中国大陆']] },
            { key: 'model', label: '模型', type: 'resource', resource: 'models' },
            { key: 'voice', label: '音色', type: 'resource', resource: 'voices' },
            { key: 'speed', label: '语速', type: 'range', min: 0.5, max: 2, step: 0.05 },
            { key: 'volume', label: '音量', type: 'range', min: 0.1, max: 10, step: 0.1 },
            { key: 'pitch', label: '音高', type: 'range', min: -12, max: 12, step: 1 },
            { key: 'format', label: '格式', type: 'select', options: [['mp3', 'MP3'], ['wav', 'WAV'], ['flac', 'FLAC']] },
        ],
    },
]);

export function getProviderDefinition(id) {
    return TTS_PROVIDERS.find((provider) => provider.id === id) || null;
}

export function normalizeProviderSettings(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(TTS_PROVIDERS.map((provider) => [
        provider.id,
        { ...provider.defaults, ...(source[provider.id] && typeof source[provider.id] === 'object' ? source[provider.id] : {}) },
    ]));
}
