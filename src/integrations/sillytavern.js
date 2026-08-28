import {
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    generateQuietPrompt,
    getCurrentChatId,
    getRequestHeaders,
    saveChatConditional,
    saveSettingsDebounced,
    setExtensionPrompt,
} from '/script.js';
import { extension_settings, getContext } from '/scripts/extensions.js';

import { DEFAULT_SETTINGS, MODULE_ID, PHONE_CALL_SCRIPT_SCHEMA, PHONE_GROUP_REPLY_SCHEMA, PHONE_REPLY_SCHEMA } from '../core/constants.js';
import { getCurrentGenerationTarget, requestPhoneGeneration } from './generation-compat.js';
import {
    DEFAULT_CALL_PROMPT_PRESET,
    DEFAULT_CHAT_PROMPT_PRESET,
    DEFAULT_GROUP_CALL_PROMPT_PRESET,
    DEFAULT_PHONE_PROMPT_PRESET,
    normalizePhonePromptPreset,
    normalizePromptPresetLibrary,
} from '../dialogue/prompt-preset.js';
import { compileBodyPromptEntries, DEFAULT_BODY_PROMPT_PRESET, parseBodySpeechSegments } from '../dialogue/body-speech.js';
import { buildCharacterDirectory } from '../dialogue/character-directory.js';
import { buildContinuityPrompt, buildPhoneReplyMessages, parsePhoneReply } from '../dialogue/prompt-service.js';
import { createPhoneMetadata } from '../phone/chat-records.js';
import { fetchCustomOpenAIModels, saveCustomOpenAIKey } from './openai-compatible.js';
import { TTS_PROVIDERS, normalizeProviderSettings } from '../tts/provider-catalog.js';

const PROMPT_KEY = 'phonie_private_channel';
const BODY_PROMPT_PREFIX = 'phonie_body_tts_';
const BODY_PROMPT_ROLES = Object.freeze({
    system: extension_prompt_roles.SYSTEM,
    user: extension_prompt_roles.USER,
    assistant: extension_prompt_roles.ASSISTANT,
});

