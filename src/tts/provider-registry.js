import { eventSource, event_types, getRequestHeaders, saveSettingsDebounced } from '/script.js';
import { extension_settings } from '/scripts/extensions.js';
import { SECRET_KEYS, secret_state } from '/scripts/secrets.js';

const SETTINGS_KEY = 'phonie_v2';
const DEFAULT_PREVIEW_TEXT = '这是多引擎 TTS 控制台的语音试听。';
const DEFAULT_TAG_TEMPLATE = '[TTS:{角色}:{情绪}:{文本}]';
const VISIBLE_TAG_TEMPLATE = '“{译文}”[TTS:{角色}:{情绪}:{文本}]';
const MINIMAX_RESOURCE_ENDPOINT = '/api/plugins/tts-minimax-resources/catalog';
const ELEVENLABS_API_BASE = '/api/speech/elevenlabs';
const ELEVENLABS_MODEL_CATALOG = Object.freeze([
    { id: 'eleven_v3', name: 'Eleven v3', note: '表现力最强，适合情绪化角色台词' },
    { id: 'eleven_v3_conversational', name: 'Eleven v3 Conversational', note: '面向实时对话的高表现力模型' },
    { id: 'eleven_multilingual_v2', name: 'Eleven Multilingual v2', note: '长文本稳定，支持中文、日语等 29 种语言' },
    { id: 'eleven_flash_v2_5', name: 'Eleven Flash v2.5', note: '低延迟多语言模型，适合聊天与通话' },
    { id: 'eleven_flash_v2', name: 'Eleven Flash v2', note: '低延迟英语模型' },
]);
const MINIMAX_MODEL_CATALOG = Object.freeze([
    { id: 'speech-2.8-hd', name: 'Speech 2.8 HD', note: '最新高保真模型，支持声音标签' },
    { id: 'speech-2.8-turbo', name: 'Speech 2.8 Turbo', note: '最新低延迟模型，兼顾自然度' },
    { id: 'speech-2.6-hd', name: 'Speech 2.6 HD', note: '高表现力与克隆相似度' },
    { id: 'speech-2.6-turbo', name: 'Speech 2.6 Turbo', note: '低延迟并支持多语言' },
    { id: 'speech-02-hd', name: 'Speech 02 HD', note: '稳定的高质量兼容模型' },
    { id: 'speech-02-turbo', name: 'Speech 02 Turbo', note: '稳定的多语言兼容模型' },
    { id: 'speech-01-hd', name: 'Speech 01 HD', note: '旧版高质量模型' },
    { id: 'speech-01-turbo', name: 'Speech 01 Turbo', note: '旧版低延迟模型' },
]);
const MINIMAX_STARTER_VOICES = Object.freeze([
    ['male-qn-qingse', '青涩青年'],
    ['male-qn-jingying', '精英青年'],
    ['male-qn-badao', '霸道青年'],
    ['male-qn-daxuesheng', '青年大学生'],
    ['female-shaonv', '少女'],
    ['female-yujie', '御姐'],
    ['female-chengshu', '成熟女性'],
    ['female-tianmei', '甜美女性'],
    ['male-qn-qingse-jingpin', '青涩青年 Beta'],
    ['male-qn-jingying-jingpin', '精英青年 Beta'],
    ['male-qn-badao-jingpin', '霸道青年 Beta'],
    ['male-qn-daxuesheng-jingpin', '青年大学生 Beta'],
    ['female-shaonv-jingpin', '少女 Beta'],
    ['female-yujie-jingpin', '御姐 Beta'],
    ['female-chengshu-jingpin', '成熟女性 Beta'],
    ['female-tianmei-jingpin', '甜美女性 Beta'],
    ['clever_boy', '聪明男童'],
    ['cute_boy', '可爱男童'],
    ['lovely_girl', '萌萌女童'],
    ['cartoon_pig', '卡通猪小琪'],
    ['bingjiao_didi', '病娇弟弟'],
    ['junlang_nanyou', '俊朗男友'],
    ['chunzhen_xuedi', '纯真学弟'],
    ['lengdan_xiongzhang', '冷淡学长'],
    ['badao_shaoye', '霸道少爷'],
    ['tianxin_xiaoling', '甜心小玲'],
    ['qiaopi_mengmei', '俏皮萌妹'],
    ['wumei_yujie', '妩媚御姐'],
    ['diadia_xuemei', '嗲嗲学妹'],
    ['danya_xuejie', '淡雅学姐'],
    ['Chinese (Mandarin)_Unrestrained_Young_Man', '不羁青年男声'],
    ['Chinese (Mandarin)_Gentleman', '沉稳绅士'],
    ['Chinese (Mandarin)_Warm_Bestie', '温暖闺蜜'],
    ['Chinese (Mandarin)_Sweet_Lady', '甜美女声'],
].map(([id, name]) => ({ id, name, category: 'system', description: 'MiniMax 系统音色' })));
const TAG_PRESETS = Object.freeze([
    { id: 'ttsvoice', name: '兼容格式', template: DEFAULT_TAG_TEMPLATE },
    { id: 'visible-ttsvoice', name: '正文可见格式', template: VISIBLE_TAG_TEMPLATE },
    { id: 'compact', name: '紧凑格式', template: '[TTS:{角色}|{情绪}|{文本}]' },
    { id: 'dialogue', name: '对白格式', template: '【语音:{角色}:{情绪}】{文本}【/语音】' },
    { id: 'custom', name: '自定义格式', template: '' },
]);

