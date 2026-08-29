/**
 * Phonie 1.0 — 全局常量与契约。
 * 保持原生 ESM、无构建步骤的 SillyTavern 扩展形态。
 */

export const MODULE_ID = 'phonie_v2';
export const APP_VERSION = '1.0.0';
export const SCHEMA_VERSION = 1;

/** 主题模式。 */
export const THEMES = Object.freeze({
    DAY: 'day',
    NIGHT: 'night',
    TAVERN: 'tavern',
    CUSTOM: 'custom',
});

/** 灵动岛状态。 */
export const ISLAND_STATES = Object.freeze({
    IDLE: 'idle',
    GENERATING: 'generating',
    SYNTHESIZING: 'synthesizing',
    PREPARING_CALL: 'preparing_call',
    RINGING: 'ringing',
    CONNECTED: 'connected',
});

/** 通话状态。 */
export const CALL_STATES = Object.freeze({
    IDLE: 'idle',
    DIALING: 'dialing',
    RINGING: 'ringing',
    CONNECTED: 'connected',
    GENERATING: 'generating',
    SPEAKING: 'speaking',
    ENDED: 'ended',
    ERROR: 'error',
});

/** 屏幕标识。 */
export const SCREENS = Object.freeze({
    HOME: 'home',
    QQ: 'qq',
    CHAT: 'chat',
    PHONE: 'phone',
    CONTACTS: 'contacts',
    TRACE: 'trace',
    ENGINES: 'engines',
    ENGINE_DETAIL: 'engine-detail',
    DRAWING: 'drawing',
    THEMES: 'themes',
    SETTINGS: 'settings',
    SETTINGS_MODEL: 'settings-model',
    SETTINGS_DISPLAY: 'settings-display',
    SETTINGS_PROMPTS: 'settings-prompts',
    SETTINGS_BODY_TTS: 'settings-body-tts',
    SETTINGS_QQ: 'settings-qq',
    SETTINGS_STICKERS: 'settings-stickers',
    SETTINGS_CACHE: 'settings-cache',
});

/** QQ 消息类型。 */
export const MESSAGE_KINDS = Object.freeze({
    TEXT: 'text',
    VOICE: 'voice',
    IMAGE: 'image',
    TRANSFER: 'transfer',
    STICKER: 'sticker',
    QUOTE: 'quote',
    RECALLED: 'recalled',
    SYSTEM: 'system',
});

/** 首页 APP 定义（两行四列 + 底部 Dock）。 */
export const APPS = Object.freeze([
    { id: SCREENS.QQ, name: 'QQ', color: '#12B7F5', icon: 'qq', dock: true },
    { id: SCREENS.PHONE, name: '电话', color: '#34C759', icon: 'phone', dock: true },
    { id: SCREENS.CONTACTS, name: '通讯录', color: '#FF9F0A', icon: 'contacts', dock: false },
    { id: SCREENS.TRACE, name: '追踪', color: '#FF375F', icon: 'trace', dock: false },
    { id: SCREENS.ENGINES, name: '引擎', color: '#5E5CE6', icon: 'engine', dock: false },
    { id: SCREENS.DRAWING, name: '绘画', color: '#FF2D55', icon: 'draw', dock: true },
    { id: SCREENS.THEMES, name: '主题', color: '#AF52DE', icon: 'theme', dock: false },
    { id: SCREENS.SETTINGS, name: '设置', color: '#8E8E93', icon: 'settings', dock: true },
]);

/** 底部 Dock 顺序（QQ、电话、绘画、设置）。 */
export const DOCK_APP_IDS = Object.freeze(['qq', 'phone', 'drawing', 'settings']);

