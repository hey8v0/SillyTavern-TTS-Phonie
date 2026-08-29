export function saveSettingsDebounced() {}
export function generateQuietPrompt() { return Promise.resolve(''); }
export function generateRaw() { return Promise.resolve(''); }
export function getCharacterCardFields() { return { description: '', personality: '', scenario: '', mesExamples: '' }; }
export function getMaxPromptTokens() { return 8192; }
export function setExtensionPrompt() {}
export function getCurrentChatId() { return 'preview-chat'; }
export function getRequestHeaders() { return { 'Content-Type': 'application/json' }; }
export const event_types = {};
export const eventSource = { on() {}, removeListener() {} };
export const extension_prompt_types = { IN_CHAT: 0 };
export const extension_prompt_roles = { SYSTEM: 0, USER: 1, ASSISTANT: 2 };