const PROVIDERS = Object.freeze([
    {
        id: 'indextts2',
        name: 'IndexTTS2',
        category: '本地推理',
        mode: '按需启动',
        description: '面向高表现力中文与角色声线克隆的本地推理引擎。',
        icon: 'layers',
        capabilities: ['参考音频', '情绪控制', '长文本', '本地隐私'],
        preview: true,
        defaults: {
            endpoint: 'http://127.0.0.1:7860',
            generatePath: '/tts',
            adapter: 'json',
            speakerAudio: '',
            emotionAudio: '',
            emotionWeight: 0.65,
            outputFormat: 'wav',
            streaming: false,
        },
        fields: [
            { key: 'endpoint', label: '服务地址', type: 'url', group: '连接', help: '可填写本机或远程部署的 IndexTTS2 服务地址。' },
            { key: 'adapter', label: '接口模式', type: 'select', group: '连接', options: [['json', '通用 JSON 服务']] },
            { key: 'generatePath', label: '生成路径', type: 'text', group: '连接', help: '通用 JSON 服务的生成路径。' },
            { key: 'speakerAudio', label: '音色参考音频', type: 'text', group: '声线', help: '填写 IndexTTS2 服务能够读取的本地路径或音频 URL。' },
            { key: 'emotionAudio', label: '情绪参考音频', type: 'text', group: '声线' },
            { key: 'emotionWeight', label: '情绪权重', type: 'range', group: '音频', min: 0, max: 1, step: 0.05 },
            { key: 'outputFormat', label: '输出格式', type: 'select', group: '音频', options: [['wav', 'WAV'], ['mp3', 'MP3'], ['flac', 'FLAC']] },
            { key: 'streaming', label: '启用流式返回', type: 'switch', group: '音频' },
        ],
    },
    {
        id: 'gpt_sovits',
        name: 'GPT-SoVITS',
        category: '本地推理',
        mode: '需要管理后端',
        description: '保留现有角色绑定、情绪参考音频和模型自动切换能力。',
        icon: 'waveform',
        capabilities: ['角色绑定', '情绪参考', '模型切换', '磁盘缓存'],
        preview: false,
        defaults: {
            managerEndpoint: 'http://127.0.0.1:3000',
            engineEndpoint: 'http://127.0.0.1:9880',
            refAudioPath: '',
            promptText: '',
            textLang: 'zh',
            promptLang: 'zh',
            speedFactor: 1,
        },
        fields: [
            { key: 'managerEndpoint', label: '插件管理服务', type: 'url', group: '连接', help: '电脑本机使用 127.0.0.1；手机访问时填写电脑局域网 IP。', info: '电脑浏览器使用 http://127.0.0.1:3000。手机浏览器中的 127.0.0.1 指向手机自身，因此必须改成电脑的局域网地址，例如 http://192.168.1.20:3000，并确保防火墙允许访问 3000 端口。' },
            { key: 'engineEndpoint', label: '推理服务地址', type: 'url', group: '连接', help: '此地址由插件管理服务访问，通常保持 127.0.0.1:9880。', info: '如果管理服务和 GPT-SoVITS 推理服务运行在同一台电脑，这里使用 http://127.0.0.1:9880，即使你正在手机上操作也不需要改。只有推理服务位于另一台机器时才填写那台机器的地址。' },
            { key: 'textLang', label: '台词发音语言', type: 'select', group: '语言', help: '只告诉模型如何朗读，不会翻译正文。选择日语时，待合成台词本身也必须是日文。', options: [['zh', '中文'], ['yue', '粤语'], ['ja', '日语'], ['en', '英语'], ['auto', '自动识别']] },
            { key: 'promptLang', label: '模型参考音频语言', type: 'select', group: '语言', help: '选择角色模型文件夹中参考录音的实际语言；无需再手动填写试听路径和文本。', options: [['zh', '中文'], ['ja', '日语'], ['en', '英语']] },
            { key: 'speedFactor', label: '语速', type: 'range', group: '音频', min: 0.6, max: 1.6, step: 0.05 },
        ],
    },
    {
        id: 'voxcpm2',
        name: 'VoxCPM2',
        category: '本地推理',
        mode: '按需启动',
        description: '适合自然韵律、零样本声线与长文本表达的可部署引擎。',
        icon: 'spark',
        capabilities: ['零样本声线', '自然韵律', '长文本', '本地隐私'],
        preview: true,
        defaults: {
            endpoint: 'http://127.0.0.1:8808',
            adapter: 'gradio',
            generatePath: '/v1/audio/speech',
            model: 'openbmb/VoxCPM2',
            speaker: 'default',
            referenceAudio: '',
            controlInstruction: '',
            promptText: '',
            cfgValue: 2,
            inferenceSteps: 10,
            normalize: false,
            denoise: false,
            outputFormat: 'wav',
            streaming: false,
        },
        fields: [
            { key: 'endpoint', label: '服务地址', type: 'url', group: '连接', help: '官方 app.py 默认地址为 http://127.0.0.1:8808。' },
            { key: 'adapter', label: '接口模式', type: 'select', group: '连接', options: [['gradio', '官方 Gradio WebUI'], ['openai', 'OpenAI 兼容服务']] },
            { key: 'generatePath', label: '兼容服务生成路径', type: 'text', group: '连接', help: '仅 OpenAI 兼容模式使用，通常为 /v1/audio/speech。' },
            { key: 'model', label: '模型标识', type: 'text', group: '模型', help: '官方服务默认加载 openbmb/VoxCPM2；这不是在线模型目录。' },
            { key: 'speaker', label: '兼容服务说话人', type: 'text', group: '声线', help: '仅 OpenAI 兼容模式使用。' },
            { key: 'referenceAudio', label: '克隆参考音频', type: 'text', group: '声线', help: '官方 WebUI 模式填写服务端可读取的音频路径；不填写时会设计新声线。' },
            { key: 'controlInstruction', label: '声线与风格描述', type: 'text', group: '声线', help: '例如年龄、音色、语气和节奏；填写参考音频时用于控制表达风格。' },
            { key: 'promptText', label: '参考音频文本', type: 'text', group: '声线', help: '需要高保真延续参考音频时填写。' },
            { key: 'cfgValue', label: '引导强度', type: 'range', group: '音频', min: 1, max: 3, step: 0.1 },
            { key: 'inferenceSteps', label: '推理步数', type: 'range', group: '音频', min: 1, max: 50, step: 1 },
            { key: 'normalize', label: '文本标准化', type: 'switch', group: '音频' },
            { key: 'denoise', label: '参考音频降噪', type: 'switch', group: '音频' },
            { key: 'outputFormat', label: '输出格式', type: 'select', group: '音频', options: [['wav', 'WAV'], ['mp3', 'MP3'], ['flac', 'FLAC']] },
            { key: 'streaming', label: '启用流式返回', type: 'switch', group: '音频' },
        ],
    },
    {
        id: 'edge',
        name: 'Edge TTS',
        category: '宿主插件',
        mode: '需要服务插件',
        description: '通过 SillyTavern Edge TTS 服务插件获取丰富的系统级音色。',
        icon: 'globe',
        capabilities: ['多语言', '音色丰富', '速度调节', '低配置'],
        preview: true,
        defaults: {
            serviceBase: '/api/plugins/edge-tts',
            voice: 'zh-CN-XiaoxiaoNeural',
            rate: 0,
        },
        fields: [
            { key: 'serviceBase', label: '宿主服务路径', type: 'text', group: '连接', help: '默认使用 SillyTavern Edge TTS 服务插件。' },
            { key: 'voice', label: '音色标识', type: 'combo', group: '声线', help: '可从建议列表选择，也可填写服务支持的其他音色 ID。', options: [
                ['zh-CN-XiaoxiaoNeural', '晓晓'],
                ['zh-CN-XiaoyiNeural', '晓伊'],
                ['zh-CN-YunxiNeural', '云希'],
                ['zh-CN-YunjianNeural', '云健'],
                ['ja-JP-NanamiNeural', '日语 七海'],
                ['en-US-JennyNeural', '英语 Jenny'],
            ] },
            { key: 'rate', label: '语速偏移', type: 'range', group: '音频', min: -100, max: 100, step: 5 },
        ],
    },
    {
        id: 'elevenlabs',
        name: 'ElevenLabs',
        category: '云端服务',
        mode: '酒馆安全代理',
        description: '通过 SillyTavern 密钥保险箱调用 ElevenLabs，并同步账号中的预制、复刻与专业音色。',
        icon: 'spark',
        capabilities: ['账号音色同步', '复刻音色', '多语言', '情绪与语速控制'],
        preview: true,
        secretKeys: [SECRET_KEYS.ELEVENLABS],
        defaults: {
            model: 'eleven_multilingual_v2',
            voice: '',
            languageCode: '',
            stability: 0.5,
            similarityBoost: 0.75,
            style: 0,
            speakerBoost: true,
            speed: 1,
        },
        fields: [
            { key: 'elevenLabsApiKey', label: 'ElevenLabs API Key', type: 'secret', group: '凭据', dataKey: 'api_key_elevenlabs', help: '密钥保存在 SillyTavern 安全保险箱中，不会写入插件设置。' },
            { key: 'model', label: '语音模型', type: 'combo', group: '模型', help: 'v3 表现力更强；Flash v2.5 延迟更低；Multilingual v2 更适合稳定长文本。', options: ELEVENLABS_MODEL_CATALOG.map(item => [item.id, item.name]) },
            { key: 'voice', label: '账号音色', type: 'combo', group: '声线', help: '保存 API Key 后点击“检测连接”，即可同步账号中的预制、复刻与专业音色。', options: [] },
            { key: 'languageCode', label: '强制发音语言', type: 'combo', group: '语言', help: '留空自动判断；也可填写 ISO 639-1 代码。Multilingual v2 会忽略该参数并按正文识别。', options: [
                ['', '自动识别'],
                ['zh', '中文'],
                ['ja', '日语'],
                ['en', '英语'],
                ['fr', '法语'],
                ['de', '德语'],
                ['ko', '韩语'],
                ['es', '西班牙语'],
            ] },
            { key: 'stability', label: '稳定度', type: 'range', group: '音频', min: 0, max: 1, step: 0.05 },
            { key: 'similarityBoost', label: '音色相似度', type: 'range', group: '音频', min: 0, max: 1, step: 0.05 },
            { key: 'style', label: '风格强度', type: 'range', group: '音频', min: 0, max: 1, step: 0.05 },
            { key: 'speakerBoost', label: '说话人增强', type: 'switch', group: '音频', help: '增强输出与所选音色的相似度。' },
            { key: 'speed', label: '语速', type: 'range', group: '音频', min: 0.7, max: 1.2, step: 0.05 },
        ],
    },
    {
        id: 'minimax',
        name: 'MiniMax',
        category: '云端服务',
        mode: '无需插件后端',
        description: '可由浏览器直连官方接口，也可选用 SillyTavern 密钥保险箱代理。',
        icon: 'orbit',
        capabilities: ['高品质中文', '账户音色同步', '单文件夹安装', '可选安全代理'],
        preview: true,
        secretKeys: [SECRET_KEYS.MINIMAX],
        defaults: {
            credentialMode: 'direct',
            directApiKey: '',
            apiHost: 'https://api.minimax.io',
            model: 'speech-2.8-hd',
            voice: 'Chinese (Mandarin)_Unrestrained_Young_Man',
            speed: 1,
            volume: 1,
            pitch: 0,
            format: 'mp3',
        },
        fields: [
            { key: 'credentialMode', label: '连接方式', type: 'select', group: '凭据', help: '浏览器直连只需安装本扩展；保险箱代理需要另外启用随扩展提供的服务组件。', options: [
                ['direct', '浏览器直连 · 单文件夹即可'],
                ['vault', '保险箱代理 · 可选增强'],
            ] },
            { key: 'directApiKey', label: '直连 API Key', type: 'password', group: '凭据', help: '仅直连模式使用。密钥保存在当前 SillyTavern 用户的扩展设置中，可被本页脚本读取；请只安装可信扩展。' },
            { key: 'minimaxApiKey', label: '保险箱 API Key', type: 'secret', group: '凭据', dataKey: 'api_key_minimax', help: '仅保险箱代理模式使用；密钥不会进入浏览器端扩展设置。' },
            { key: 'apiHost', label: '服务区域', type: 'select', group: '连接', options: [
                ['https://api.minimax.io', '国际站 · api.minimax.io'],
                ['https://api.minimaxi.com', '中国大陆 · api.minimaxi.com'],
            ] },
            { key: 'model', label: '当前模型', type: 'combo', group: '模型', help: '从上方模型目录选取；同步接口尚未列出的新 ID 也可以直接填写。', options: [
                ['speech-2.8-hd', 'Speech-2.8-HD'],
                ['speech-2.8-turbo', 'Speech-2.8-Turbo'],
                ['speech-2.6-hd', 'Speech-2.6-HD'],
                ['speech-2.6-turbo', 'Speech-2.6-Turbo'],
                ['speech-02-hd', 'Speech-02-HD'],
                ['speech-02-turbo', 'Speech-02-Turbo'],
                ['speech-01-hd', 'Speech-01-HD'],
                ['speech-01-turbo', 'Speech-01-Turbo'],
            ] },
            { key: 'voice', label: '当前音色', type: 'combo', group: '声线', help: '从上方音色库搜索并选择；也可以粘贴系统、快速复刻或音色设计 ID。', options: [
                ['Chinese (Mandarin)_Unrestrained_Young_Man', '不羁青年男声'],
                ['Chinese (Mandarin)_Gentleman', '沉稳绅士'],
                ['Chinese (Mandarin)_Warm_Bestie', '温暖闺蜜'],
                ['Chinese (Mandarin)_Sweet_Lady', '甜美女声'],
            ] },
            { key: 'speed', label: '语速', type: 'range', group: '音频', min: 0.5, max: 2, step: 0.1 },
            { key: 'volume', label: '音量', type: 'range', group: '音频', min: 0, max: 10, step: 0.1 },
            { key: 'pitch', label: '音调', type: 'range', group: '音频', min: -12, max: 12, step: 1 },
            { key: 'format', label: '输出格式', type: 'select', group: '音频', options: [['mp3', 'MP3'], ['wav', 'WAV'], ['flac', 'FLAC']] },
        ],
    },
]);

