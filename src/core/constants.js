export const MODULE_ID = 'phonie';
export const APP_VERSION = '0.13.0';
export const SCHEMA_VERSION = 10;
export const EXTENSION_BASE = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

export const THEMES = Object.freeze({
    DAY: 'day',
    NIGHT: 'night',
    TAVERN: 'tavern',
});

export const SCREENS = Object.freeze({
    HOME: 'home',
    CHAT: 'chat',
    CALL: 'call',
    VOICE: 'voice',
    PROVIDER: 'provider',
    TRACE: 'trace',
    CHARACTER: 'character',
    MODEL: 'model',
    PROMPTS: 'prompts',
    GUIDE: 'guide',
    NOVELAI: 'novelai',
    SETTINGS: 'settings',
});

export const MESSAGE_KINDS = Object.freeze({
    TEXT: 'text',
    VOICE: 'voice',
    IMAGE: 'image',
    TRANSFER: 'transfer',
    RED_PACKET: 'red_packet',
    RECALLED: 'recalled',
    SYSTEM: 'system',
});

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

export const DEFAULT_SETTINGS = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    theme: THEMES.TAVERN,
    sourceLanguage: 'ja-JP',
    targetLanguage: 'zh-CN',
    autoDecorateMessages: true,
    bodyPromptEnabled: true,
    promptWorkflowKind: 'body',
    promptPresetLibraries: { body: [], chat: [], call: [] },
    chatPromptPreset: null,
    callPromptPreset: null,
    autoTranslate: true,
    autoPlayPhoneReplies: true,
    injectContinuity: true,
    showTranslation: true,
    launcherMode: 'orb',
    generationMode: 'tavern',
    phoneResponseLength: 8192,
    callResponseLength: 180,
    callScriptResponseLength: 8192,
    callLength: 'normal',
    customOpenAIEndpoint: '',
    customOpenAIModel: '',
    customOpenAIModels: [],
    customOpenAITemperature: 0.8,
    customOpenAIMaxTokens: 8192,
    novelAiModel: 'nai-diffusion-4-5-full',
    novelAiSampler: 'k_euler_ancestral',
    novelAiScheduler: 'karras',
    novelAiWidth: 832,
    novelAiHeight: 1216,
    novelAiSteps: 28,
    novelAiScale: 5,
    novelAiNegativePrompt: 'lowres, bad anatomy, text, watermark, error',
    ttsActiveProvider: 'elevenlabs',
    ttsFallbackProvider: '',
    ttsProviderSettings: {},
    ttsCharacterRoutes: {},
    ttsResourceCatalogs: {},
    dockSide: 'right',
    dockY: 0.48,
});

export const PHONE_REPLY_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['originalText', 'translationText', 'emotion', 'action'],
    properties: {
        originalText: { type: 'string' },
        translationText: { type: 'string' },
        emotion: {
            type: 'string',
            enum: ['neutral', 'warm', 'bright', 'quiet', 'tense', 'sad', 'angry'],
        },
        action: {
            type: 'string',
            enum: ['reply', 'pause', 'end_call'],
        },
        speaker: { type: 'string' },
    },
});

export const PHONE_CALL_SCRIPT_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['turns', 'action'],
    properties: {
        turns: {
            type: 'array',
            minItems: 1,
            maxItems: 28,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['speaker', 'originalText', 'translationText', 'emotion'],
                properties: {
                    speaker: { type: 'string' },
                    originalText: { type: 'string' },
                    translationText: { type: 'string' },
                    emotion: {
                        type: 'string',
                        enum: ['neutral', 'warm', 'bright', 'quiet', 'tense', 'sad', 'angry'],
                    },
                },
            },
        },
        action: { type: 'string', enum: ['reply', 'end_call'] },
        summary: { type: 'string' },
    },
});
