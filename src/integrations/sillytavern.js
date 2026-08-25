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
import { normalizePhonePromptPreset } from '../dialogue/prompt-preset.js';
import { buildContinuityPrompt, buildPhoneReplyMessages, parsePhoneReply } from '../dialogue/prompt-service.js';
import { createPhoneMetadata } from '../phone/chat-records.js';

const PROMPT_KEY = 'phonie_private_channel';

function mergeSettings(value = {}) {
    const merged = { ...DEFAULT_SETTINGS, ...value, schemaVersion: DEFAULT_SETTINGS.schemaVersion };
    merged.phoneResponseLength = Math.min(1200, Math.max(80, Math.round(Number(merged.phoneResponseLength) || 420)));
    merged.promptPreset = normalizePhonePromptPreset(value.promptPreset);
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
        return String(extension_settings.tts?.currentProvider || 'TTS 未配置');
    }

    getGenerationProfiles() {
        return listConnectionProfiles(this.context);
    }

    getGenerationTarget(settings = this.getSettings()) {
        const selected = this.getGenerationProfiles().find((profile) => profile.id === settings.generationProfileId);
        return selected || getCurrentGenerationTarget(this.context);
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
    }
}