const listeners = new Set();
const runtimeState = new Map(PROVIDERS.map(provider => [
    provider.id,
    { status: 'idle', message: provider.mode, checkedAt: null },
]));

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function ensureStore() {
    if (!extension_settings[SETTINGS_KEY]) {
        extension_settings[SETTINGS_KEY] = {
            activeProvider: 'gpt_sovits',
            fallbackProvider: '',
            providers: {},
            characterRoutes: {},
            manualCharacters: [],
            hiddenCharacters: [],
            providerCatalogs: {
                elevenlabs: {
                    voices: [],
                    syncedAt: null,
                },
                minimax: {
                    models: [],
                    voices: [],
                    syncedAt: null,
                    warnings: [],
                },
            },
            playback: {
                enabled: true,
                autoGenerate: true,
            },
            ui: {
                theme: '',
                triggerPosition: null,
                triggerDock: 'right',
                homePage: 0,
            },
            tags: {
                preset: 'ttsvoice',
                template: DEFAULT_TAG_TEMPLATE,
            },
            tagPresets: [],
            features: {
                legacyLiveActions: false,
            },
        };
    }

    const store = extension_settings[SETTINGS_KEY];
    store.providers ??= {};
    store.providerCatalogs ??= {};
    store.qqFriends ??= [];
    store.qqGroups ??= [];
    store.stickers ??= [];
    store.proactiveCalls ??= { enabled: true, cooldownMinutes: 30, cooldownByContact: {} };
    store.drawing ??= {
        presets: [],
        activePresetId: '',
        params: {
            model: 'nai-diffusion-3',
            size: 'portrait',
            sampler: 'k_euler',
            scheduler: 'native',
            steps: 28,
            guidance: 5,
            rescale: 0,
            decrisper: 0,
            seed: -1,
        },
    };
    store.providerCatalogs.elevenlabs ??= {};
    store.providerCatalogs.elevenlabs = {
        voices: Array.isArray(store.providerCatalogs.elevenlabs.voices)
            ? store.providerCatalogs.elevenlabs.voices
            : [],
        syncedAt: store.providerCatalogs.elevenlabs.syncedAt || null,
    };
    store.providerCatalogs.minimax ??= {};
    store.providerCatalogs.minimax = {
        models: Array.isArray(store.providerCatalogs.minimax.models)
            ? store.providerCatalogs.minimax.models
            : [],
        voices: Array.isArray(store.providerCatalogs.minimax.voices)
            ? store.providerCatalogs.minimax.voices
            : [],
        syncedAt: store.providerCatalogs.minimax.syncedAt || null,
        warnings: Array.isArray(store.providerCatalogs.minimax.warnings)
            ? store.providerCatalogs.minimax.warnings.map(item => String(item))
            : [],
    };
    store.characterRoutes ??= {};
    store.manualCharacters = [...new Set((store.manualCharacters || []).map(name => String(name).trim()).filter(Boolean))];
    store.hiddenCharacters = [...new Set((store.hiddenCharacters || []).map(name => String(name).trim()).filter(Boolean))];
    if (!PROVIDERS.some(provider => provider.id === store.activeProvider)) {
        store.activeProvider = 'gpt_sovits';
    }
    store.fallbackProvider ??= '';
    if (store.fallbackProvider && !PROVIDERS.some(provider => provider.id === store.fallbackProvider)) {
        store.fallbackProvider = '';
    }
    if (store.fallbackProvider === store.activeProvider) store.fallbackProvider = '';
    store.playback = {
        enabled: store.playback?.enabled !== false,
        autoGenerate: store.playback?.autoGenerate !== false,
    };
    const savedTriggerPosition = store.ui?.triggerPosition;
    store.ui = {
        theme: ['dark', 'light', 'system', 'custom'].includes(store.ui?.theme) ? store.ui.theme : '',
        triggerPosition: Number.isFinite(savedTriggerPosition?.xRatio)
            && Number.isFinite(savedTriggerPosition?.yRatio)
            ? {
                xRatio: Math.min(1, Math.max(0, savedTriggerPosition.xRatio)),
                yRatio: Math.min(1, Math.max(0, savedTriggerPosition.yRatio)),
            }
            : null,
        triggerDock: store.ui?.triggerDock === 'left' ? 'left' : 'right',
        homePage: Number(store.ui?.homePage) === 1 ? 1 : 0,
        customTheme: {
            bg: String(store.ui?.customTheme?.bg || ''),
            surface: String(store.ui?.customTheme?.surface || ''),
            accent: String(store.ui?.customTheme?.accent || ''),
            glow: String(store.ui?.customTheme?.glow || ''),
            wallpaper: String(store.ui?.customTheme?.wallpaper || ''),
        },
        bodyAutoRender: store.ui?.bodyAutoRender !== false,
        hiddenCurrentCharName: String(store.ui?.hiddenCurrentCharName || ''),
    };
    // 迁移：把旧版保存的 [TTSVoice:…] 触发格式改写为 PLAN 的 [TTS:…]。
    const normalizeTagTemplate = value => String(value || '').replaceAll('[TTSVoice:', '[TTS:').trim();
    store.tagPresets = Array.isArray(store.tagPresets)
        ? store.tagPresets.filter(item => item?.id && item?.name && isValidTagTemplate(normalizeTagTemplate(item?.template))).slice(0, 30).map(item => ({
            id: String(item.id),
            name: String(item.name).trim().slice(0, 60),
            template: normalizeTagTemplate(item.template),
            updatedAt: item.updatedAt || new Date().toISOString(),
        }))
        : [];
    const availableTagPresets = [...TAG_PRESETS, ...store.tagPresets];
    const savedTagPreset = availableTagPresets.some(item => item.id === store.tags?.preset)
        ? store.tags.preset
        : 'ttsvoice';
    const presetTemplate = availableTagPresets.find(item => item.id === savedTagPreset)?.template;
    const savedTemplate = normalizeTagTemplate(store.tags?.template || presetTemplate || DEFAULT_TAG_TEMPLATE);
    store.tags = {
        preset: savedTagPreset,
        template: isValidTagTemplate(savedTemplate) ? savedTemplate : DEFAULT_TAG_TEMPLATE,
    };
    store.features = {
        legacyLiveActions: store.features?.legacyLiveActions === true,
    };

    for (const provider of PROVIDERS) {
        store.providers[provider.id] = {
            ...clone(provider.defaults),
            ...(store.providers[provider.id] || {}),
        };
    }
    if (['https://api.minimaxi.chat', 'https://api.minimax.chat'].includes(store.providers.minimax.apiHost)) {
        store.providers.minimax.apiHost = 'https://api.minimaxi.com';
    }
    for (const [characterName, route] of Object.entries(store.characterRoutes)) {
        if (!PROVIDERS.some(provider => provider.id === route?.providerId)) {
            delete store.characterRoutes[characterName];
        }
    }

    return store;
}

function emitChange(type, providerId) {
    const detail = { type, providerId, snapshot: getSnapshot() };
    for (const listener of listeners) listener(detail);
    window.dispatchEvent(new CustomEvent('tts:provider-change', { detail }));
}

function setRuntime(providerId, next) {
    runtimeState.set(providerId, {
        ...runtimeState.get(providerId),
        ...next,
        checkedAt: Date.now(),
    });
    emitChange('runtime', providerId);
}

function getProvider(providerId) {
    return PROVIDERS.find(provider => provider.id === providerId) || null;
}

function getSettings(providerId) {
    return clone(ensureStore().providers[providerId] || {});
}

function updateSettings(providerId, updates) {
    const provider = getProvider(providerId);
    if (!provider) throw new Error(`未知语音引擎：${providerId}`);

    const allowedKeys = new Set(provider.fields.filter(field => field.type !== 'secret').map(field => field.key));
    const safeUpdates = Object.fromEntries(
        Object.entries(updates).filter(([key]) => allowedKeys.has(key)),
    );

    const store = ensureStore();
    const nextSettings = {
        ...store.providers[providerId],
        ...safeUpdates,
    };
    if (JSON.stringify(store.providers[providerId]) === JSON.stringify(nextSettings)) {
        return getSettings(providerId);
    }
    store.providers[providerId] = nextSettings;
    saveSettingsDebounced();
    emitChange('settings', providerId);
    return getSettings(providerId);
}

function mergeCatalogItems(baseItems, extraItems) {
    const merged = new Map();
    for (const item of [...baseItems, ...extraItems]) {
        const id = String(item?.id || '').trim();
        if (!id) continue;
        merged.set(id, { ...merged.get(id), ...item, id });
    }
    return [...merged.values()];
}

function normalizeElevenLabsVoices(payload) {
    return (Array.isArray(payload?.voices) ? payload.voices : [])
        .map(item => {
            const labels = item?.labels && typeof item.labels === 'object'
                ? Object.values(item.labels).map(value => String(value).trim()).filter(Boolean)
                : [];
            return {
                id: String(item?.voice_id || '').trim(),
                name: String(item?.name || item?.voice_id || '').trim(),
                category: String(item?.category || 'account').trim(),
                description: String(item?.description || labels.join(' · ')).trim(),
                previewUrl: String(item?.preview_url || '').trim(),
            };
        })
        .filter(item => item.id);
}

function getElevenLabsCatalog() {
    const store = ensureStore();
    const saved = store.providerCatalogs.elevenlabs;
    const settings = store.providers.elevenlabs;
    const voices = [...saved.voices];
    if (settings.voice && !voices.some(item => item.id === settings.voice)) {
        voices.unshift({
            id: settings.voice,
            name: settings.voice,
            category: 'custom',
            description: '当前手动填写的音色',
            previewUrl: '',
        });
    }
    return clone({
        models: ELEVENLABS_MODEL_CATALOG,
        voices,
        syncedAt: saved.syncedAt,
    });
}