/** 六个 TTS 引擎目录。 */
export const ENGINES = Object.freeze([
    { id: 'indextts2', name: 'IndexTTS2', color: '#0A84FF', icon: 'engineIndex', kind: 'http-json' },
    { id: 'gpt-sovits', name: 'GPT-SoVITS', color: '#30A46C', icon: 'engineGpt', kind: 'http-json' },
    { id: 'voxcpm2', name: 'VoxCPM2', color: '#8E5CC7', icon: 'engineVox', kind: 'http-json' },
    { id: 'edge', name: 'Edge TTS', color: '#168AAD', icon: 'engineEdge', kind: 'webspeech' },
    { id: 'elevenlabs', name: 'ElevenLabs', color: '#D17B32', icon: 'engineEleven', kind: 'rest' },
    { id: 'minimax', name: 'MiniMax', color: '#D04F67', icon: 'engineMinimax', kind: 'server-plugin' },
]);

/** 五种提示词工作流。 */
export const PROMPT_WORKFLOWS = Object.freeze([
    { id: 'body', name: '正文注入' },
    { id: 'single_call', name: '单人电话' },
    { id: 'group_call', name: '多人电话' },
    { id: 'chat', name: 'QQ 聊天' },
    { id: 'image', name: '生图' },
]);

export const PROMPT_ROLES = Object.freeze(['system', 'user', 'assistant']);

/** 主题语义化颜色令牌：60% 背景 / 30% 面板 / 7% 激活 / 3% 高光。 */
export const THEME_PALETTES = Object.freeze({
    [THEMES.DAY]: {
        '--phonie-bg': '#F3F1EA',
        '--phonie-bg-2': '#FCFBF7',
        '--phonie-surface': '#FFFEFA',
        '--phonie-surface-2': '#ECE9E1',
        '--phonie-surface-3': '#E1DDD4',
        '--phonie-accent': '#226C66',
        '--phonie-accent-soft': 'rgba(34, 108, 102, 0.13)',
        '--phonie-text': '#18211F',
        '--phonie-text-2': '#65706D',
        '--phonie-text-3': '#969E9B',
        '--phonie-separator': 'rgba(24, 33, 31, 0.11)',
        '--phonie-glow': 'rgba(240, 165, 107, 0.30)',
        '--phonie-statusbar': '#18211F',
        '--phonie-island': '#000000',
        '--phonie-island-text': '#FFFFFF',
        '--phonie-wallpaper': 'radial-gradient(circle at 78% 12%, rgba(255,255,255,.88) 0 12%, transparent 34%), radial-gradient(circle at 4% 88%, rgba(240,165,107,.34), transparent 42%), linear-gradient(150deg, #D7E5DF 0%, #E9E4D9 48%, #D9C6B6 100%)',
        '--phonie-scheme': 'light',
    },
    [THEMES.NIGHT]: {
        '--phonie-bg': '#08100F',
        '--phonie-bg-2': '#0D1716',
        '--phonie-surface': '#14201E',
        '--phonie-surface-2': '#1B2A28',
        '--phonie-surface-3': '#263735',
        '--phonie-accent': '#76D3C7',
        '--phonie-accent-soft': 'rgba(118, 211, 199, 0.16)',
        '--phonie-text': '#F4F6F2',
        '--phonie-text-2': '#A9B7B3',
        '--phonie-text-3': '#71817D',
        '--phonie-separator': 'rgba(225, 240, 235, 0.12)',
        '--phonie-glow': 'rgba(243, 168, 111, 0.26)',
        '--phonie-statusbar': '#FFFFFF',
        '--phonie-island': '#000000',
        '--phonie-island-text': '#FFFFFF',
        '--phonie-wallpaper': 'radial-gradient(circle at 80% 8%, rgba(95,160,151,.28), transparent 32%), radial-gradient(circle at 12% 88%, rgba(181,100,66,.24), transparent 42%), linear-gradient(155deg, #152724 0%, #0C1716 48%, #1B1513 100%)',
        '--phonie-scheme': 'dark',
    },
});

/** 主题展示元数据。 */
export const THEME_OPTIONS = Object.freeze([
    { id: THEMES.DAY, name: '日间', hint: '明亮清爽的浅色界面' },
    { id: THEMES.NIGHT, name: '夜间', hint: '深邃护眼的深色界面' },
    { id: THEMES.TAVERN, name: '跟随酒馆', hint: '随酒馆主题自动明暗' },
    { id: THEMES.CUSTOM, name: '自定义', hint: '自定配色、壁纸与图标' },
]);

