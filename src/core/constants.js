export const MODULE_ID = 'phonie';
export const APP_VERSION = '0.5.0';
export const SCHEMA_VERSION = 4;
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
    TRACE: 'trace',
    CHARACTER: 'character',
    MODEL: 'model',
    PROMPTS: 'prompts',
    SETTINGS: 'settings',
});

export const MESSAGE_KINDS = Object.freeze({
    TEXT: 'text',
    VOICE: 'voice',
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
    autoTranslate: true,
    autoPlayPhoneReplies: true,
    injectContinuity: true,
    showTranslation: true,
    launcherMode: 'orb',
    generationMode: 'tavern',
    generationProfileId: '',
    phoneResponseLength: 420,
    customOpenAIEndpoint: '',
    customOpenAIModel: '',
    customOpenAIModels: [],
    customOpenAITemperature: 0.8,
    customOpenAIMaxTokens: 8192,
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
    },
});