async function syncElevenLabsCatalog() {
    const provider = getProvider('elevenlabs');
    if (!hasSecrets(provider)) {
        throw new Error('请先在密钥保险箱保存 ElevenLabs API Key。');
    }
    const response = await fetch(`${ELEVENLABS_API_BASE}/voices`, {
        method: 'POST',
        headers: getRequestHeaders(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail = payload?.detail?.message || payload?.detail || payload?.message;
        throw new Error(detail || (response.status === 400
            ? 'ElevenLabs API Key 尚未保存或不可用。'
            : `ElevenLabs 音色同步失败（${response.status}）。`));
    }
    const voices = normalizeElevenLabsVoices(payload);
    if (!voices.length) throw new Error('ElevenLabs 没有返回可用音色。');
    const store = ensureStore();
    store.providerCatalogs.elevenlabs = {
        voices,
        syncedAt: new Date().toISOString(),
    };
    saveSettingsDebounced();
    emitChange('catalog', 'elevenlabs');
    return getElevenLabsCatalog();
}

function getMiniMaxCatalog() {
    const store = ensureStore();
    const saved = store.providerCatalogs.minimax;
    const settings = store.providers.minimax;
    const models = mergeCatalogItems(MINIMAX_MODEL_CATALOG, saved.models);
    const voices = mergeCatalogItems(MINIMAX_STARTER_VOICES, saved.voices);

    if (settings.model && !models.some(item => item.id === settings.model)) {
        models.push({ id: settings.model, name: settings.model, note: '手动填写的模型' });
    }
    if (settings.voice && !voices.some(item => item.id === settings.voice)) {
        voices.push({
            id: settings.voice,
            name: settings.voice,
            category: 'custom',
            description: '当前手动填写的音色',
        });
    }

    return clone({
        models,
        voices,
        syncedAt: saved.syncedAt,
        warnings: saved.warnings,
        source: saved.syncedAt ? 'account' : 'starter',
    });
}

function normalizeMiniMaxVoices(payload) {
    const groups = [
        ['system_voice', 'system'],
        ['voice_cloning', 'cloning'],
        ['voice_generation', 'generation'],
        ['music_generation', 'music'],
    ];
    return groups.flatMap(([key, category]) => (
        Array.isArray(payload?.[key]) ? payload[key] : []
    ).map(item => ({
        id: String(item?.voice_id || '').trim(),
        name: String(item?.voice_name || item?.voice_id || '').trim(),
        category,
        description: Array.isArray(item?.description)
            ? item.description.filter(Boolean).join('；')
            : String(item?.description || ''),
        createdAt: item?.created_time || null,
    }))).filter(item => item.id);
}

function getMiniMaxCredentialMode(settings = getSettings('minimax')) {
    return settings.credentialMode === 'vault' ? 'vault' : 'direct';
}

function getMiniMaxDirectKey(settings = getSettings('minimax')) {
    return String(settings.directApiKey || '').trim();
}

function resolveMiniMaxApiHost(settings) {
    const host = String(settings.apiHost || '').trim().replace(/\/+$/, '');
    if (!['https://api.minimax.io', 'https://api.minimaxi.com'].includes(host)) {
        throw new Error('请选择有效的 MiniMax 官方服务区域。');
    }
    return host;
}

async function readMiniMaxJson(response, label) {
    const text = await response.text();
    let payload;
    try {
        payload = JSON.parse(text);
    } catch {
        throw new Error(`${label}失败：MiniMax 返回了无法识别的内容（HTTP ${response.status}）。`);
    }
    const statusCode = payload?.base_resp?.status_code;
    if (!response.ok || (statusCode !== undefined && statusCode !== 0)) {
        const detail = payload?.base_resp?.status_msg
            || payload?.error?.message
            || payload?.message
            || `HTTP ${response.status}`;
        const error = new Error(`${label}失败：${detail}`);
        error.status = response.status;
        const retryAfter = String(response.headers.get('retry-after') || '').trim();
        if (retryAfter) {
            const seconds = Number(retryAfter);
            error.retryAfterMs = Number.isFinite(seconds)
                ? Math.max(0, seconds * 1000)
                : Math.max(0, Date.parse(retryAfter) - Date.now());
        }
        throw error;
    }
    return payload;
}

async function callMiniMaxDirect(settings, path, options = {}, label = 'MiniMax 请求') {
    const apiKey = getMiniMaxDirectKey(settings);
    if (!apiKey) {
        throw new Error('请先填写直连 API Key 并保存配置。');
    }
    const requestOptions = {
        ...options,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    };
    const response = options.signal
        ? await fetch(`${resolveMiniMaxApiHost(settings)}${path}`, requestOptions)
        : await fetchWithTimeout(`${resolveMiniMaxApiHost(settings)}${path}`, requestOptions, 60000);
    return readMiniMaxJson(response, label);
}

function normalizeMiniMaxEmotion(value) {
    const aliases = {
        开心: 'happy',
        快乐: 'happy',
        高兴: 'happy',
        悲伤: 'sad',
        难过: 'sad',
        伤心: 'sad',
        生气: 'angry',
        愤怒: 'angry',
        害怕: 'fearful',
        恐惧: 'fearful',
        厌恶: 'disgusted',
        惊讶: 'surprised',
        平静: 'neutral',
        中性: 'neutral',
    };
    const normalized = String(value || '').trim();
    if (!normalized || ['default', '自然', '普通'].includes(normalized)) return '';
    if (Object.values(aliases).includes(normalized)) return normalized;
    return aliases[normalized] || '';
}

function isMiniMaxEmotionParameterError(error) {
    return /voice_setting[\s._-]*emotion|emotion[^\n]*(?:invalid|参数)/i.test(String(error?.message || error));
}

function isMiniMaxRateLimitError(error) {
    return Number(error?.status) === 429
        || /(?:HTTP\s*)?429|rate[\s_-]*limit|too many requests|请求过于频繁|请求频率|频率限制|速率上限|限流/i.test(String(error?.message || error));
}

function waitForRetry(ms, signal) {
    if (signal?.aborted) {
        const error = new Error('已取消生成');
        error.name = 'AbortError';
        return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            signal?.removeEventListener?.('abort', onAbort);
            const error = new Error('已取消生成');
            error.name = 'AbortError';
            reject(error);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener?.('abort', onAbort);
            resolve();
        }, Math.max(0, ms));
        signal?.addEventListener?.('abort', onAbort, { once: true });
    });
}

async function syncMiniMaxCatalog() {
    const provider = getProvider('minimax');
    const settings = getSettings('minimax');
    const credentialMode = getMiniMaxCredentialMode(settings);
    let payload;

    if (credentialMode === 'direct') {
        const [voicesResult, modelsResult] = await Promise.allSettled([
            callMiniMaxDirect(settings, '/v1/get_voice', {
                method: 'POST',
                body: JSON.stringify({ voice_type: 'all' }),
            }, '账户音色同步'),
            callMiniMaxDirect(settings, '/v1/models', {
                method: 'GET',
            }, '账户模型同步'),
        ]);
        if (voicesResult.status === 'rejected' && modelsResult.status === 'rejected') {
            throw new Error([
                voicesResult.reason?.message,
                modelsResult.reason?.message,
            ].filter(Boolean).join('；') || 'MiniMax 资源同步失败。');
        }
        payload = {
            voices: voicesResult.status === 'fulfilled' ? voicesResult.value : null,
            models: modelsResult.status === 'fulfilled' ? modelsResult.value : null,
            speechModels: [],
            warnings: [
                ...(voicesResult.status === 'rejected' ? [voicesResult.reason?.message || '账户音色同步失败'] : []),
                ...(modelsResult.status === 'rejected' ? [modelsResult.reason?.message || '账户模型同步失败'] : []),
            ],
            syncedAt: new Date().toISOString(),
        };
    } else {
        if (!hasSecrets(provider)) {
            throw new Error('请先在密钥保险箱保存 MiniMax API Key。');
        }
        let response;
        try {
            response = await fetch(MINIMAX_RESOURCE_ENDPOINT, {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ apiHost: settings.apiHost }),
            });
        } catch {
            throw new Error('保险箱代理服务未连接。你可以切换为“浏览器直连”，无需安装额外组件。');
        }
        payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('保险箱代理服务未安装。切换为“浏览器直连”即可在普通扩展目录中直接使用。');
            }
            throw new Error(payload.error || `MiniMax 资源同步失败（${response.status}）`);
        }
    }

    const accountModels = (Array.isArray(payload.models?.data) ? payload.models.data : [])
        .map(item => ({
            id: String(item?.id || '').trim(),
            name: String(item?.id || '').trim(),
            note: '账户模型接口返回',
            createdAt: item?.created || null,
        }))
        .filter(item => /^speech-/i.test(item.id));
    const documentedModels = (Array.isArray(payload.speechModels) ? payload.speechModels : [])
        .map(item => ({
            id: String(item?.id || '').trim(),
            name: String(item?.name || item?.id || '').trim(),
            note: String(item?.note || 'MiniMax 官方 T2A 文档'),
        }))
        .filter(item => /^speech-/i.test(item.id));
    const remoteModels = mergeCatalogItems(documentedModels, accountModels);
    const remoteVoices = normalizeMiniMaxVoices(payload.voices);
    const store = ensureStore();
    const previous = store.providerCatalogs.minimax;
    const warnings = [...(payload.warnings || [])];
    if (payload.models && remoteModels.length === 0) {
        warnings.push('模型接口未返回语音模型，已保留内置的官方语音模型目录。');
    }
    store.providerCatalogs.minimax = {
        models: remoteModels.length ? remoteModels : previous.models,
        voices: remoteVoices.length ? remoteVoices : previous.voices,
        syncedAt: payload.syncedAt || new Date().toISOString(),
        warnings,
    };
    saveSettingsDebounced();
    emitChange('catalog', 'minimax');
    return getMiniMaxCatalog();
}

