import {
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    generateQuietPrompt,
    getCurrentChatId,
    saveSettingsDebounced,
    setExtensionPrompt,
} from '/script.js';
import { extension_settings, getContext } from '/scripts/extensions.js';
import { power_user } from '/scripts/power-user.js';
import {
    createDefaultPromptPreset,
    DEFAULT_SETTINGS,
    ENGINES,
    MODULE_ID,
    THEMES,
} from '../core/constants.js';
import { extractJsonObject } from '../core/contracts.js';
import { compilePresetMessages, normalizePromptLibrary, resolveVariables } from '../dialogue/prompts.js';
import { parseBodySpeechTags } from '../dialogue/body-speech.js';
import { PHONIE_SECRET_KINDS, revealPhonieSecret } from './secrets.js';

const BODY_PROMPT_PREFIX = 'phonie_v2_body_tts_';

function mergeSettings(value = {}) {
    const presets = {};
    for (const kind of ['body', 'single_call', 'group_call', 'chat', 'image']) {
        presets[kind] = normalizePromptLibrary(
            value.promptPresets?.[kind] || createDefaultPromptPreset(kind),
            kind,
        );
    }
    return {
        ...DEFAULT_SETTINGS,
        ...value,
        schemaVersion: DEFAULT_SETTINGS.schemaVersion,
        theme: Object.values(THEMES).includes(value.theme) ? value.theme : DEFAULT_SETTINGS.theme,
        launcherMode: ['orb', 'wand', 'both'].includes(value.launcherMode) ? value.launcherMode : 'orb',
        generationMode: ['tavern', 'custom'].includes(value.generationMode) ? value.generationMode : 'tavern',
        ttsActiveProvider: ENGINES.some((engine) => engine.id === value.ttsActiveProvider)
            ? value.ttsActiveProvider
            : 'edge',
        customOpenAIPresets: Array.isArray(value.customOpenAIPresets) ? value.customOpenAIPresets : [],
        contacts: Array.isArray(value.contacts) ? value.contacts : [],
        ignoredContacts: Array.isArray(value.ignoredContacts) ? value.ignoredContacts : [],
        qqFriends: Array.isArray(value.qqFriends) ? value.qqFriends : [],
        qqGroups: Array.isArray(value.qqGroups) ? value.qqGroups : [],
        stickers: Array.isArray(value.stickers) ? value.stickers : [],
        favoriteCalls: Array.isArray(value.favoriteCalls) ? value.favoriteCalls : [],
        novelAi: {
            ...DEFAULT_SETTINGS.novelAi,
            ...(value.novelAi && typeof value.novelAi === 'object' ? value.novelAi : {}),
            steps: Math.min(28, Math.max(1, Number(value.novelAi?.steps) || 28)),
        },
        proactiveCalls: {
            enabled: value.proactiveCalls?.enabled !== false,
            cooldownMinutes: Math.min(1440, Math.max(0, Number(value.proactiveCalls?.cooldownMinutes) || 30)),
            cooldownByContact: value.proactiveCalls?.cooldownByContact && typeof value.proactiveCalls.cooldownByContact === 'object'
                ? value.proactiveCalls.cooldownByContact
                : {},
        },
        promptPresets: presets,
        customTheme: {
            ...DEFAULT_SETTINGS.customTheme,
            ...(value.customTheme || {}),
            colors: { ...DEFAULT_SETTINGS.customTheme.colors, ...(value.customTheme?.colors || {}) },
            appIcons: value.customTheme?.appIcons && typeof value.customTheme.appIcons === 'object' ? value.customTheme.appIcons : {},
        },
        dockSide: ['left', 'right'].includes(value.dockSide) ? value.dockSide : 'right',
        dockY: Math.min(1, Math.max(0, Number(value.dockY) || 0.5)),
    };
}

