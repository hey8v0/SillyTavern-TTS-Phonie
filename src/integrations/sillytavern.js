import {
    cancelTtsPlay,
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    generateQuietPrompt,
    getCurrentChatId,
    saveChatConditional,
    saveSettingsDebounced,
    setExtensionPrompt,
} from '/script.js';
import { extension_settings, getContext } from '/scripts/extensions.js';
import { executeSlashCommandsWithOptions } from '/scripts/slash-commands.js';

import { DEFAULT_SETTINGS, MODULE_ID, PHONE_REPLY_SCHEMA } from '../core/constants.js';
import { getCurrentGenerationTarget, listConnectionProfiles, requestPhoneGeneration } from './generation-compat.js';
import { DEFAULT_PHONE_PROMPT_PRESET, normalizePhonePromptPreset } from '../dialogue/prompt-preset.js';
import { compileBodyPromptEntries, DEFAULT_BODY_PROMPT_PRESET } from '../dialogue/body-speech.js';
import { buildContinuityPrompt, buildPhoneReplyMessages, parsePhoneReply } from '../dialogue/prompt-service.js';
import { createPhoneMetadata } from '../phone/chat-records.js';
import { fetchCustomOpenAIModels, saveCustomOpenAIKey } from './openai-compatible.js';

const PROMPT_KEY = 'phonie_private_channel';
const BODY_PROMPT_PREFIX = 'phonie_body_tts_';
const BODY_PROMPT_ROLES = Object.freeze({
    system: extension_prompt_roles.SYSTEM,
    user: extension_prompt_roles.USER,
    assistant: extension_prompt_roles.ASSISTANT,
});

function mergeSettings(value = {}) {
    const merged = { ...DEFAULT_SETTINGS, ...value, schemaVersion: DEFAULT_SETTINGS.schemaVersion };
    merged.phoneResponseLength = Math.min(1200, Math.max(80, Math.round(Number(merged.phoneResponseLength) || 420)));
    merged.launcherMode = ['orb', 'wand', 'both'].includes(merged.launcherMode) ? merged.launcherMode : 'orb';
    merged.generationMode = !value.generationMode && value.generationProfileId
        ? 'profile'
        : ['tavern', 'profile', 'custom'].includes(merged.generationMode) ? merged.generationMode : 'tavern';
    merged.customOpenAIEndpoint = String(merged.customOpenAIEndpoint || '').trim().slice(0, 1000);
    merged.customOpenAIModel = String(merged.customOpenAIModel || '').trim().slice(0, 300);
    merged.customOpenAIModels = Array.isArray(merged.customOpenAIModels)
        ? [...new Set(merged.customOpenAIModels.map((model) => String(model || '').trim()).filter(Boolean))].slice(0, 500)
        : [];
    merged.customOpenAITemperature = Math.min(2, Math.max(0, Number(merged.customOpenAITemperature) || 0.8));
    merged.customOpenAIMaxTokens = Math.min(65536, Math.max(80, Math.round(Number(merged.customOpenAIMaxTokens) || 8192)));
    merged.promptPreset = normalizePhonePromptPreset(value.promptPreset);
    merged.bodyPromptPreset = normalizePhonePromptPreset(value.bodyPromptPreset || DEFAULT_BODY_PROMPT_PRESET);
    merged.bodyPromptEnabled = value.bodyPromptEnabled !== false;
    merged.promptWorkflowKind = ['body', 'phone'].includes(value.promptWorkflowKind) ? value.promptWorkflowKind : 'body';
    if (Number(value.schemaVersion || 0) < 3) {
        const defaults = new Map(DEFAULT_PHONE_PROMPT_PRESET.entries.map((entry) => [entry.id, entry.content]));
        merged.promptPreset.entries = merged.promptPreset.entries.map((entry) => {
            const isLegacyDefault = /Continue an in-world|Write originalText|Reply naturally/.test(entry.content);
            return isLegacyDefault && defaults.has(entry.id) ? { ...entry, content: defaults.get(entry.id) } : entry;
        });
    }
    return merged;
}

function safeSlashValue(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\|/g, '\\|')
        .replace(/[\r\n]+/g, ' ')
        .trim();
}