function setActive(providerId) {
    if (!getProvider(providerId)) throw new Error(`未知语音引擎：${providerId}`);
    const store = ensureStore();
    if (store.activeProvider === providerId) return providerId;
    store.activeProvider = providerId;
    if (store.fallbackProvider === providerId) store.fallbackProvider = '';
    saveSettingsDebounced();
    emitChange('active', providerId);
}

function setFallback(providerId) {
    if (providerId && !getProvider(providerId)) throw new Error(`未知语音引擎：${providerId}`);
    const store = ensureStore();
    const nextProvider = providerId || '';
    if (nextProvider === store.activeProvider) {
        throw new Error('回退引擎不能与当前默认语音引擎相同。');
    }
    if (store.fallbackProvider === nextProvider) return nextProvider;
    store.fallbackProvider = nextProvider;
    saveSettingsDebounced();
    emitChange('fallback', providerId || null);
}

function getPlaybackSettings() {
    return clone(ensureStore().playback);
}

function syncPlaybackState() {
    const playback = getPlaybackSettings();
    const cacheSettings = window.TTS_State?.CACHE?.settings;
    if (cacheSettings) {
        cacheSettings.enabled = playback.enabled;
        cacheSettings.auto_generate = playback.autoGenerate;
    }
    return playback;
}

function updatePlaybackSettings(updates = {}) {
    const store = ensureStore();
    const nextPlayback = {
        enabled: updates.enabled === undefined ? store.playback.enabled : Boolean(updates.enabled),
        autoGenerate: updates.autoGenerate === undefined
            ? store.playback.autoGenerate
            : Boolean(updates.autoGenerate),
    };
    if (JSON.stringify(store.playback) === JSON.stringify(nextPlayback)) {
        syncPlaybackState();
        return getPlaybackSettings();
    }
    store.playback = nextPlayback;
    syncPlaybackState();
    saveSettingsDebounced();
    emitChange('playback', store.activeProvider);
    return getPlaybackSettings();
}

function getUiSettings() {
    return clone(ensureStore().ui);
}

function updateUiSettings(updates = {}) {
    const store = ensureStore();
    const previous = JSON.stringify(store.ui);
    if (updates.theme !== undefined) {
        store.ui.theme = ['dark', 'light', 'system', 'custom'].includes(updates.theme) ? updates.theme : '';
    }
    if (updates.customTheme !== undefined) {
        store.ui.customTheme = { ...store.ui.customTheme, ...updates.customTheme };
    }
    if (updates.triggerDock !== undefined) {
        store.ui.triggerDock = updates.triggerDock === 'left' ? 'left' : 'right';
    }
    if (updates.homePage !== undefined) {
        store.ui.homePage = Number(updates.homePage) === 1 ? 1 : 0;
    }
    if (updates.bodyAutoRender !== undefined) {
        store.ui.bodyAutoRender = Boolean(updates.bodyAutoRender);
    }
    if (updates.hiddenCurrentCharName !== undefined) {
        store.ui.hiddenCurrentCharName = String(updates.hiddenCurrentCharName || '');
    }
    if (updates.triggerPosition !== undefined) {
        const position = updates.triggerPosition;
        store.ui.triggerPosition = Number.isFinite(position?.xRatio)
            && Number.isFinite(position?.yRatio)
            ? {
                xRatio: Math.min(1, Math.max(0, position.xRatio)),
                yRatio: Math.min(1, Math.max(0, position.yRatio)),
            }
            : null;
    }
    if (previous === JSON.stringify(store.ui)) return getUiSettings();
    saveSettingsDebounced();
    return getUiSettings();
}

function getQqState() {
    const store = ensureStore();
    return {
        friends: clone(store.qqFriends),
        groups: clone(store.qqGroups),
        stickers: clone(store.stickers),
        proactiveCalls: clone(store.proactiveCalls),
    };
}

function updateQqState(updates = {}) {
    const store = ensureStore();
    if (updates.friends !== undefined) store.qqFriends = clone(updates.friends);
    if (updates.groups !== undefined) store.qqGroups = clone(updates.groups);
    if (updates.stickers !== undefined) store.stickers = clone(updates.stickers);
    if (updates.proactiveCalls !== undefined) store.proactiveCalls = { ...store.proactiveCalls, ...updates.proactiveCalls };
    saveSettingsDebounced();
    return getQqState();
}

function getDrawingSettings() {
    return clone(ensureStore().drawing);
}

function updateDrawingSettings(updates = {}) {
    const store = ensureStore();
    if (updates.presets !== undefined) store.drawing.presets = clone(updates.presets);
    if (updates.activePresetId !== undefined) store.drawing.activePresetId = String(updates.activePresetId || '');
    if (updates.params !== undefined) store.drawing.params = { ...store.drawing.params, ...updates.params };
    saveSettingsDebounced();
    return getDrawingSettings();
}

function isValidTagTemplate(template) {
    const value = String(template || '');
    if (value === VISIBLE_TAG_TEMPLATE) return true;
    return ['{角色}', '{情绪}', '{文本}'].every(token => value.split(token).length === 2);
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createTagRegex() {
    const template = getTagSettings().template;
    if (template === VISIBLE_TAG_TEMPLATE) {
        // 中文译文是普通正文，只替换后面的 TTS 标签。这样即使 Markdown
        // 在两者之间插入空格、换行或 <br>，语音条也能在普通模式渲染。
        return /(\s*)\[(?:TTSVoice|TTS)\s*[:：]\s*(?<speaker>[^:：\]]+?)\s*[:：]\s*(?<emotion>[^:：\]]*?)\s*[:：]\s*(?<text>[\s\S]*?)\]/gi;
    }
    const tokenPattern = /(\{角色\}|\{情绪\}|\{文本\})/g;
    let cursor = 0;
    let pattern = '(\\s*)';
    for (const match of template.matchAll(tokenPattern)) {
        pattern += escapeRegex(template.slice(cursor, match.index));
        const names = { '{角色}': 'speaker', '{情绪}': 'emotion', '{文本}': 'text' };
        pattern += `(?<${names[match[0]]}>[\\s\\S]*?)`;
        cursor = match.index + match[0].length;
    }
    pattern += escapeRegex(template.slice(cursor));
    return new RegExp(pattern, 'gi');
}

function getTagSettings() {
    return clone(ensureStore().tags);
}

function getTagPresets() {
    const customEditor = TAG_PRESETS.find(item => item.id === 'custom');
    return clone([
        ...TAG_PRESETS.filter(item => item.id !== 'custom'),
        ...ensureStore().tagPresets,
        customEditor,
    ]);
}

function updateTagSettings(updates = {}) {
    const store = ensureStore();
    const availablePresets = [...TAG_PRESETS, ...store.tagPresets];
    const preset = availablePresets.some(item => item.id === updates.preset)
        ? updates.preset
        : store.tags.preset;
    const presetTemplate = availablePresets.find(item => item.id === preset)?.template;
    const template = String(
        updates.template ?? (preset === 'custom' ? store.tags.template : presetTemplate) ?? store.tags.template,
    ).trim();
    if (!isValidTagTemplate(template)) {
        throw new Error('触发格式必须各包含一次 {角色}、{情绪} 和 {文本}；正文可见格式另外使用 {译文}。');
    }
    const next = { preset, template };
    if (JSON.stringify(next) === JSON.stringify(store.tags)) return getTagSettings();
    store.tags = next;
    saveSettingsDebounced();
    emitChange('tags', store.activeProvider);
    return getTagSettings();
}