/** 探测酒馆明暗主题。 */
export function detectTavernScheme({ documentRef = globalThis.document } = {}) {
    if (!documentRef?.body) return 'dark';
    const classToken = String(documentRef.body.className || '').toLowerCase();
    if (/dark|black|night/.test(classToken)) return 'dark';
    if (/light|white|day/.test(classToken)) return 'light';
    const candidate = documentRef.querySelector('#sheld') || documentRef.body;
    const color = documentRef.defaultView?.getComputedStyle?.(candidate)?.backgroundColor || '';
    const match = color.match(/rgba?\(([^)]+)\)/);
    if (!match) return 'dark';
    const channels = match[1].split(',').map((part) => Number.parseFloat(part));
    const [red = 0, green = 0, blue = 0] = channels;
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 160 ? 'light' : 'dark';
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

    getUserName() {
        return String(this.context?.name1 || this.context?.userName || 'User');
    }

    getContact() {
        const context = this.context;
        const character = context?.characters?.[context?.characterId];
        const name = String(character?.name || context?.name2 || context?.characterName || 'Character');
        const avatarUrl = character?.avatar ? `/characters/${encodeURIComponent(character.avatar)}` : '';
        const id = character?.avatar
            ? 'card:' + encodeURIComponent(character.avatar)
            : 'speaker:' + encodeURIComponent(name.toLocaleLowerCase('zh-CN'));
        return { id, name, avatarUrl };
    }

    getChatId() {
        return getCurrentChatId() || 'no-chat';
    }

    getMessages() {
        return Array.isArray(this.context?.chat) ? this.context.chat : [];
    }

    /** 通讯录目录：当前角色 + 手动联系人 + 正文 [TTS:…] 中出现过的说话人。 */
    getCharacterDirectory(settings = this.getSettings()) {
        const current = this.getContact();
        const map = new Map();
        map.set(current.id, { ...current, current: true });
        for (const entry of settings.contacts || []) {
            if (entry?.name) map.set(entry.id, { id: entry.id, name: entry.name, avatarUrl: entry.avatarUrl || '', source: entry.source || 'manual' });
        }
        for (const message of this.getMessages()) {
            if (message?.is_user || message?.is_system) continue;
            for (const segment of parseBodySpeechTags(message.mes)) {
                if (segment.type !== 'speech' || !segment.speaker) continue;
                const id = 'speaker:' + encodeURIComponent(segment.speaker.toLocaleLowerCase('zh-CN'));
                const ignored = (settings.ignoredContacts || []).some((name) => String(name || '').toLocaleLowerCase() === segment.speaker.toLocaleLowerCase());
                if (ignored || map.has(id)) continue;
                map.set(id, { id, name: segment.speaker, avatarUrl: '', source: 'body' });
            }
        }
        return [...map.values()];
    }

    /** 保存当前聊天的 QQ 消息 / 通话记录。 */
    saveChatMetadata(patch) {
        const context = this.context;
        if (!context?.chatMetadata) return;
        const current = context.chatMetadata[MODULE_ID] || {};
        context.chatMetadata[MODULE_ID] = { ...current, ...patch, updatedAt: Date.now() };
        context.saveMetadataDebounced?.();
    }

    getChatMetadata() {
        return this.context?.chatMetadata?.[MODULE_ID] || {};
    }

    /** 构建实际上下文：角色卡 + Persona + 上下文窗口 + 世界书命中 + QQ 记录。 */
    async buildStoryContext({ participants = [], topic = '', qqMessages = [] } = {}) {
        const context = this.context || {};
        const cardFields = context.getCharacterCardFields?.() || {};
        const characterCard = [cardFields.description, cardFields.personality, cardFields.scenario, cardFields.mesExamples]
            .map((value) => String(value || '').trim()).filter(Boolean).join('\n');
        const persona = String(power_user?.persona_description || '').trim();
        const chat = this.getMessages();
        const recent = chat.slice(-16).map((message) => {
            const name = message?.name || (message?.is_user ? this.getUserName() : this.getContact().name);
            return `${name}: ${String(message?.mes || '').replace(/\s+/g, ' ').slice(0, 400)}`;
        });
        let worldInfo = '';
        if (typeof context.getWorldInfoPrompt === 'function' && recent.length) {
            try {
                const result = await context.getWorldInfoPrompt(
                    recent.map((line) => line).reverse(),
                    Math.min(Number(context.maxContext) || 8192, 8192),
                    true,
                    { ...(cardFields || {}), trigger: 'normal' },
                );
                worldInfo = [result?.worldInfoBefore, result?.worldInfoAfter, ...(Array.isArray(result?.worldInfoDepth) ? result.worldInfoDepth.map((entry) => entry?.content || entry) : [])]
                    .filter(Boolean).join('\n');
            } catch {
                // 世界书扫描不可用时忽略。
            }
        }
        const qqHistory = qqMessages.slice(-16).map((message) => {
            const name = message.direction === 'outgoing' ? this.getUserName() : message.author;
            return `${name}: ${String(message.originalText || '').replace(/\s+/g, ' ').slice(0, 300)}`;
        }).join('\n');
        const blocks = [
            characterCard ? `[当前角色卡]\n${characterCard.slice(0, 4200)}` : '',
            persona ? `[当前 Persona]\n${persona.slice(0, 2400)}` : '',
            worldInfo ? `[世界书命中]\n${worldInfo.slice(0, 4200)}` : '',
            recent.length ? `[当前上下文]\n${recent.join('\n')}` : '',
            qqHistory ? `[QQ 最近记录]\n${qqHistory}` : '',
            participants.length ? `[通话参与者]\n${participants.map((entry) => entry?.name || entry).join('、')}` : '',
            topic ? `[用户指定主题]\n${String(topic).slice(0, 600)}` : '',
        ];
        const combined = blocks.filter(Boolean).join('\n\n').slice(0, 9000);
        return {
            combined,
            characterCard,
            persona,
            worldbook: worldInfo,
            storyHistory: recent.join('\n'),
            qqHistory,
        };
    }

    #generationTarget() {
        const settings = this.getSettings();
        if (settings.generationMode === 'custom') {
            return settings.customOpenAIPresets.find((preset) => preset.id === settings.activeCustomOpenAIPresetId) || null;
        }
        return null;
    }

    async #generate(messages, jsonSchema, { maxTokens = 8192 } = {}) {
        const settings = this.getSettings();
        const schema = JSON.stringify(jsonSchema);
        const instruction = `只输出符合以下 JSON Schema 的合法 JSON，不要输出任何其他文字：\n${schema}`;
        const finalMessages = [...messages, { role: 'system', content: instruction }];

        const preset = this.#generationTarget();
        if (preset) {
            if (!preset.secretId) throw new Error('当前模型预设缺少 SillyTavern Secrets 密钥');
            const apiKey = await revealPhonieSecret(PHONIE_SECRET_KINDS.OPENAI, preset.secretId);
            const response = await fetch(preset.endpoint.replace(/\/+$/, '') + '/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: preset.model,
                    messages: finalMessages,
                    temperature: Number(preset.temperature) || 0.7,
                    max_tokens: Math.min(30000, Number(preset.maxTokens) || maxTokens),
                }),
            });
            if (!response.ok) throw new Error(`自定义接口请求失败（HTTP ${response.status}）`);
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content ?? '';
            return extractJsonObject(content);
        }

        const prompt = finalMessages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join('\n\n');
        const raw = await generateQuietPrompt(prompt, false, true, null, { max_tokens: maxTokens });
        return extractJsonObject(raw);
    }

    /** 生成 QQ / 电话 / 生图等结构化回复。 */
    async generateJson({ workflow, schema, vars, extra = [], maxTokens }) {
        const settings = this.getSettings();
        const preset = settings.promptPresets?.[workflow] || createDefaultPromptPreset(workflow);
        const storyContext = await this.buildStoryContext({
            participants: vars.participants ? String(vars.participants).split('、') : [],
            topic: vars.topic || '',
            qqMessages: vars.qqMessages || [],
        });
        const resolvedVars = {
            '{{char}}': vars.char || this.getContact().name,
            '{{user}}': vars.user || this.getUserName(),
            '{{participants}}': vars.participants || this.getContact().name,
            '{{context}}': storyContext.combined,
            '{{worldbook}}': storyContext.worldbook,
            '{{storyHistory}}': storyContext.storyHistory || storyContext.combined,
            '{{qqHistory}}': vars.qqHistory || storyContext.qqHistory,
            '{{pendingMessages}}': vars.pendingMessages || '',
            '{{direction}}': vars.direction || '',
            '{{callLength}}': vars.callLength || settings.callLength,
            '{{sourceLanguage}}': settings.sourceLanguage,
            '{{targetLanguage}}': settings.targetLanguage,
            '{{imageIntent}}': vars.imageIntent || '',
            '{{outputSchema}}': JSON.stringify(schema),
        };
        const messages = compilePresetMessages({ preset, vars: resolvedVars, extra });
        return this.#generate(messages, schema, { maxTokens });
    }

    async generateNovelAiImage({ prompt, negativePrompt, model = 'nai-diffusion-5-full', width = 832, height = 1216, steps = 28, scale = 5, sampler = 'k_euler_ancestral', scheduler = 'karras', seed = -1, guidanceRescale = 0, decrisper = false } = {}) {
        const response = await fetch('/api/novelai/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                negative_prompt: negativePrompt,
                model,
                params_version: String(model || '').includes('nai-diffusion-5') ? 4 : 3,
                sampler,
                scheduler,
                steps: Math.min(28, Math.max(1, Math.round(Number(steps) || 28))),
                scale: Number(scale) || 5,
                width: Number(width) || 832,
                height: Number(height) || 1216,
                seed: Number.isFinite(Number(seed)) ? Number(seed) : undefined,
                upscale_ratio: 1,
                cfg_rescale: Math.min(1, Math.max(0, Number(guidanceRescale) || 0)),
                decrisper: Boolean(decrisper),
            }),
        });
        if (!response.ok) throw new Error(`NovelAI 生成失败（HTTP ${response.status}）`);
        const base64 = (await response.text()).trim();
        if (!base64) throw new Error('NovelAI 没有返回图片');
        return `data:image/png;base64,${base64}`;
    }

    /** 正文 TTS 提示词注入。 */
    updateBodyPromptInjection() {
        const settings = this.getSettings();
        for (const entry of settings.promptPresets?.body?.entries || []) {
            this.#bodyPromptKeys.add(`${BODY_PROMPT_PREFIX}${entry.id}`);
        }
        for (const key of this.#bodyPromptKeys) {
            setExtensionPrompt(key, '', extension_prompt_types.IN_CHAT, 1, false, extension_prompt_roles.SYSTEM);
        }
        this.#bodyPromptKeys.clear();
        if (!settings.bodyTtsEnabled || !settings.bodyPromptEnabled) return;
        const roleMap = { system: extension_prompt_roles.SYSTEM, user: extension_prompt_roles.USER, assistant: extension_prompt_roles.ASSISTANT };
        for (const entry of settings.promptPresets?.body?.entries || []) {
            if (!entry.enabled || !entry.content) continue;
            const key = `${BODY_PROMPT_PREFIX}${entry.id}`;
            this.#bodyPromptKeys.add(key);
            const content = resolveVariables(entry.content, {
                '{{char}}': this.getContact().name,
                '{{user}}': this.getUserName(),
                '{{sourceLanguage}}': settings.sourceLanguage,
                '{{targetLanguage}}': settings.targetLanguage,
            });
            setExtensionPrompt(key, content, extension_prompt_types.IN_CHAT, entry.depth, false, roleMap[entry.role] || extension_prompt_roles.SYSTEM);
        }
    }

    on(eventName, handler) {
        if (!event_types?.[eventName] || typeof eventSource?.on !== 'function') return () => {};
        const disposable = { name: eventName, handler };
        this.#listeners.push(disposable);
        eventSource.on(eventName, handler);
        return () => {
            eventSource.removeListener(eventName, handler);
            this.#listeners = this.#listeners.filter((entry) => entry !== disposable);
        };
    }

    get events() {
        return event_types || {};
    }

    dispose() {
        for (const { name, handler } of this.#listeners.splice(0)) {
            if (typeof eventSource?.removeListener === 'function') eventSource.removeListener(name, handler);
        }
    }
}