export class SillyTavernBridge {
    #listeners = [];
    #bodyPromptKeys = new Set();

    get context() {
        return getContext();
    }

    getSettings() {
        if (!extension_settings[MODULE_ID]) {
            extension_settings[MODULE_ID] = mergeSettings();
            saveSettingsDebounced();
        } else {
            extension_settings[MODULE_ID] = mergeSettings(extension_settings[MODULE_ID]);
        }
        return extension_settings[MODULE_ID];
    }

    updateSettings(patch) {
        const settings = this.getSettings();
        extension_settings[MODULE_ID] = mergeSettings({ ...settings, ...patch });
        saveSettingsDebounced();
        return extension_settings[MODULE_ID];
    }

    getChatId() {
        return getCurrentChatId() || 'no-chat';
    }

    getContact() {
        const context = this.context;
        const character = context?.characters?.[context?.characterId];
        const name = String(character?.name || context?.name2 || context?.characterName || 'Character');
        const avatarUrl = character?.avatar
            ? `/characters/${encodeURIComponent(character.avatar)}`
            : '';
        return { name, avatarUrl };
    }

    getUserName() {
        return String(this.context?.name1 || this.context?.userName || 'User');
    }

    getMessage(messageId) {
        return this.context?.chat?.[Number(messageId)] ?? null;
    }

    getMessages() {
        return Array.isArray(this.context?.chat) ? this.context.chat : [];
    }

    getPhoneMetadata() {
        const context = this.context;
        if (!context?.chatMetadata) return createPhoneMetadata();
        context.chatMetadata[MODULE_ID] = createPhoneMetadata(context.chatMetadata[MODULE_ID]);
        return context.chatMetadata[MODULE_ID];
    }

    savePhoneMetadata(metadata) {
        const context = this.context;
        if (!context?.chatMetadata) return;
        context.chatMetadata[MODULE_ID] = createPhoneMetadata(metadata);
        context.saveMetadataDebounced?.();
    }

    async saveMessageExtra() {
        await saveChatConditional();
    }

    getProviderLabel() {
        const current = String(extension_settings.tts?.currentProvider || '');
        const option = [...(document.querySelector('#tts_provider')?.options || [])]
            .find((entry) => entry.value === current);
        return String(option?.textContent?.trim() || current || 'TTS 未配置');
    }

    getTtsProviders() {
        const current = String(extension_settings.tts?.currentProvider || '');
        const select = document.querySelector('#tts_provider');
        const options = select instanceof HTMLSelectElement ? [...select.options] : [];
        const providers = options
            .filter((option) => option.value && !option.disabled)
            .map((option) => ({
                id: option.value,
                name: String(option.textContent || option.value).trim(),
                selected: option.value === current,
            }));
        if (!providers.length && current) return [{ id: current, name: current, selected: true }];
        return providers;
    }

    async setTtsProvider(providerId) {
        const id = String(providerId || '').trim();
        const select = document.querySelector('#tts_provider');
        if (!(select instanceof HTMLSelectElement)) throw new Error('酒馆 TTS 设置尚未载入');
        const option = [...select.options].find((entry) => entry.value === id && !entry.disabled);
        if (!option) throw new Error('这个语音提供商当前不可用');
        select.value = id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        return this.getTtsProviders();
    }

    getGenerationProfiles() {
        return listConnectionProfiles(this.context);
    }

    getGenerationTarget(settings = this.getSettings()) {
        if (settings.generationMode === 'custom') {
            return {
                id: 'custom',
                name: '自定义 OpenAI',
                api: settings.customOpenAIEndpoint || '等待填写接口',
                model: settings.customOpenAIModel || '等待选择模型',
            };
        }
        if (settings.generationMode !== 'profile') return getCurrentGenerationTarget(this.context);
        const selected = this.getGenerationProfiles().find((profile) => profile.id === settings.generationProfileId);
        return selected || getCurrentGenerationTarget(this.context);
    }

    async saveCustomOpenAIKey(value) {
        return saveCustomOpenAIKey(value);
    }