export const DEFAULT_CUSTOM_THEME = Object.freeze({
    colors: {
        '--phonie-bg': '#F2F2F7',
        '--phonie-bg-2': '#FFFFFF',
        '--phonie-surface': '#FFFFFF',
        '--phonie-surface-2': '#F2F2F7',
        '--phonie-accent': '#007AFF',
        '--phonie-text': '#0B0B0F',
    },
    wallpaperAssetKey: '',
    wallpaperUrl: '',
    appIcons: {},
});

/** MiniMax 适配条目：情绪规范与 Sound Tags，作为默认可关闭条目存在。 */
export const MINIMAX_ADAPT_CONTENT = String.raw`#### 规则 1：情绪字段必须从标准情绪中选择最契合的一项：
["happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm", "fluent"]

#### 规则 2：朗读台词中可依据动作与语境植入以下英文小写圆括号标签：
欢笑： (laughs) (chuckle) (humming)
呼吸： (breath) (inhale) (exhale) (pant) (gasps) (sighs)
动作： (sniffs) (snorts) (coughs) (clear-throat) (groans) (emm) (lip-smacking) (sneezes) (burps)
可用 <#0.3#> 表示 0.3 秒停顿。
标签直接内嵌在 sourceText 中，放在语意转折处或句首句尾；translatedText 中不得显示这些控制标签。`;