function saveTagPreset(name, template) {
    const presetName = String(name || '').trim().slice(0, 60);
    const value = String(template || '').trim();
    if (!presetName) throw new Error('请先填写格式预设名称。');
    if (!isValidTagTemplate(value)) throw new Error('触发格式必须各包含一次 {角色}、{情绪} 和 {文本}；正文可见格式另外使用 {译文}。');
    const store = ensureStore();
    let preset = store.tagPresets.find(item => item.name.toLocaleLowerCase('zh-CN') === presetName.toLocaleLowerCase('zh-CN'));
    if (preset) {
        preset.template = value;
        preset.updatedAt = new Date().toISOString();
    } else {
        preset = {
            id: `tag-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`}`,
            name: presetName,
            template: value,
            updatedAt: new Date().toISOString(),
        };
        store.tagPresets.unshift(preset);
        store.tagPresets = store.tagPresets.slice(0, 30);
    }
    store.tags = { preset: preset.id, template: value };
    saveSettingsDebounced();
    emitChange('tags', store.activeProvider);
    return clone(preset);
}

function deleteTagPreset(id) {
    const store = ensureStore();
    const index = store.tagPresets.findIndex(item => item.id === id);
    if (index < 0) return false;
    store.tagPresets.splice(index, 1);
    if (store.tags.preset === id) store.tags = { preset: 'ttsvoice', template: DEFAULT_TAG_TEMPLATE };
    saveSettingsDebounced();
    emitChange('tags', store.activeProvider);
    return true;
}

function getFeatureSettings() {
    return clone(ensureStore().features);
}

function updateFeatureSettings(updates = {}) {
    const store = ensureStore();
    const nextFeatures = {
        legacyLiveActions: updates.legacyLiveActions === undefined
            ? store.features.legacyLiveActions
            : Boolean(updates.legacyLiveActions),
    };
    if (JSON.stringify(store.features) === JSON.stringify(nextFeatures)) {
        return getFeatureSettings();
    }
    store.features = nextFeatures;
    saveSettingsDebounced();
    emitChange('features', store.activeProvider);
    return getFeatureSettings();
}

function getCharacterRoute(characterName) {
    const name = String(characterName || '').trim();
    if (!name) return null;
    const route = ensureStore().characterRoutes[name];
    return route ? clone(route) : null;
}

function setCharacterRoute(characterName, route) {
    const name = String(characterName || '').trim();
    if (!name) throw new Error('角色名称不能为空。');
    if (!getProvider(route?.providerId)) throw new Error(`未知语音引擎：${route?.providerId}`);

    const normalized = {
        providerId: route.providerId,
        model: String(route.model || '').trim(),
        voice: String(route.voice || '').trim(),
        referenceAudio: String(route.referenceAudio || '').trim(),
        promptText: String(route.promptText || '').trim(),
    };
    const store = ensureStore();
    if (JSON.stringify(store.characterRoutes[name]) === JSON.stringify(normalized)) {
        return clone(normalized);
    }
    store.characterRoutes[name] = normalized;
    saveSettingsDebounced();
    emitChange('character-route', route.providerId);
    return clone(normalized);
}

function removeCharacterRoute(characterName) {
    const name = String(characterName || '').trim();
    if (!name) return;
    const store = ensureStore();
    if (!store.characterRoutes[name]) return;
    delete store.characterRoutes[name];
    saveSettingsDebounced();
    emitChange('character-route', null);
}

function addCharacter(characterName) {
    const name = String(characterName || '').trim();
    if (!name) throw new Error('角色名称不能为空。');
    const store = ensureStore();
    if (!store.manualCharacters.includes(name)) store.manualCharacters.push(name);
    store.hiddenCharacters = store.hiddenCharacters.filter(item => item !== name);
    saveSettingsDebounced();
    emitChange('characters', null);
    return name;
}

/**
 * 正文 / 来电中出现的说话人自动收录进通讯录。
 * 与 addCharacter 不同：已进入忽略名单（被用户删除）的说话人不会自动恢复，必须手动添加。
 */
function addBodySpeaker(characterName) {
    const name = String(characterName || '').trim();
    if (!name) return;
    const store = ensureStore();
    if (store.hiddenCharacters.includes(name)) return;
    if (!store.manualCharacters.includes(name)) store.manualCharacters.push(name);
    saveSettingsDebounced();
    emitChange('characters', null);
}

function deleteCharacter(characterName) {
    const name = String(characterName || '').trim();
    if (!name) return;
    const store = ensureStore();
    delete store.characterRoutes[name];
    store.manualCharacters = store.manualCharacters.filter(item => item !== name);
    if (!store.hiddenCharacters.includes(name)) store.hiddenCharacters.push(name);
    saveSettingsDebounced();
    emitChange('characters', null);
}

function shouldShowCharacter(characterName) {
    const name = String(characterName || '').trim();
    return Boolean(name) && !ensureStore().hiddenCharacters.includes(name);
}

function resolveRoute(characterName) {
    const store = ensureStore();
    const characterRoute = getCharacterRoute(characterName);
    return characterRoute || {
        providerId: store.activeProvider,
        model: '',
        voice: '',
        referenceAudio: '',
        promptText: '',
    };
}

function hasSecrets(provider) {
    return !provider.secretKeys?.length || provider.secretKeys.every(key => Boolean(secret_state[key]));
}

function hasCredentials(provider) {
    if (provider.id !== 'minimax') return hasSecrets(provider);
    const settings = getSettings('minimax');
    return getMiniMaxCredentialMode(settings) === 'direct'
        ? Boolean(getMiniMaxDirectKey(settings))
        : hasSecrets(provider);
}

function refreshSecretRuntime(secretKey) {
    for (const provider of PROVIDERS.filter(item => item.secretKeys?.includes(secretKey))) {
        const settings = getSettings(provider.id);
        if (!hasCredentials(provider)) {
            setRuntime(provider.id, { status: 'needs-config', message: '需要配置安全凭据' });
        } else {
            setRuntime(provider.id, { status: 'idle', message: '凭据已更新，等待检测或试听' });
        }
    }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 3500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function checkProvider(providerId) {
    const provider = getProvider(providerId);
    if (!provider) throw new Error(`未知语音引擎：${providerId}`);

    setRuntime(providerId, { status: 'checking', message: '正在检测' });
    const settings = getSettings(providerId);

    try {
        if (providerId === 'elevenlabs') {
            if (!hasSecrets(provider)) {
                setRuntime(providerId, { status: 'needs-config', message: '需要配置 ElevenLabs API Key' });
                return runtimeState.get(providerId);
            }
            const startedAt = Date.now();
            const catalog = await syncElevenLabsCatalog();
            setRuntime(providerId, {
                status: 'ready',
                message: `官方接口已连接 · ${catalog.voices.length} 个账号音色 · ${Date.now() - startedAt}ms`,
            });
            return runtimeState.get(providerId);
        }
        if (providerId === 'minimax') {
            if (!hasCredentials(provider)) {
                setRuntime(providerId, { status: 'needs-config', message: '需要配置 MiniMax API Key' });
                return runtimeState.get(providerId);
            }
            if (getMiniMaxCredentialMode(settings) === 'direct') {
                const startedAt = Date.now();
                const result = await callMiniMaxDirect(settings, '/v1/get_voice', {
                    method: 'POST',
                    body: JSON.stringify({ voice_type: 'system' }),
                }, 'MiniMax 连接检测');
                const count = Array.isArray(result.system_voice) ? result.system_voice.length : 0;
                setRuntime(providerId, {
                    status: 'ready',
                    message: `官方接口已连接 · ${count} 个系统音色 · ${Date.now() - startedAt}ms`,
                });
                return runtimeState.get(providerId);
            }
            setRuntime(providerId, { status: 'ready', message: '保险箱凭据已配置，等待同步或试听' });
            return runtimeState.get(providerId);
        }
        if (provider.secretKeys?.length) {
            if (!hasSecrets(provider)) {
                setRuntime(providerId, { status: 'needs-config', message: '需要配置安全凭据' });
                return runtimeState.get(providerId);
            }
            setRuntime(providerId, { status: 'ready', message: '凭据已配置，未发送合成请求' });
            return runtimeState.get(providerId);
        }

        if (providerId === 'edge') {
            const response = await fetchWithTimeout(`${settings.serviceBase.replace(/\/+$/, '')}/probe`, {
                method: 'POST',
                headers: getRequestHeaders({ omitContentType: true }),
            });
            if (!response.ok) throw new Error(`服务返回 ${response.status}`);
            setRuntime(providerId, { status: 'ready', message: '宿主服务已连接' });
            return runtimeState.get(providerId);
        }

        const endpoint = providerId === 'gpt_sovits'
            ? joinUrl(settings.managerEndpoint, '/get_data')
            : settings.endpoint;
        const response = await fetchWithTimeout(
            endpoint,
            { method: 'GET' },
            providerId === 'gpt_sovits' ? 15000 : 3500,
        );
        if (providerId === 'gpt_sovits' && response.ok) {
            const data = await response.clone().json().catch(() => null);
            if (data && window.TTS_State?.CACHE) {
                window.TTS_State.CACHE.models = data.models || {};
                window.TTS_State.CACHE.mappings = data.mappings || {};
                window.TTS_State.CACHE.backendAvailable = true;
            }
        }
        if (providerId === 'gpt_sovits' && !response.ok && window.TTS_State?.CACHE) {
            window.TTS_State.CACHE.backendAvailable = false;
        }
        setRuntime(providerId, {
            status: response.ok ? 'ready' : 'reachable',
            message: response.ok ? '服务已连接' : `服务可访问（${response.status}）`,
        });
        return runtimeState.get(providerId);
    } catch (error) {
        if (providerId === 'gpt_sovits' && window.TTS_State?.CACHE) {
            window.TTS_State.CACHE.backendAvailable = false;
        }
        const offlineMessages = {
            indextts2: 'IndexTTS2 服务未启动',
            gpt_sovits: 'GPT-SoVITS 管理服务未启动',
            voxcpm2: 'VoxCPM2 服务未启动',
            edge: '未检测到 Edge TTS 服务插件',
        };
        const message = error?.name === 'AbortError'
            ? '连接超时，服务未启动'
            : (providerId === 'elevenlabs'
                ? error?.message || 'ElevenLabs 连接失败'
                : (offlineMessages[providerId] || '当前未启动'));
        setRuntime(providerId, { status: 'offline', message });
        return runtimeState.get(providerId);
    }
}

function joinUrl(base, path) {
    return new URL(path || '/', base.endsWith('/') ? base : `${base}/`).toString();
}

function base64ToBlob(encoded, mimeType = 'audio/wav') {
    const clean = encoded.includes(',') ? encoded.split(',').pop() : encoded;
    const bytes = Uint8Array.from(atob(clean), char => char.charCodeAt(0));
    return new Blob([bytes], { type: mimeType });
}

async function responseToAudioBlob(response, baseUrl) {
    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(errorText || `语音生成失败（${response.status}）`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.startsWith('audio/') || contentType.includes('octet-stream')) return response.blob();

    const data = await response.json();
    const encoded = data.audio || data.audio_base64 || data.data?.audio || data.data?.audio_base64;
    if (encoded) return base64ToBlob(encoded, data.mime_type || data.content_type || 'audio/wav');

    const audioUrl = data.url || data.audio_url || data.path || data.data?.url || data.data?.audio_url || findAudioPath(data);
    if (!audioUrl) throw new Error('服务已响应，但没有返回可识别的音频数据。');
    const audioResponse = await fetch(joinUrl(baseUrl, audioUrl));
    if (!audioResponse.ok) throw new Error(`无法下载生成的音频（${audioResponse.status}）`);
    return audioResponse.blob();
}

function findAudioPath(value) {
    if (typeof value === 'string' && /\.(wav|mp3|flac|aac)(\?|$)/i.test(value)) return value;
    if (!value || typeof value !== 'object') return null;
    for (const key of ['url', 'path', 'value', 'name']) {
        const found = findAudioPath(value[key]);
        if (found) return found;
    }
    for (const child of Object.values(value)) {
        const found = findAudioPath(child);
        if (found) return found;
    }
    return null;
}

function asGradioFile(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    const path = String(value).trim();
    if (!path) return null;
    const isRemote = /^https?:\/\//i.test(path);
    return {
        path,
        ...(isRemote ? {
            url: path,
            orig_name: path.split('/').pop()?.split('?')[0] || 'reference-audio',
        } : {}),
        meta: { _type: 'gradio.FileData' },
    };
}

async function callGradio(baseUrl, apiName, data, request, label) {
    const callUrl = joinUrl(baseUrl, `/gradio_api/call/${apiName}`);
    const queued = await fetch(callUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
        signal: request.signal,
    });
    if (!queued.ok) throw new Error(`${label} 任务提交失败（${queued.status}）`);
    const { event_id: eventId } = await queued.json();
    if (!eventId) throw new Error(`${label} 未返回任务编号。`);

    const result = await fetch(`${callUrl}/${encodeURIComponent(eventId)}`, { signal: request.signal });
    if (!result.ok) throw new Error(`${label} 任务失败（${result.status}）`);
    const events = (await result.text())
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => {
            try { return JSON.parse(line.slice(5).trim()); } catch { return null; }
        })
        .filter(Boolean);
    const audioPath = findAudioPath(events.reverse());
    if (!audioPath) throw new Error(`${label} 已完成任务，但无法识别返回的音频路径。`);
    const fileUrl = /^https?:/i.test(audioPath)
        ? audioPath
        : joinUrl(baseUrl, `/gradio_api/file=${encodeURIComponent(audioPath)}`);
    const audioResponse = await fetch(fileUrl, { signal: request.signal });
    if (!audioResponse.ok) throw new Error(`${label} 音频下载失败（${audioResponse.status}）`);
    return audioResponse.blob();
}

async function generateIndexGradio(settings, text, request) {
    const speakerAudio = request.referenceAudio || request.voice || settings.speakerAudio;
    if (!speakerAudio) throw new Error('请先填写 IndexTTS2 音色参考音频。');
    const emotionAudio = request.emotionAudio || settings.emotionAudio || null;
    const emotionText = request.emotion === 'default' ? '' : String(request.emotion || '');
    const emotionMode = emotionAudio ? 1 : emotionText ? 3 : 0;
    return callGradio(settings.endpoint, 'gen_single', [
        emotionMode,
        asGradioFile(speakerAudio),
        text,
        asGradioFile(emotionAudio),
        Number(settings.emotionWeight),
        0, 0, 0, 0, 0, 0, 0, 0,
        emotionText,
        false,
        120,
        true,
        0.8,
        30,
        0.8,
        0,
        3,
        10,
        1500,
    ], request, 'IndexTTS2 Gradio');
}

async function generateVoxCpmGradio(settings, text, request) {
    const referenceAudio = request.referenceAudio || settings.referenceAudio || null;
    const promptText = request.promptText || settings.promptText || '';
    const usePromptText = Boolean(referenceAudio && promptText);
    const emotion = request.emotion && request.emotion !== 'default' ? request.emotion : '';
    const controlInstruction = [settings.controlInstruction, emotion].filter(Boolean).join('，');
    return callGradio(settings.endpoint, 'generate', [
        text,
        usePromptText ? '' : controlInstruction,
        asGradioFile(referenceAudio),
        usePromptText,
        promptText,
        Number(settings.cfgValue),
        Boolean(settings.normalize),
        Boolean(settings.denoise),
        Number(settings.inferenceSteps),
        Math.floor(Math.random() * 4294967296),
    ], request, 'VoxCPM2 Gradio');
}

const GPT_SOVITS_LANGUAGE_DIRECTORIES = Object.freeze({
    zh: ['Chinese', '中文', 'zh', 'default'],
    yue: ['Cantonese', '粤语', 'yue', 'zh', 'Chinese', '中文', 'default'],
    ja: ['Japanese', '日语', 'ja'],
    en: ['English', '英语', 'en'],
    auto: ['default', 'Chinese', '中文', 'zh'],
});

function resolveGptSovitsRequest(request, settings) {
    const cache = window.TTS_State?.CACHE || {};
    const characterName = String(request.characterName || '').trim();
    const mappedModel = characterName ? String(cache.mappings?.[characterName] || '').trim() : '';
    const modelName = String(request.model || mappedModel || '').trim();
    const modelConfig = modelName ? cache.models?.[modelName] : null;
    const explicitReference = String(request.referenceAudio || settings.refAudioPath || '').trim();
    let selectedReference = null;

    if (!explicitReference && modelConfig?.languages && typeof modelConfig.languages === 'object') {
        const promptLang = String(settings.promptLang || 'zh');
        const candidates = GPT_SOVITS_LANGUAGE_DIRECTORIES[promptLang] || GPT_SOVITS_LANGUAGE_DIRECTORIES.zh;
        const availableLanguages = modelConfig.languages;
        let references = candidates
            .map(language => availableLanguages[language])
            .find(items => Array.isArray(items) && items.length);
        if (!references) {
            references = Object.values(availableLanguages).find(items => Array.isArray(items) && items.length);
        }
        if (references?.length) {
            const emotion = String(request.emotion || 'default').trim() || 'default';
            const exact = references.filter(item => String(item?.emotion || 'default') === emotion);
            const fallback = references.filter(item => String(item?.emotion || 'default') === 'default');
            const pool = exact.length ? exact : fallback.length ? fallback : references;
            selectedReference = pool[Math.floor(Math.random() * pool.length)] || null;
        }
    }

    const referenceAudio = explicitReference || String(selectedReference?.path || '').trim();
    if (!referenceAudio) {
        if (characterName && !mappedModel && !modelConfig) {
            throw new Error(`${characterName} 还没有绑定 GPT-SoVITS 模型，请先在角色路由中选择模型文件夹。`);
        }
        throw new Error('当前 GPT-SoVITS 角色模型没有可用参考音频，请检查模型文件夹中的语言与参考音频。');
    }

    return {
        referenceAudio,
        promptText: String(request.promptText || selectedReference?.text || settings.promptText || '').trim(),
        gptWeights: String(request.gptWeights || modelConfig?.gpt_path || '').trim(),
        sovitsWeights: String(request.sovitsWeights || modelConfig?.sovits_path || '').trim(),
    };
}

async function synthesizeRequest(providerId, request = {}) {
    const provider = getProvider(providerId);
    if (!provider) throw new Error(`未知语音引擎：${providerId}`);
    const text = String(request.text || DEFAULT_PREVIEW_TEXT).trim();
    if (!text) throw new Error('合成文本不能为空。');

    const settings = getSettings(providerId);
    let response;
    setRuntime(providerId, { status: 'generating', message: '正在生成语音' });

    if (providerId === 'elevenlabs') {
        if (!hasSecrets(provider)) throw new Error('请先配置 ElevenLabs API Key。');
        const voiceId = String(request.voice || settings.voice || '').trim();
        if (!voiceId) throw new Error('请先检测连接并选择 ElevenLabs 音色。');
        const modelId = String(request.model || settings.model || 'eleven_multilingual_v2').trim();
        const languageCode = String(settings.languageCode || '').trim().toLowerCase();
        const clamp = (value, min, max, fallback) => {
            const number = Number(value);
            return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
        };
        const elevenLabsRequest = {
            text,
            model_id: modelId,
            voice_settings: {
                stability: clamp(settings.stability, 0, 1, 0.5),
                similarity_boost: clamp(settings.similarityBoost, 0, 1, 0.75),
                style: clamp(settings.style, 0, 1, 0),
                use_speaker_boost: Boolean(settings.speakerBoost),
                speed: clamp(settings.speed, 0.7, 1.2, 1),
            },
        };
        if (languageCode) elevenLabsRequest.language_code = languageCode;
        response = await fetch(`${ELEVENLABS_API_BASE}/synthesize`, {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ voiceId, request: elevenLabsRequest }),
            signal: request.signal,
        });
    } else if (providerId === 'minimax') {
        if (!hasCredentials(provider)) throw new Error('请先配置 MiniMax API Key。');
        const miniMaxPayload = {
            text,
            voiceId: request.voice || settings.voice,
            apiHost: settings.apiHost,
            model: request.model || settings.model,
            speed: Number(settings.speed),
            volume: Number(settings.volume),
            pitch: Number(settings.pitch),
            audioSampleRate: 32000,
            bitrate: 128000,
            format: settings.format,
            emotion: request.emotion || '',
        };
        if (getMiniMaxCredentialMode(settings) === 'direct') {
            const normalizedEmotion = normalizeMiniMaxEmotion(miniMaxPayload.emotion);
            const voiceSetting = {
                voice_id: miniMaxPayload.voiceId,
                speed: miniMaxPayload.speed,
                vol: miniMaxPayload.volume,
                pitch: miniMaxPayload.pitch,
            };
            if (normalizedEmotion && normalizedEmotion !== 'default') {
                voiceSetting.emotion = normalizedEmotion;
            }
            const createRequestBody = () => ({
                    model: miniMaxPayload.model,
                    text: miniMaxPayload.text,
                    stream: false,
                    voice_setting: voiceSetting,
                    audio_setting: {
                        sample_rate: miniMaxPayload.audioSampleRate,
                        bitrate: miniMaxPayload.bitrate,
                        format: miniMaxPayload.format,
                        channel: 1,
                    },
                    language_boost: 'auto',
                    output_format: 'hex',
                });
            let data;
            try {
                data = await callMiniMaxDirect(settings, '/v1/t2a_v2', {
                    method: 'POST',
                    body: JSON.stringify(createRequestBody()),
                    signal: request.signal,
                }, 'MiniMax 语音合成');
            } catch (error) {
                if (!voiceSetting.emotion || !isMiniMaxEmotionParameterError(error)) throw error;
                delete voiceSetting.emotion;
                data = await callMiniMaxDirect(settings, '/v1/t2a_v2', {
                    method: 'POST',
                    body: JSON.stringify(createRequestBody()),
                    signal: request.signal,
                }, 'MiniMax 语音合成');
            }
            const hex = String(data?.data?.audio || '').replace(/^0x/i, '').replace(/\s/g, '');
            if (!hex || !/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
                throw new Error('MiniMax 返回了无效的音频数据。');
            }
            const bytes = new Uint8Array(hex.length / 2);
            for (let index = 0; index < bytes.length; index += 1) {
                bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
            }
            const mimeTypes = {
                mp3: 'audio/mpeg',
                wav: 'audio/wav',
                flac: 'audio/flac',
            };
            setRuntime(providerId, { status: 'ready', message: '语音生成成功' });
            return new Blob([bytes], { type: mimeTypes[miniMaxPayload.format] || 'application/octet-stream' });
        }
        response = await fetch('/api/plugins/tts-minimax-resources/generate', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(miniMaxPayload),
            signal: request.signal,
        });
    } else if (providerId === 'edge') {
        response = await fetch(`${settings.serviceBase.replace(/\/+$/, '')}/generate`, {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                text,
                voice: request.voice || settings.voice,
                rate: Number(settings.rate),
            }),
            signal: request.signal,
        });
    } else if (providerId === 'gpt_sovits') {
        const hasExplicitReference = Boolean(String(request.referenceAudio || settings.refAudioPath || '').trim());
        const characterName = String(request.characterName || '').trim();
        const cache = window.TTS_State?.CACHE || {};
        const cachedModelName = String(request.model || cache.mappings?.[characterName] || '').trim();
        if (!hasExplicitReference && characterName && (!cachedModelName || !cache.models?.[cachedModelName])) {
            await checkProvider('gpt_sovits');
        }
        const resolved = resolveGptSovitsRequest(request, settings);
        response = await fetch(joinUrl(settings.managerEndpoint, '/tts_proxy_v2'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text,
                text_lang: settings.textLang,
                ref_audio_path: resolved.referenceAudio,
                prompt_lang: settings.promptLang,
                prompt_text: resolved.promptText,
                speed_factor: Number(settings.speedFactor),
                streaming_mode: false,
                emotion: request.emotion || 'default',
                ...(resolved.gptWeights ? { gpt_weights: resolved.gptWeights } : {}),
                ...(resolved.sovitsWeights ? { sovits_weights: resolved.sovitsWeights } : {}),
            }),
            signal: request.signal,
        });
    } else if (providerId === 'indextts2') {
        const endpoint = joinUrl(settings.endpoint, settings.generatePath);
        response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text,
                speaker: request.voice || request.referenceAudio || settings.speakerAudio,
                voice: request.voice || request.referenceAudio || settings.speakerAudio,
                speaker_audio: request.referenceAudio || settings.speakerAudio,
                spk_audio_prompt: request.referenceAudio || settings.speakerAudio,
                emotion: request.emotion || 'default',
                emotion_audio: request.emotionAudio || settings.emotionAudio,
                emotion_weight: Number(settings.emotionWeight),
                output_format: settings.outputFormat,
                streaming: Boolean(settings.streaming),
            }),
            signal: request.signal,
        });
        const blob = await responseToAudioBlob(response, settings.endpoint);
        setRuntime(providerId, { status: 'ready', message: '语音生成成功' });
        return blob;
    } else if (providerId === 'voxcpm2') {
        if (settings.adapter === 'gradio') {
            const blob = await generateVoxCpmGradio(settings, text, request);
            setRuntime(providerId, { status: 'ready', message: '语音生成成功' });
            return blob;
        }
        const endpoint = joinUrl(settings.endpoint, settings.generatePath);
        response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: settings.model,
                input: text,
                voice: request.voice || settings.speaker || 'default',
                response_format: settings.outputFormat,
                stream: Boolean(settings.streaming),
                ...(request.referenceAudio || settings.referenceAudio
                    ? { ref_audio: request.referenceAudio || settings.referenceAudio }
                    : {}),
            }),
            signal: request.signal,
        });
        const blob = await responseToAudioBlob(response, settings.endpoint);
        setRuntime(providerId, { status: 'ready', message: '语音生成成功' });
        return blob;
    }

    if (!response?.ok) {
        const errorText = await response?.text().catch(() => '');
        let errorMessage = errorText;
        try {
            const errorPayload = JSON.parse(errorText);
            errorMessage = errorPayload?.error?.message
                || errorPayload?.error
                || errorPayload?.message
                || errorText;
        } catch {
            // Keep plain-text service errors unchanged.
        }
        setRuntime(providerId, { status: 'error', message: '语音生成失败' });
        const error = new Error(errorMessage || `语音生成失败（${response?.status || '无响应'}）`);
        error.status = response?.status;
        const retryAfter = String(response?.headers?.get?.('retry-after') || '').trim();
        if (retryAfter) {
            const seconds = Number(retryAfter);
            error.retryAfterMs = Number.isFinite(seconds)
                ? Math.max(0, seconds * 1000)
                : Math.max(0, Date.parse(retryAfter) - Date.now());
        }
        throw error;
    }

    setRuntime(providerId, { status: 'ready', message: '语音生成成功' });
    return response.blob();
}

async function synthesize(providerId, request = {}) {
    try {
        const attempts = providerId === 'minimax' ? 4 : 1;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            try {
                return await synthesizeRequest(providerId, request);
            } catch (error) {
                if (providerId !== 'minimax' || !isMiniMaxRateLimitError(error) || attempt === attempts - 1) throw error;
                const fallbackDelay = Math.min(12000, 2000 * (2 ** attempt));
                const retryDelay = Number.isFinite(Number(error.retryAfterMs))
                    ? Math.max(0, Number(error.retryAfterMs))
                    : fallbackDelay;
                setRuntime(providerId, {
                    status: 'generating',
                    message: `MiniMax 限流，${Math.max(1, Math.ceil(retryDelay / 1000))} 秒后自动重试`,
                });
                await waitForRetry(retryDelay, request.signal);
            }
        }
        throw new Error('MiniMax 语音生成超过重试上限。');
    } catch (error) {
        setRuntime(providerId, {
            status: error?.name === 'AbortError' ? 'idle' : 'error',
            message: error?.name === 'AbortError' ? '已取消生成' : (error?.message || '语音生成失败'),
        });
        throw error;
    }
}

async function preview(providerId, text = DEFAULT_PREVIEW_TEXT) {
    return synthesize(providerId, { text });
}

function getSnapshot() {
    const store = ensureStore();
    const elevenLabsCatalog = getElevenLabsCatalog();
    const miniMaxCatalog = getMiniMaxCatalog();
    return {
        activeProvider: store.activeProvider,
        fallbackProvider: store.fallbackProvider,
        playback: getPlaybackSettings(),
        ui: getUiSettings(),
        tags: getTagSettings(),
        features: getFeatureSettings(),
        characterRoutes: clone(store.characterRoutes),
        manualCharacters: clone(store.manualCharacters),
        hiddenCharacters: clone(store.hiddenCharacters),
        providers: PROVIDERS.map(provider => {
            let fields = provider.fields;
            if (provider.id === 'minimax') {
                fields = provider.fields.map(field => {
                    if (field.key === 'model') {
                        return {
                            ...field,
                            options: miniMaxCatalog.models.map(item => [item.id, item.name]),
                        };
                    }
                    if (field.key === 'voice') {
                        return {
                            ...field,
                            options: miniMaxCatalog.voices.map(item => [item.id, item.name]),
                        };
                    }
                    return field;
                });
            }
            if (provider.id === 'elevenlabs') {
                fields = provider.fields.map(field => {
                    if (field.key === 'model') {
                        return {
                            ...field,
                            options: elevenLabsCatalog.models.map(item => [item.id, item.name]),
                        };
                    }
                    if (field.key === 'voice') {
                        return {
                            ...field,
                            options: elevenLabsCatalog.voices.map(item => [item.id, item.name]),
                        };
                    }
                    return field;
                });
            }
            return {
                ...provider,
                fields,
                settings: getSettings(provider.id),
                runtime: { ...runtimeState.get(provider.id) },
                secretsReady: hasCredentials(provider),
                vaultSecretsReady: hasSecrets(provider),
            };
        }),
    };
}

function exportBackupData() {
    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        data: clone(ensureStore()),
    };
}

function importBackupData(payload) {
    const source = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
    if (!source || typeof source !== 'object' || !source.providers || typeof source.providers !== 'object') {
        throw new Error('备份中缺少语音引擎配置。');
    }
    extension_settings[SETTINGS_KEY] = clone(source);
    ensureStore();
    saveSettingsDebounced();
    emitChange('backup-restored');
    return getSnapshot();
}

function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

for (const eventName of [event_types.SECRET_WRITTEN, event_types.SECRET_DELETED, event_types.SECRET_ROTATED]) {
    if (eventName) eventSource.on(eventName, refreshSecretRuntime);
}

export const TTS_ProviderRegistry = {
    SETTINGS_KEY,
    DEFAULT_PREVIEW_TEXT,
    TAG_PRESETS,
    list: () => PROVIDERS.map(provider => ({ ...provider })),
    getProvider,
    getSettings,
    getSnapshot,
    exportBackupData,
    importBackupData,
    updateSettings,
    setActive,
    setFallback,
    getPlaybackSettings,
    updatePlaybackSettings,
    syncPlaybackState,
    getUiSettings,
    updateUiSettings,
    getQqState,
    updateQqState,
    getDrawingSettings,
    updateDrawingSettings,
    getElevenLabsCatalog,
    syncElevenLabsCatalog,
    getMiniMaxCatalog,
    syncMiniMaxCatalog,
    getTagSettings,
    getTagPresets,
    updateTagSettings,
    saveTagPreset,
    deleteTagPreset,
    createTagRegex,
    getFeatureSettings,
    updateFeatureSettings,
    getCharacterRoute,
    setCharacterRoute,
    removeCharacterRoute,
    addCharacter,
    addBodySpeaker,
    deleteCharacter,
    shouldShowCharacter,
    resolveRoute,
    checkProvider,
    synthesize,
    preview,
    subscribe,
};

window.TTS_ProviderRegistry = TTS_ProviderRegistry;