    async refreshCustomOpenAIModels(endpoint) {
        return fetchCustomOpenAIModels(endpoint);
    }
    async generatePhoneReply({ history, callMode = false }) {
        const settings = this.getSettings();
        const prompt = buildPhoneReplyMessages({
            contactName: this.getContact().name,
            userName: this.getUserName(),
            sourceLanguage: settings.sourceLanguage,
            targetLanguage: settings.targetLanguage,
            history,
            callMode,
            preset: settings.promptPreset,
        });

        const result = await requestPhoneGeneration({
            settings,
            prompt,
            jsonSchema: PHONE_REPLY_SCHEMA,
            generateQuietPrompt,
        });
        return parsePhoneReply(result, { targetLanguage: settings.targetLanguage });
    }

    async translate(text, targetLanguage) {
        try {
            const module = await import('/scripts/extensions/translate/index.js');
            return await module.translate(String(text || ''), targetLanguage);
        } catch (error) {
            console.warn('[Phonie] Translation unavailable.', error);
            return '';
        }
    }

    async speakMessage(messageId) {
        const button = document.querySelector(`#chat .mes[mesid="${Number(messageId)}"] .mes_narrate`);
        if (button instanceof HTMLElement) {
            button.click();
            return;
        }

        const message = this.getMessage(messageId);
        if (message?.mes) {
            await this.speakText(message.mes, message.name || this.getContact().name);
        }
    }

    async speakText(text, voiceName) {
        const command = `/speak voice="${safeSlashValue(voiceName)}" ${safeSlashValue(text)}`;
        return executeSlashCommandsWithOptions(command, {
            handleParserErrors: true,
            handleExecutionErrors: true,
            source: 'phonie',
        });
    }

    stopSpeech() {
        cancelTtsPlay();
    }

    updateContinuityPrompt(metadata) {
        const settings = this.getSettings();
        const value = settings.injectContinuity
            ? buildContinuityPrompt({
                contactName: this.getContact().name,
                messages: metadata.messages,
                calls: metadata.calls,
            })
            : '';

        setExtensionPrompt(
            PROMPT_KEY,
            value,
            extension_prompt_types.IN_CHAT,
            1,
            false,
            extension_prompt_roles.SYSTEM,
        );
    }

    clearContinuityPrompt() {
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 1, false, extension_prompt_roles.SYSTEM);
    }

    updateBodyPromptInjection(generationType = 'normal') {
        const settings = this.getSettings();
        for (const entry of settings.bodyPromptPreset?.entries || []) {
            this.#bodyPromptKeys.add(`${BODY_PROMPT_PREFIX}${entry.id}`);
        }
        this.clearBodyPrompt();
        if (['quiet', 'impersonate'].includes(String(generationType || '').toLowerCase())) return;
        if (!settings.bodyPromptEnabled) return;
        const entries = compileBodyPromptEntries({
            preset: settings.bodyPromptPreset,
            characterName: this.getContact().name,
            userName: this.getUserName(),
            sourceLanguage: settings.sourceLanguage,
            targetLanguage: settings.targetLanguage,
        });
        for (const entry of entries) {
            const key = `${BODY_PROMPT_PREFIX}${entry.id}`;
            this.#bodyPromptKeys.add(key);
            setExtensionPrompt(
                key,
                entry.content,
                extension_prompt_types.IN_CHAT,
                entry.depth,
                false,
                BODY_PROMPT_ROLES[entry.role] ?? extension_prompt_roles.SYSTEM,
            );
        }
    }

    clearBodyPrompt() {
        for (const key of this.#bodyPromptKeys) {
            setExtensionPrompt(key, '', extension_prompt_types.IN_CHAT, 1, false, extension_prompt_roles.SYSTEM);
        }
        this.#bodyPromptKeys.clear();
    }

    on(eventName, handler) {
        eventSource.on(eventName, handler);
        const dispose = () => eventSource.removeListener(eventName, handler);
        this.#listeners.push(dispose);
        return dispose;
    }

    get events() {
        return event_types;
    }

    dispose() {
        for (const dispose of this.#listeners.splice(0)) dispose();
        this.clearContinuityPrompt();
        this.clearBodyPrompt();
    }
}