/** 单个提示词条目。 */
export function createPromptEntry(partial = {}) {
    return {
        id: partial.id || `entry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name: String(partial.name || '').slice(0, 80),
        enabled: partial.enabled !== false,
        role: PROMPT_ROLES.includes(partial.role) ? partial.role : 'system',
        depth: Math.min(20, Math.max(0, Number(partial.depth) || 0)),
        content: String(partial.content || ''),
    };
}

/** 生成一个默认提示词预设（含可关闭的 MiniMax 适配条目）。 */
export function createDefaultPromptPreset(kind) {
    const defaults = {
        body: String.raw`正常续写正文和叙事，不改变人物设定与文风。
角色真正说出口、需要朗读的台词，必须严格按以下格式标注：
“{可见译文}”[TTS:{角色}:{情绪}:{原语言文本}]
旁白、动作、环境和心理描写继续作为普通正文，不生成语音标签。
可见译文使用 {{targetLanguage}}；原语言文本使用 {{sourceLanguage}}。
提示词关闭后插件仍可解析手工生成的合法标签；不要解释格式，不要输出格式之外的说明。`,
        single_call: String.raw`你是 {{char}}。根据当前实际上下文，为 {{user}} 编排一次{{direction}}电话。
参与者：{{participants}}
电话长度：{{callLength}}
故事上下文：{{storyHistory}}
世界书命中：{{worldbook}}
QQ 最近记录：{{qqHistory}}
segments 只能包含远端角色发言，不得代写 user 台词。
段数按电话长度：短 4–6 段、普通 7–10 段、长 12–18 段。
sourceText 使用 {{sourceLanguage}}，translatedText 使用 {{targetLanguage}}。
只输出符合 {{outputSchema}} 的 JSON，不要输出分析、代码围栏或额外说明。`,
        group_call: String.raw`编排一段完整、连续、具有起承转合的多人电话，不是摘要或单句。
参与者：{{participants}}
故事上下文：{{storyHistory}}
世界书命中：{{worldbook}}
QQ 最近记录：{{qqHistory}}
speaker 必须来自参与者名单，不得出现 user 台词。
段数 15–28 段，让不同角色自然轮换，不要把台词全给当前角色。
sourceText 使用 {{sourceLanguage}}，translatedText 使用 {{targetLanguage}}。
只输出符合 {{outputSchema}} 的 JSON，不要输出分析、代码围栏或额外说明。`,
        chat: String.raw`你是 {{char}}，正在 QQ 上回复 {{user}}。
实际故事上下文：{{storyHistory}}
世界书命中：{{worldbook}}
QQ 最近记录：{{qqHistory}}
本轮待回复消息：{{pendingMessages}}
一次回复 1–8 条消息，按自然聊天节奏拆分，不要把所有内容塞进一条。
kind 只能是 text / voice / image / transfer / sticker；每批最多一条 image。
voice 的 sourceText 使用 {{sourceLanguage}}，translatedText 使用 {{targetLanguage}}。
sticker 的 stickerName 必须从给定表情包名单中选择。
单聊可返回主动来电意图，群聊不得触发主动电话。
只输出符合 {{outputSchema}} 的 JSON，不要输出分析、代码围栏或额外说明。`,
        image: String.raw`根据画面意图生成 NovelAI 动态正面 Tag。
画面意图：{{imageIntent}}
只生成会变化的正面 Tag，不要重复固定前置、固定后置或固定负面词。
Tag 使用英文逗号分隔，风格一致、可被 NovelAI 直接使用。
只输出符合 {{outputSchema}} 的 JSON，不要输出分析、代码围栏或额外说明。`,
    };
    const entries = [createPromptEntry({ name: '核心规则', role: 'system', depth: 1, content: defaults[kind] || '' })];
    if (kind !== 'image') {
        entries.push(createPromptEntry({ name: 'MiniMax 适配', role: 'system', depth: 2, content: MINIMAX_ADAPT_CONTENT }));
    }
    return {
        id: `preset-${kind}`,
        name: '默认',
        entries,
    };
}

/** 每个工作流保存多个命名预设，并显式记录当前预设。 */
export function createDefaultPromptLibrary(kind) {
    const preset = createDefaultPromptPreset(kind);
    return {
        ...preset,
        activePresetId: preset.id,
        presets: [preset],
    };
}

export const DEFAULT_SETTINGS = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    theme: THEMES.DAY,
    launcherMode: 'orb',
    sourceLanguage: 'zh-CN',
    targetLanguage: 'zh-CN',
    generationMode: 'tavern',
    customOpenAIPresets: [],
    activeCustomOpenAIPresetId: '',
    ttsActiveProvider: 'edge',
    ttsProviderSettings: {},
    contacts: [],
    ignoredContacts: [],
    qqFriends: [],
    qqGroups: [],
    stickers: [],
    favoriteCalls: [],
    novelAi: {
        prefix: 'masterpiece, best quality',
        suffix: '',
        negative: 'lowres, bad anatomy, text, watermark',
        model: 'nai-diffusion-5-full',
        size: '832x1216',
        sampler: 'k_euler_ancestral',
        scheduler: 'karras',
        seed: -1,
        steps: 28,
        scale: 5,
        guidanceRescale: 0,
        decrisper: false,
    },
    proactiveCalls: { enabled: true, cooldownMinutes: 30, cooldownByContact: {} },
    promptPresets: {
        body: createDefaultPromptLibrary('body'),
        single_call: createDefaultPromptLibrary('single_call'),
        group_call: createDefaultPromptLibrary('group_call'),
        chat: createDefaultPromptLibrary('chat'),
        image: createDefaultPromptLibrary('image'),
    },
    bodyTtsEnabled: true,
    bodyPromptEnabled: true,
    autoRenderBodyTts: false,
    showTranslation: true,
    callLength: 'normal',
    customTheme: DEFAULT_CUSTOM_THEME,
    dockSide: 'right',
    dockY: 0.5,
});

/** 屏幕标题文案。 */
export const SCREEN_TITLES = Object.freeze({
    [SCREENS.QQ]: 'QQ',
    [SCREENS.PHONE]: '电话',
    [SCREENS.CONTACTS]: '通讯录',
    [SCREENS.TRACE]: '追踪',
    [SCREENS.ENGINES]: '引擎',
    [SCREENS.DRAWING]: '绘画',
    [SCREENS.THEMES]: '主题',
    [SCREENS.SETTINGS]: '设置',
});