function mergeSettings(value = {}) {
    const merged = { ...DEFAULT_SETTINGS, ...value, schemaVersion: DEFAULT_SETTINGS.schemaVersion };
    merged.phoneResponseLength = Math.min(65536, Math.max(256, Math.round(Number(merged.phoneResponseLength) || 8192)));
    merged.callResponseLength = Math.min(420, Math.max(80, Math.round(Number(merged.callResponseLength) || 180)));
    merged.callScriptResponseLength = Math.min(65536, Math.max(1200, Math.round(Number(merged.callScriptResponseLength) || 8192)));
    merged.callLength = ['short', 'normal', 'long'].includes(value.callLength) ? value.callLength : 'normal';
    merged.launcherMode = ['orb', 'wand', 'both'].includes(merged.launcherMode) ? merged.launcherMode : 'orb';
    merged.generationMode = ['tavern', 'custom'].includes(merged.generationMode) ? merged.generationMode : 'tavern';
    merged.customOpenAIEndpoint = String(merged.customOpenAIEndpoint || '').trim().slice(0, 1000);
    merged.customOpenAIModel = String(merged.customOpenAIModel || '').trim().slice(0, 300);
    merged.customOpenAIModels = Array.isArray(merged.customOpenAIModels)
        ? [...new Set(merged.customOpenAIModels.map((model) => String(model || '').trim()).filter(Boolean))].slice(0, 500)
        : [];
    merged.customOpenAITemperature = Math.min(2, Math.max(0, Number(merged.customOpenAITemperature) || 0.8));
    merged.customOpenAIMaxTokens = Math.min(65536, Math.max(80, Math.round(Number(merged.customOpenAIMaxTokens) || 8192)));
    merged.novelAiModel = String(merged.novelAiModel || DEFAULT_SETTINGS.novelAiModel);
    merged.novelAiSampler = String(merged.novelAiSampler || DEFAULT_SETTINGS.novelAiSampler);
    merged.novelAiScheduler = String(merged.novelAiScheduler || DEFAULT_SETTINGS.novelAiScheduler);
    merged.novelAiWidth = Math.min(1536, Math.max(256, Math.round(Number(merged.novelAiWidth) || 832)));
    merged.novelAiHeight = Math.min(1536, Math.max(256, Math.round(Number(merged.novelAiHeight) || 1216)));
    merged.novelAiSteps = Math.min(50, Math.max(1, Math.round(Number(merged.novelAiSteps) || 28)));
    merged.novelAiScale = Math.min(10, Math.max(1, Number(merged.novelAiScale) || 5));
    merged.novelAiNegativePrompt = String(merged.novelAiNegativePrompt || DEFAULT_SETTINGS.novelAiNegativePrompt).slice(0, 6000);
    merged.novelAiArtistTags = String(merged.novelAiArtistTags || '').slice(0, 3000);
    merged.novelAiTagInstruction = String(merged.novelAiTagInstruction || DEFAULT_SETTINGS.novelAiTagInstruction).slice(0, 6000);
    merged.novelAiActivePresetId = String(merged.novelAiActivePresetId || '').slice(0, 120);
    merged.novelAiPromptPresets = Array.isArray(merged.novelAiPromptPresets)
        ? merged.novelAiPromptPresets.slice(0, 80).map((entry, index) => ({
            id: String(entry?.id || `nai-preset-${index + 1}`).slice(0, 120),
            name: String(entry?.name || `提示词 ${index + 1}`).trim().slice(0, 80),
            prompt: String(entry?.prompt || '').slice(0, 6000),
            artistTags: String(entry?.artistTags || '').slice(0, 3000),
            negativePrompt: String(entry?.negativePrompt || '').slice(0, 6000),
        }))
        : [];
    const legacyPrompt = value.promptPreset || DEFAULT_PHONE_PROMPT_PRESET;
    merged.chatPromptPreset = normalizePhonePromptPreset(value.chatPromptPreset || legacyPrompt || DEFAULT_CHAT_PROMPT_PRESET);
    merged.callPromptPreset = normalizePhonePromptPreset(value.callPromptPreset || legacyPrompt || DEFAULT_CALL_PROMPT_PRESET);
    merged.groupCallPromptPreset = normalizePhonePromptPreset(value.groupCallPromptPreset || DEFAULT_GROUP_CALL_PROMPT_PRESET);
    merged.promptPreset = merged.chatPromptPreset;
    merged.bodyPromptPreset = normalizePhonePromptPreset(value.bodyPromptPreset || DEFAULT_BODY_PROMPT_PRESET);
    const sourceLibraries = { ...(value.promptPresetLibraries || {}) };
    if (!sourceLibraries.chat && sourceLibraries.phone) sourceLibraries.chat = sourceLibraries.phone;
    if (!sourceLibraries.call_single) sourceLibraries.call_single = sourceLibraries.call || sourceLibraries.phone || [merged.callPromptPreset];
    if (!sourceLibraries.call_group) sourceLibraries.call_group = sourceLibraries.groupCall || [merged.groupCallPromptPreset];
    merged.promptPresetLibraries = normalizePromptPresetLibrary(sourceLibraries, {
        body: merged.bodyPromptPreset,
        chat: merged.chatPromptPreset,
        call_single: merged.callPromptPreset,
        call_group: merged.groupCallPromptPreset,
    });
    merged.bodyPromptEnabled = value.bodyPromptEnabled !== false;
    const workflowKind = value.promptWorkflowKind === 'call' ? 'call_single' : value.promptWorkflowKind;
    merged.promptWorkflowKind = ['body', 'chat', 'call_single', 'call_group'].includes(workflowKind)
        ? workflowKind
        : workflowKind === 'phone' ? 'chat' : 'body';
    const providerIds = new Set(TTS_PROVIDERS.map((provider) => provider.id));
    merged.ttsActiveProvider = providerIds.has(value.ttsActiveProvider) ? value.ttsActiveProvider : DEFAULT_SETTINGS.ttsActiveProvider;
    merged.ttsFallbackProvider = providerIds.has(value.ttsFallbackProvider) && value.ttsFallbackProvider !== merged.ttsActiveProvider
        ? value.ttsFallbackProvider
        : '';
    merged.ttsProviderSettings = normalizeProviderSettings(value.ttsProviderSettings);
    merged.ttsCharacterRoutes = value.ttsCharacterRoutes && typeof value.ttsCharacterRoutes === 'object' ? value.ttsCharacterRoutes : {};
    merged.ttsResourceCatalogs = value.ttsResourceCatalogs && typeof value.ttsResourceCatalogs === 'object' ? value.ttsResourceCatalogs : {};
    if (Number(value.schemaVersion || 0) < 3) {
        const defaults = new Map(DEFAULT_PHONE_PROMPT_PRESET.entries.map((entry) => [entry.id, entry.content]));
        merged.chatPromptPreset.entries = merged.chatPromptPreset.entries.map((entry) => {
            const isLegacyDefault = /Continue an in-world|Write originalText|Reply naturally/.test(entry.content);
            return isLegacyDefault && defaults.has(entry.id) ? { ...entry, content: defaults.get(entry.id) } : entry;
        });
    }
    return merged;
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
        const id = character?.avatar
            ? 'card:' + encodeURIComponent(character.avatar)
            : 'speaker:' + encodeURIComponent(name.toLocaleLowerCase('zh-CN'));
        return { id, name, avatarUrl };
    }

    getCharacterDirectory(settings = this.getSettings()) {
        const messages = this.getMessages().map((message, messageId) => {
            if (message?.extra?.phonie?.bodySpeech?.length) return message;
            if (!message?.mes || message?.is_user || message?.is_system) return message;
            const bodySpeech = parseBodySpeechSegments(message.mes, {
                messageId,
                preferredLanguage: settings.sourceLanguage,
            });
            return bodySpeech.length
                ? { ...message, extra: { ...(message.extra || {}), phonie: { ...(message.extra?.phonie || {}), bodySpeech } } }
                : message;
        });
        return buildCharacterDirectory({
            currentContact: this.getContact(),
            characters: this.context?.characters || [],
            routes: settings.ttsCharacterRoutes,
            messages,
            speakersOnly: true,
        });
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
        const current = createPhoneMetadata(context?.chatMetadata?.[MODULE_ID]);
        let backup = createPhoneMetadata();
        try {
            backup = createPhoneMetadata(JSON.parse(localStorage.getItem(`${MODULE_ID}:chat-backup:${this.getChatId()}`) || '{}'));
        } catch (error) {
            console.warn('[Phonie] Phone history backup could not be read.', error);
        }
        const restored = backup.updatedAt > current.updatedAt ? backup : current;
        if (context?.chatMetadata) context.chatMetadata[MODULE_ID] = restored;
        return restored;
    }

    savePhoneMetadata(metadata) {
        const context = this.context;
        if (!context?.chatMetadata) return;
        const saved = createPhoneMetadata({ ...metadata, updatedAt: Date.now() });
        context.chatMetadata[MODULE_ID] = saved;
        try {
            localStorage.setItem(`${MODULE_ID}:chat-backup:${this.getChatId()}`, JSON.stringify(saved));
        } catch (error) {
            console.warn('[Phonie] Phone history backup could not be saved.', error);
        }
        context.saveMetadataDebounced?.();
    }

    async saveMessageExtra() {
        await saveChatConditional();
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
        return getCurrentGenerationTarget(this.context);
    }

    async saveCustomOpenAIKey(value) {
        return saveCustomOpenAIKey(value);
    }

    async refreshCustomOpenAIModels(endpoint) {
        return fetchCustomOpenAIModels(endpoint);
    }

    async saveNovelAiToken(value) {
        const token = String(value || '').trim();
        if (!token) throw new Error('请输入 NovelAI Persistent API Token');
        const secrets = await import('/scripts/secrets.js');
        if (!secrets.SECRET_KEYS?.NOVEL || typeof secrets.writeSecret !== 'function') {
            throw new Error('当前酒馆版本没有 NovelAI 安全密钥槽');
        }
        await secrets.writeSecret(secrets.SECRET_KEYS.NOVEL, token, 'Phonie · NovelAI Diffusion');
        return true;
    }

    async generateNovelAiImage({ prompt, artistTags, negativePrompt, model, width, height, steps, scale, seed } = {}) {
        const cleanPrompt = String(prompt || '').trim();
        if (!cleanPrompt) throw new Error('请先填写画面描述');
        const cleanArtistTags = String(artistTags || '').trim();
        const combinedPrompt = [cleanArtistTags, cleanPrompt].filter(Boolean).join(', ');
        const isV5 = String(model || '').includes('nai-diffusion-5');
        const response = await fetch('/api/novelai/generate-image', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                prompt: combinedPrompt,
                negative_prompt: String(negativePrompt || ''),
                model: model || 'nai-diffusion-5-full',
                params_version: isV5 ? 4 : 3,
                sampler: 'k_euler_ancestral',
                scheduler: 'karras',
                steps: Number(steps) || 28,
                scale: Number(scale) || 5,
                width: Number(width) || 832,
                height: Number(height) || 1216,
                seed: Number.isFinite(Number(seed)) ? Number(seed) : undefined,
                upscale_ratio: 1,
                decrisper: false,
                variety_boost: !isV5,
                sm: false,
                sm_dyn: false,
            }),
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            if (response.status === 400) throw new Error('NovelAI Token 尚未保存或不可用');
            throw new Error(detail || `NovelAI 生成失败（HTTP ${response.status}）`);
        }
        const base64 = (await response.text()).trim();
        if (!base64) throw new Error('NovelAI 没有返回图片');
        return `data:image/png;base64,${base64}`;
    }

    async generateNovelAiTags({ idea, instruction } = {}) {
        const settings = this.getSettings();
        const cleanIdea = String(idea || '').trim();
        if (!cleanIdea) throw new Error('请先写画面意图');
        const context = await this.getCallPlanningContext({ participants: [this.getContact()], topic: cleanIdea });
        const schema = {
            type: 'object',
            additionalProperties: false,
            required: ['prompt', 'artistTags', 'negativePrompt'],
            properties: {
                prompt: { type: 'string' },
                artistTags: { type: 'string' },
                negativePrompt: { type: 'string' },
            },
        };
        const prompt = [
            { role: 'system', content: String(instruction || settings.novelAiTagInstruction || DEFAULT_SETTINGS.novelAiTagInstruction) },
            { role: 'user', content: `[角色与上下文]\n${context}\n\n[画面意图]\n${cleanIdea}\n\n只输出符合 Schema 的 JSON。` },
        ];
        const result = await requestPhoneGeneration({
            settings: { ...settings, phoneResponseLength: Math.max(1600, settings.phoneResponseLength) },
            prompt,
            jsonSchema: schema,
            generateQuietPrompt,
        });
        let value = result;
        while (value && typeof value === 'object') {
            if (value.prompt != null) break;
            if (value.content != null) { value = value.content; continue; }
            if (Array.isArray(value.choices) && value.choices.length) { value = value.choices[0]?.message?.content ?? value.choices[0]?.text; continue; }
            break;
        }
        if (typeof value === 'string') {
            const clean = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
            value = JSON.parse(clean);
        }
        const generated = {
            prompt: String(value?.prompt || '').trim(),
            artistTags: String(value?.artistTags || '').trim(),
            negativePrompt: String(value?.negativePrompt || '').trim(),
        };
        if (!generated.prompt) throw new Error('模型没有返回正面提示词');
        return generated;
    }

    async getCallPlanningContext({ participants = [], topic = '' } = {}) {
        const context = this.context || {};
        const chat = this.getMessages();
        const lastInContext = Number(context.chatMetadata?.lastInContextMessageId);
        const start = Number.isFinite(lastInContext) && lastInContext >= 0
            ? Math.min(chat.length, lastInContext)
            : Math.max(0, chat.length - 18);
        const recent = chat.slice(start).slice(-18);
        const summary = [...chat].reverse()
            .map((message) => message?.extra?.memory || message?.extra?.summary || '')
            .find(Boolean);
        const lines = recent.map((message) => {
            const name = message?.name || (message?.is_user ? this.getUserName() : this.getContact().name);
            return `${name}: ${String(message?.mes || '').replace(/\s+/g, ' ').slice(0, 520)}`;
        });
        let worldInfo = '';
        if (typeof context.getWorldInfoPrompt === 'function' && recent.length) {
            try {
                const scan = recent.map((message) => (
                    `${message?.name || (message?.is_user ? this.getUserName() : this.getContact().name)}: ${message?.mes || ''}`
                )).reverse();
                const result = await context.getWorldInfoPrompt(
                    scan,
                    Math.min(Number(context.maxContext) || 8192, 8192),
                    true,
                    { ...(context.getCharacterCardFields?.() || {}), trigger: 'normal' },
                );
                worldInfo = [
                    result?.worldInfoBefore,
                    result?.worldInfoAfter,
                    ...(Array.isArray(result?.worldInfoDepth) ? result.worldInfoDepth.map((entry) => entry?.content || entry) : []),
                ].filter(Boolean).join('\n');
            } catch (error) {
                console.warn('[Phonie] Worldbook context scan unavailable.', error);
            }
        }
        const blocks = [
            summary ? `[当前摘要]\n${String(summary).slice(0, 3200)}` : '',
            worldInfo ? `[已启用世界书命中]\n${worldInfo.slice(0, 4200)}` : '',
            lines.length ? `[当前上下文]\n${lines.join('\n')}` : '',
            participants.length ? `[通话参与者]\n${participants.map((entry) => entry?.name || entry).join('、')}` : '',
            topic ? `[用户指定主题]\n${String(topic).slice(0, 600)}` : '',
        ];
        return blocks.filter(Boolean).join('\n\n').slice(0, 9000);
    }

    async generatePhoneReply({ history, callMode = false, participants = [], topic = '', strategy = 'context', scriptMode = false, callLength = 'normal' }) {
        const settings = this.getSettings();
        const participantCount = participants.length || 1;
        const storyContext = callMode ? await this.getCallPlanningContext({ participants, topic }) : '';
        const prompt = buildPhoneReplyMessages({
            contactName: participants.map((entry) => entry?.name || entry).filter(Boolean).join('、') || this.getContact().name,
            userName: this.getUserName(),
            sourceLanguage: settings.sourceLanguage,
            targetLanguage: settings.targetLanguage,
            history,
            callMode,
            preset: callMode
                ? participantCount > 1 ? settings.groupCallPromptPreset : settings.callPromptPreset
                : settings.chatPromptPreset,
            storyContext,
            participants,
            topic,
            strategy,
            scriptMode,
            callLength,
        });
        const groupChatMode = !callMode && participantCount > 1;
        const lengthBudget = participantCount > 1
            ? 12288
            : callLength === 'long' ? 8192 : callLength === 'short' ? 2048 : 4096;
        const generationSettings = callMode ? {
            ...settings,
            phoneResponseLength: scriptMode
                ? Math.max(settings.callScriptResponseLength, lengthBudget)
                : settings.callResponseLength,
        } : groupChatMode ? {
            ...settings,
            phoneResponseLength: Math.max(settings.phoneResponseLength, 4096),
        } : settings;
        const jsonSchema = scriptMode
            ? PHONE_CALL_SCRIPT_SCHEMA
            : groupChatMode ? PHONE_GROUP_REPLY_SCHEMA : PHONE_REPLY_SCHEMA;
        const request = (messages) => requestPhoneGeneration({
            settings: generationSettings,
            prompt: messages,
            jsonSchema,
            generateQuietPrompt,
        });
        const result = await request(prompt);
        try {
            return parsePhoneReply(result, { targetLanguage: settings.targetLanguage });
        } catch (firstError) {
            const retryPrompt = [...prompt, {
                role: 'system',
                content: scriptMode
                    ? '上一次输出无效。立即重新输出完整 JSON。turns 不得为空，每段 originalText 必须是可直接朗读的非空台词。禁止返回空对象。'
                    : groupChatMode
                        ? '上一次群聊输出无效。立即重新输出完整 JSON。turns 必须有 2 到 8 条，每条都要有群聊参与者 speaker 与非空 originalText；不要替用户说话。'
                        : '上一次输出无效。立即重新输出完整 JSON，originalText 必须是可直接朗读的非空台词。禁止返回空对象。',
            }];
            const retry = await request(retryPrompt);
            try {
                return parsePhoneReply(retry, { targetLanguage: settings.targetLanguage });
            } catch (retryError) {
                throw new Error(groupChatMode ? '模型连续两次返回无效群聊内容' : '模型连续两次返回空白电话内容', { cause: retryError || firstError });
            }
        }
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
