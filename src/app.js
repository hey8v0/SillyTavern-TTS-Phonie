import { APP_VERSION, CALL_STATES, MESSAGE_KINDS, SCHEMA_VERSION, SCREENS, THEMES } from './core/constants.js';
import { createStore } from './core/store.js';
import { createDeviceStatusSnapshot, DeviceStatusMonitor } from './device/device-status.js';
import { DEFAULT_BODY_PROMPT_PRESET } from './dialogue/body-speech.js';
import {
    DEFAULT_PHONE_PROMPT_PRESET,
    importPromptPresetLibrary,
    removePromptPreset,
    savePromptPreset as savePromptPresetToLibrary,
} from './dialogue/prompt-preset.js';
import { SillyTavernBridge } from './integrations/sillytavern.js';
import { CallMachine } from './phone/call-machine.js';
import { createCallRecord, createPhoneMessage, recallPhoneMessage as markPhoneMessageRecalled } from './phone/chat-records.js';
import { AudioCache, makeAudioCacheKey } from './storage/audio-cache.js';
import { AudioFocusController } from './tts/audio-focus.js';
import { PhonieProviderCenter } from './tts/provider-center.js';
import { InlinePlayerManager } from './ui/inline-player.js';
import { PhoneView } from './ui/phone-view.js';

function buildCallSummary(messages, contactName) {
    const lines = messages.slice(-6).map((message) => {
        const speaker = message.direction === 'outgoing' ? 'User' : contactName;
        return `${speaker}: ${String(message.originalText || '').replace(/\s+/g, ' ').slice(0, 180)}`;
    });
    return lines.join(' / ').slice(0, 900);
}

export async function createPhonieApp() {
    const existing = globalThis.__phonieApp;
    if (
        existing?.version === APP_VERSION
        && document.getElementById('phonie-root')
        && document.getElementById('phonie-orb')
    ) return existing;
    if (existing?.dispose) {
        try {
            existing.dispose();
        } catch (error) {
            console.debug('[Phonie] Previous runtime cleanup failed; rebuilding the interface.', error);
        }
    }
    document.getElementById('phonie-root')?.remove();
    document.getElementById('phonie-orb')?.remove();
    document.getElementById('phonie-settings-launcher')?.remove();
    document.getElementById('phonie-wand-menu-item')?.remove();

    const bridge = new SillyTavernBridge();
    const settings = bridge.getSettings();
    const metadata = bridge.getPhoneMetadata();
    const contact = bridge.getContact();
    const characters = bridge.getCharacterDirectory(settings);
    const providerCenter = new PhonieProviderCenter({ bridge });
    const callMachine = new CallMachine();
    const audioCache = new AudioCache();
    const audioFocus = new AudioFocusController();
    let callConnectTimer = null;
    const deviceMonitor = new DeviceStatusMonitor({
        onChange: (deviceStatus) => updateState({ deviceStatus }),
    });

    const store = createStore({
        open: false,
        screen: SCREENS.HOME,
        settings: { ...settings },
        contact,
        userName: bridge.getUserName(),
        characters,
        selectedCharacterId: characters[0]?.id || '',
        selectedProviderId: settings.ttsActiveProvider,
        messages: metadata.messages,
        calls: metadata.calls,
        pendingUserMessageIds: metadata.pendingUserMessageIds,
        providerLabel: providerCenter.getActiveLabel(),
        providerSnapshot: providerCenter.snapshot(),
        deviceStatus: createDeviceStatusSnapshot(),
        generationProfiles: bridge.getGenerationProfiles(),
        generationTarget: bridge.getGenerationTarget(settings),
        customModelStatus: '',
        generating: false,
        callState: CALL_STATES.IDLE,
        callDirection: null,
        callStartedAt: null,
        callCaption: { source: '', translation: '' },
        callControls: { muted: false, speaker: false, captions: true },
        audioState: 'idle',
        audioCacheStats: { count: 0, bytes: 0 },
        cacheBusy: false,
        unread: 0,
        toast: null,
    });

    function updateState(patch) {
        store.setState((state) => ({ ...state, ...patch }));
    }

    function showToast(text) {
        updateState({ toast: { id: Date.now(), text } });
    }

    async function refreshAudioCacheStats() {
        const audioCacheStats = await audioCache.getStats();
        updateState({ audioCacheStats });
        return audioCacheStats;
    }

    function persistPhoneState(
        messages = store.getState().messages,
        calls = store.getState().calls,
        pendingUserMessageIds = store.getState().pendingUserMessageIds,
    ) {
        const nextMetadata = { schemaVersion: SCHEMA_VERSION, messages, calls, pendingUserMessageIds };
        bridge.savePhoneMetadata(nextMetadata);
        bridge.updateContinuityPrompt(nextMetadata);
    }

    async function preparePhoneAudio(message, voiceName, { autoplay = true } = {}) {
        const key = message.audioCacheKey || makeAudioCacheKey({
            chatId: bridge.getChatId(),
            messageId: message.id,
            text: message.originalText,
            provider: providerCenter.getCacheSignature(voiceName),
        });
        message.audioCacheKey = key;

        let source = audioFocus.getSource(`phone:${message.id}`);
        if (!source) source = await audioCache.get(key);
        if (source) {
            audioFocus.setSource(`phone:${message.id}`, source);
            if (autoplay) {
                providerCenter.cancel();
                try {
                    await audioFocus.play(`phone:${message.id}`, { owner: 'phone', messageId: message.id });
                } catch (error) {
                    console.warn('[Phonie] Browser blocked cached audio autoplay.', error);
                }
            }
            return true;
        }

        const result = await providerCenter.synthesize({
            text: message.originalText,
            speaker: voiceName,
            emotion: message.emotion,
            language: message.language || store.getState().settings.sourceLanguage,
        });
        audioFocus.setSource(`phone:${message.id}`, result.blob);
        await audioCache.put(key, result.blob);
        refreshAudioCacheStats();
        if (autoplay) {
            await audioFocus.play(`phone:${message.id}`, { owner: 'phone', messageId: message.id });
        }
        return true;
    }

    async function sendMessage(text, kind, callMode, payload = {}) {
        const state = store.getState();
        const cleanText = String(text || '').trim();
        if (state.generating) {
            showToast('上一条回复仍在生成');
            return;
        }
        if (callMode && ![CALL_STATES.CONNECTED, CALL_STATES.SPEAKING].includes(state.callState)) {
            showToast('请先接通电话');
            return;
        }
        if (callMode && !cleanText) {
            showToast('通话中请先输入这一轮要说的话');
            return;
        }
        const existingPending = Array.isArray(state.pendingUserMessageIds) ? state.pendingUserMessageIds : [];
        if (!callMode && !cleanText && existingPending.length === 0) {
            showToast('先发送一条消息，再请求角色回复');
            return;
        }
        const originChatId = bridge.getChatId();
        if (callMode && state.callState === CALL_STATES.SPEAKING) {
            providerCenter.cancel();
            audioFocus.stop();
        }

        let outgoing = null;
        let withOutgoing = state.messages;
        let pendingUserMessageIds = existingPending;
        if (cleanText) {
            const replyTarget = payload.replyToId
                ? state.messages.find((message) => message.id === payload.replyToId)
                : null;
            outgoing = createPhoneMessage({
                direction: 'outgoing',
                author: bridge.getUserName(),
                originalText: cleanText,
                kind,
                ...payload,
                replySnapshot: replyTarget ? {
                    sender: replyTarget.author,
                    type: replyTarget.kind,
                    content: replyTarget.kind === MESSAGE_KINDS.RECALLED ? '原消息已撤回' : replyTarget.originalText,
                } : payload.replySnapshot,
            });
            withOutgoing = [...state.messages, outgoing];
            if (!callMode) pendingUserMessageIds = [...existingPending, outgoing.id];
        }

        if (!callMode && cleanText) {
            updateState({ messages: withOutgoing, pendingUserMessageIds });
            persistPhoneState(withOutgoing, state.calls, pendingUserMessageIds);
            if (outgoing?.kind === MESSAGE_KINDS.VOICE) {
                try {
                    await preparePhoneAudio(outgoing, bridge.getUserName(), { autoplay: true });
                } catch (error) {
                    console.warn('[Phonie] User voice message synthesis failed.', error);
                    showToast('语音消息已发送，但暂时无法生成音频');
                }
            }
            return;
        }

        updateState({ messages: withOutgoing, generating: true, audioState: 'generating' });
        persistPhoneState(withOutgoing, state.calls, pendingUserMessageIds);
        if (callMode && [CALL_STATES.SPEAKING, CALL_STATES.CONNECTED].includes(callMachine.state)) {
            callMachine.transition(CALL_STATES.GENERATING);
        }
        if (outgoing?.kind === MESSAGE_KINDS.VOICE) {
            try {
                await preparePhoneAudio(outgoing, bridge.getUserName(), { autoplay: true });
            } catch (error) {
                console.warn('[Phonie] User voice message synthesis failed.', error);
                showToast('语音消息已发送，但暂时无法生成音频');
            }
        }

        try {
            const reply = await bridge.generatePhoneReply({ history: withOutgoing, callMode });
            if (bridge.getChatId() !== originChatId) return;
            const currentSettings = store.getState().settings;
            const incoming = createPhoneMessage({
                direction: 'incoming',
                author: store.getState().contact.name,
                originalText: reply.originalText,
                translationText: reply.translationText,
                kind: callMode || currentSettings.autoPlayPhoneReplies ? MESSAGE_KINDS.VOICE : MESSAGE_KINDS.TEXT,
                emotion: reply.emotion,
            });
            const messages = [...store.getState().messages, incoming];
            const nextPending = callMode ? store.getState().pendingUserMessageIds : [];
            updateState({
                messages,
                pendingUserMessageIds: nextPending,
                generating: false,
                callCaption: callMode
                    ? { source: incoming.originalText, translation: incoming.translationText }
                    : store.getState().callCaption,
                unread: store.getState().open ? 0 : store.getState().unread + 1,
            });
            persistPhoneState(messages, store.getState().calls, nextPending);

            const shouldSpeak = callMode || currentSettings.autoPlayPhoneReplies;
            if (shouldSpeak) {
                if (callMode && callMachine.state === CALL_STATES.GENERATING) {
                    callMachine.transition(CALL_STATES.SPEAKING);
                }
                try {
                    await preparePhoneAudio(incoming, store.getState().contact, { autoplay: true });
                } catch (error) {
                    console.warn('[Phonie] Character phone audio synthesis failed.', error);
                    updateState({ audioState: 'idle' });
                    showToast('回复已收到，但角色语音生成失败');
                    if (callMode && callMachine.state === CALL_STATES.SPEAKING) {
                        callMachine.transition(CALL_STATES.CONNECTED);
                    }
                }
            } else {
                updateState({ audioState: 'idle' });
                if (callMode && callMachine.state === CALL_STATES.GENERATING) {
                    callMachine.transition(CALL_STATES.CONNECTED);
                }
            }

            if (reply.action === 'end_call' && callMode) {
                window.setTimeout(() => endCall(), 400);
            }
        } catch (error) {
            console.error('[Phonie] Phone reply failed.', error);
            updateState({ generating: false, audioState: 'idle' });
            if (callMode && callMachine.state === CALL_STATES.GENERATING) {
                callMachine.transition(CALL_STATES.ERROR, { error });
            }
            showToast('没有收到回复，请检查当前生成接口');
        }
    }

    async function generateIncomingCallOpening() {
        if (callMachine.state !== CALL_STATES.CONNECTED) return;
        updateState({ generating: true, audioState: 'generating' });
        callMachine.transition(CALL_STATES.GENERATING);
        try {
            const reply = await bridge.generatePhoneReply({ history: store.getState().messages, callMode: true });
            const incoming = createPhoneMessage({
                direction: 'incoming',
                author: store.getState().contact.name,
                originalText: reply.originalText,
                translationText: reply.translationText,
                kind: MESSAGE_KINDS.VOICE,
                emotion: reply.emotion,
            });
            const messages = [...store.getState().messages, incoming];
            updateState({
                messages,
                generating: false,
                callCaption: { source: incoming.originalText, translation: incoming.translationText },
            });
            persistPhoneState(messages, store.getState().calls);
            callMachine.transition(CALL_STATES.SPEAKING);
            await preparePhoneAudio(incoming, store.getState().contact, { autoplay: true });
        } catch (error) {
            console.error('[Phonie] Incoming call opener failed.', error);
            updateState({ generating: false, audioState: 'idle' });
            if ([CALL_STATES.GENERATING, CALL_STATES.SPEAKING].includes(callMachine.state)) {
                callMachine.transition(CALL_STATES.CONNECTED);
            }
            showToast('来电已接通，但角色暂时没有说话');
        }
    }

    function startCall() {
        const state = store.getState();
        if ([CALL_STATES.DIALING, CALL_STATES.RINGING, CALL_STATES.CONNECTED, CALL_STATES.GENERATING, CALL_STATES.SPEAKING].includes(callMachine.state)) {
            updateState({ screen: SCREENS.CALL, open: true });
            return;
        }
        window.clearTimeout(callConnectTimer);
        callMachine.transition(CALL_STATES.DIALING, { contact: state.contact.name });
        updateState({
            open: true,
            screen: SCREENS.CALL,
            callDirection: 'outgoing',
            callCaption: { source: '', translation: '' },
            callControls: { muted: false, speaker: false, captions: true },
        });
        callConnectTimer = window.setTimeout(() => {
            if (callMachine.state === CALL_STATES.DIALING) {
                callMachine.transition(CALL_STATES.RINGING);
                callConnectTimer = window.setTimeout(() => {
                    if (callMachine.state === CALL_STATES.RINGING && store.getState().callDirection === 'outgoing') {
                        callMachine.transition(CALL_STATES.CONNECTED);
                    }
                }, 900);
            }
        }, 420);
    }

    function startIncomingCall() {
        if (![CALL_STATES.IDLE, CALL_STATES.ENDED].includes(callMachine.state)) return;
        window.clearTimeout(callConnectTimer);
        callMachine.transition(CALL_STATES.RINGING, { contact: store.getState().contact.name, direction: 'incoming' });
        updateState({
            open: true,
            screen: SCREENS.CALL,
            callDirection: 'incoming',
            callCaption: { source: '', translation: '' },
            callControls: { muted: false, speaker: false, captions: true },
        });
        globalThis.navigator?.vibrate?.([160, 90, 160, 360, 160, 90, 160]);
    }

    function acceptCall() {
        if (callMachine.state !== CALL_STATES.RINGING || store.getState().callDirection !== 'incoming') return;
        globalThis.navigator?.vibrate?.(0);
        callMachine.transition(CALL_STATES.CONNECTED);
        window.setTimeout(() => generateIncomingCallOpening(), 360);
    }

    function declineCall() {
        if (callMachine.state !== CALL_STATES.RINGING) return;
        globalThis.navigator?.vibrate?.(0);
        endCall('declined');
    }

    function toggleCallControl(control) {
        if (!['muted', 'speaker', 'captions'].includes(control)) return;
        const current = store.getState().callControls;
        const next = { ...current, [control]: !current[control] };
        if (control === 'muted') audioFocus.setMuted(next.muted);
        if (control === 'speaker') audioFocus.setVolume(next.speaker ? 1 : 0.72);
        updateState({ callControls: next });
    }

    function endCall(outcome = 'completed') {
        window.clearTimeout(callConnectTimer);
        providerCenter.cancel();
        audioFocus.stop();
        const state = store.getState();
        const startedAt = callMachine.startedAt;
        if ([CALL_STATES.IDLE, CALL_STATES.ENDED].includes(callMachine.state)) return;
        if (callMachine.canTransition(CALL_STATES.ENDED)) {
            callMachine.transition(CALL_STATES.ENDED);
        }
        if (state.callDirection) {
            const endedAt = Date.now();
            const record = createCallRecord({
                contactName: state.contact.name,
                startedAt: startedAt || endedAt,
                endedAt,
                direction: state.callDirection,
                outcome,
                summary: outcome === 'declined' ? '已拒绝来电' : buildCallSummary(state.messages, state.contact.name),
            });
            const calls = [...state.calls, record];
            updateState({ calls, generating: false, audioState: 'idle', callDirection: null });
            persistPhoneState(state.messages, calls);
        }
    }

    async function playPhoneAudio(messageId) {
        const state = store.getState();
        const message = state.messages.find((entry) => entry.id === messageId);
        if (!message) return;
        try {
            const speaker = message.direction === 'incoming' && message.author === state.contact.name
                ? state.contact
                : message.author;
            await preparePhoneAudio(message, speaker, { autoplay: true });
        } catch (error) {
            console.error('[Phonie] Could not play phone audio.', error);
            showToast('这条语音暂时无法播放');
        }
    }

    const actions = {
        open() {
            const currentSettings = bridge.getSettings();
            const directory = bridge.getCharacterDirectory(currentSettings);
            updateState({
                open: true,
                unread: 0,
                settings: { ...currentSettings },
                characters: directory,
                selectedCharacterId: directory.some((entry) => entry.id === store.getState().selectedCharacterId)
                    ? store.getState().selectedCharacterId
                    : directory[0]?.id || '',
                providerLabel: providerCenter.getActiveLabel(),
                providerSnapshot: providerCenter.snapshot(),
                generationProfiles: bridge.getGenerationProfiles(),
                generationTarget: bridge.getGenerationTarget(currentSettings),
            });
            refreshAudioCacheStats();
        },
        close() {
            updateState({ open: false });
        },
        navigate(screen) {
            if (!Object.values(SCREENS).includes(screen)) return;
            updateState({ screen });
        },
        openTtsProvider(providerId) {
            if (!providerCenter.snapshot().providers.some((provider) => provider.id === providerId)) return;
            updateState({ selectedProviderId: providerId, screen: SCREENS.PROVIDER });
        },
        sendMessage,
        startCall,
        startIncomingCall,
        acceptCall,
        declineCall,
        toggleCallControl,
        endCall,
        playPhoneAudio,
        cycleTheme() {
            const order = [THEMES.DAY, THEMES.NIGHT, THEMES.TAVERN];
            const current = store.getState().settings.theme;
            const next = order[(Math.max(0, order.indexOf(current)) + 1) % order.length];
            const nextSettings = bridge.updateSettings({ theme: next });
            updateState({ settings: { ...nextSettings } });
            inlinePlayers.updateSettings(nextSettings);
            showToast(next === THEMES.DAY ? '已切换为日间主题' : next === THEMES.NIGHT ? '已切换为夜间主题' : '已跟随酒馆主题');
        },
        async setTtsProvider(providerId) {
            try {
                const nextSettings = providerCenter.setActive(providerId);
                updateState({
                    settings: { ...nextSettings },
                    providerLabel: providerCenter.getActiveLabel(),
                    providerSnapshot: providerCenter.snapshot(),
                });
                inlinePlayers.reset();
                window.setTimeout(() => inlinePlayers.decorateAll(), 0);
                showToast(`当前语音提供商：${providerCenter.getActiveLabel()}`);
            } catch (error) {
                console.error('[Phonie] Could not switch TTS provider.', error);
                showToast(error?.message || '语音提供商切换失败');
            }
        },
        updateTtsProvider(providerId, key, value) {
            providerCenter.updateProvider(providerId, { [key]: value });
            const nextSettings = bridge.getSettings();
            updateState({
                settings: { ...nextSettings },
                providerLabel: providerCenter.getActiveLabel(),
                providerSnapshot: providerCenter.snapshot(),
            });
        },
        async saveTtsSecret(providerId, key, value) {
            try {
                await providerCenter.saveSecret(providerId, key, value);
                updateState({ providerSnapshot: providerCenter.snapshot() });
                showToast('密钥已保存到酒馆安全密钥槽');
                return true;
            } catch (error) {
                showToast(error?.message || '密钥保存失败');
                return false;
            }
        },
        async checkTtsProvider(providerId) {
            showToast('正在检测语音服务连接');
            try {
                await providerCenter.checkProvider(providerId);
                updateState({ providerSnapshot: providerCenter.snapshot() });
                showToast('语音服务连接可用');
            } catch (error) {
                showToast(error?.message || '语音服务连接失败');
            }
        },
        async syncTtsResources(providerId) {
            showToast('正在同步模型与音色目录');
            try {
                await providerCenter.syncResources(providerId);
                updateState({ providerSnapshot: providerCenter.snapshot() });
                showToast('模型与音色已同步');
            } catch (error) {
                showToast(error?.message || '模型与音色同步失败');
            }
        },
        async previewTtsProvider(providerId, text) {
            const state = store.getState();
            const character = state.characters.find((entry) => entry.id === state.selectedCharacterId) || state.contact;
            const sample = String(text || '').trim() || 'おはよう。今日はどんな話をしようか。';
            try {
                const result = await providerCenter.synthesize({
                    providerId,
                    text: sample,
                    speaker: character,
                    language: character.route?.textLanguage || state.settings.sourceLanguage,
                });
                const key = 'provider-preview:' + providerId;
                audioFocus.setSource(key, result.blob);
                await audioFocus.play(key, { owner: 'provider-preview', providerId });
                showToast(result.providerLabel + ' 试听中');
            } catch (error) {
                showToast(error?.message || '供应商试听失败');
            }
        },
        selectCharacterRoute(characterId) {
            if (!store.getState().characters.some((entry) => entry.id === characterId)) return;
            updateState({ selectedCharacterId: characterId });
        },
        updateCharacterRoute(route) {
            const state = store.getState();
            const character = state.characters.find((entry) => entry.id === state.selectedCharacterId) || state.characters[0];
            if (!character) {
                showToast('正文里还没有可配置的说话人');
                return;
            }
            providerCenter.setCharacterRoute(character, route);
            const nextSettings = bridge.getSettings();
            updateState({
                settings: { ...nextSettings },
                providerSnapshot: providerCenter.snapshot(),
                characters: bridge.getCharacterDirectory(nextSettings),
            });
            showToast(character.name + ' 的专属声线已保存');
        },
        updateSetting(key, value) {
            const nextSettings = bridge.updateSettings({ [key]: value });
            updateState({
                settings: { ...nextSettings },
                ...(key === 'ttsFallbackProvider' ? { providerSnapshot: providerCenter.snapshot() } : {}),
                generationProfiles: bridge.getGenerationProfiles(),
                generationTarget: bridge.getGenerationTarget(nextSettings),
            });
            inlinePlayers.updateSettings(nextSettings);
            if (key === 'autoDecorateMessages' && value) inlinePlayers.decorateAll();
            if (key === 'sourceLanguage' && nextSettings.autoDecorateMessages) {
                inlinePlayers.reset();
                window.setTimeout(() => inlinePlayers.decorateAll(), 0);
            }
            if (key === 'injectContinuity') persistPhoneState();
            if (['bodyPromptEnabled', 'sourceLanguage', 'targetLanguage'].includes(key)) bridge.updateBodyPromptInjection();
        },
        async saveCustomKey(value) {
            try {
                await bridge.saveCustomOpenAIKey(value);
                showToast('API 密钥已保存到酒馆安全密钥槽');
                updateState({ customModelStatus: '密钥已安全保存，可以拉取模型' });
                return true;
            } catch (error) {
                console.error('[Phonie] Could not save custom OpenAI key.', error);
                showToast(error?.message || 'API 密钥保存失败');
                return false;
            }
        },
        async refreshCustomModels(endpoint) {
            const value = String(endpoint || store.getState().settings.customOpenAIEndpoint || '').trim();
            updateState({ customModelStatus: '正在连接接口并拉取模型…' });
            try {
                const models = await bridge.refreshCustomOpenAIModels(value);
                if (!models.length) throw new Error('接口连接成功，但没有返回可用模型');
                const current = store.getState().settings.customOpenAIModel;
                const nextSettings = bridge.updateSettings({
                    generationMode: 'custom',
                    customOpenAIEndpoint: value,
                    customOpenAIModels: models,
                    customOpenAIModel: models.includes(current) ? current : models[0],
                });
                updateState({
                    settings: { ...nextSettings },
                    generationTarget: bridge.getGenerationTarget(nextSettings),
                    customModelStatus: `连接成功，共 ${models.length} 个模型`,
                });
                showToast(`已拉取 ${models.length} 个模型`);
            } catch (error) {
                console.error('[Phonie] Could not refresh custom OpenAI models.', error);
                updateState({ customModelStatus: error?.message || '连接失败，请检查地址和密钥' });
                showToast(error?.message || '自定义模型连接失败');
            }
        },
        updatePromptPreset(kind, promptPreset) {
            const key = kind === 'body' ? 'bodyPromptPreset' : 'promptPreset';
            const nextSettings = bridge.updateSettings({ [key]: promptPreset });
            updateState({ settings: { ...nextSettings } });
            if (kind === 'body') bridge.updateBodyPromptInjection();
        },
        savePromptPreset(kind, promptPreset, asNew = false) {
            const settings = store.getState().settings;
            const saved = savePromptPresetToLibrary(settings.promptPresetLibraries, kind, promptPreset, { asNew });
            const key = kind === 'body' ? 'bodyPromptPreset' : 'promptPreset';
            const nextSettings = bridge.updateSettings({
                promptPresetLibraries: saved.library,
                [key]: saved.preset,
            });
            updateState({ settings: { ...nextSettings } });
            if (kind === 'body') bridge.updateBodyPromptInjection();
            showToast(asNew ? '已另存为新预设' : '当前预设已保存');
            return saved.preset;
        },
        applyPromptPreset(kind, presetId) {
            const settings = store.getState().settings;
            const preset = settings.promptPresetLibraries?.[kind]?.find((entry) => entry.id === presetId);
            if (!preset) return;
            const key = kind === 'body' ? 'bodyPromptPreset' : 'promptPreset';
            const nextSettings = bridge.updateSettings({ [key]: preset });
            updateState({ settings: { ...nextSettings } });
            if (kind === 'body') bridge.updateBodyPromptInjection();
            showToast('预设已应用');
        },
        deletePromptPreset(kind, presetId) {
            const settings = store.getState().settings;
            const fallback = kind === 'body' ? DEFAULT_BODY_PROMPT_PRESET : DEFAULT_PHONE_PROMPT_PRESET;
            const library = removePromptPreset(settings.promptPresetLibraries, kind, presetId, fallback);
            const nextPreset = library[kind][0];
            const key = kind === 'body' ? 'bodyPromptPreset' : 'promptPreset';
            const nextSettings = bridge.updateSettings({ promptPresetLibraries: library, [key]: nextPreset });
            updateState({ settings: { ...nextSettings } });
            if (kind === 'body') bridge.updateBodyPromptInjection();
            showToast('预设已删除');
        },
        importPromptPresets(payload) {
            try {
                const settings = store.getState().settings;
                const imported = importPromptPresetLibrary(payload, {
                    body: settings.bodyPromptPreset || DEFAULT_BODY_PROMPT_PRESET,
                    phone: settings.promptPreset || DEFAULT_PHONE_PROMPT_PRESET,
                });
                const library = Object.fromEntries(['body', 'phone'].map((kind) => {
                    const merged = [...(settings.promptPresetLibraries?.[kind] || []), ...(imported[kind] || [])];
                    return [kind, [...new Map(merged.map((preset) => [preset.id, preset])).values()]];
                }));
                const nextSettings = bridge.updateSettings({ promptPresetLibraries: library });
                updateState({ settings: { ...nextSettings } });
                showToast('提示词预设已导入');
                return true;
            } catch (error) {
                showToast(error?.message || '提示词预设导入失败');
                return false;
            }
        },
        recallPhoneMessage(messageId) {
            const state = store.getState();
            const messages = state.messages.map((message) => {
                if (message.id === messageId) return markPhoneMessageRecalled(message);
                if (message.replyToId === messageId && message.replySnapshot) {
                    return { ...message, replySnapshot: { ...message.replySnapshot, content: '原消息已撤回' } };
                }
                return message;
            });
            const pendingUserMessageIds = state.pendingUserMessageIds.filter((id) => id !== messageId);
            updateState({ messages, pendingUserMessageIds });
            persistPhoneState(messages, state.calls, pendingUserMessageIds);
            showToast('消息已撤回');
        },
        updateDock({ dockSide, dockY }) {
            const nextSettings = bridge.updateSettings({ dockSide, dockY });
            updateState({ settings: { ...nextSettings } });
        },
        async clearCache() {
            updateState({ cacheBusy: true });
            await audioCache.clear();
            await refreshAudioCacheStats();
            updateState({ cacheBusy: false });
            showToast('音频缓存已清除');
        },
        clearToast() {
            updateState({ toast: null });
        },
    };

    const view = new PhoneView({ store, actions });
    const inlinePlayers = new InlinePlayerManager({
        bridge,
        settings,
        cache: audioCache,
        audioFocus,
        providerCenter,
    });

    providerCenter.subscribe((providerSnapshot) => {
        updateState({
            providerSnapshot,
            providerLabel: providerCenter.getActiveLabel(),
            settings: { ...bridge.getSettings() },
        });
    });

    callMachine.subscribe(({ state, startedAt }) => {
        updateState({ callState: state, callStartedAt: startedAt });
    });

    audioFocus.subscribe((detail) => {
        if (detail.state === 'progress') return;
        const currentId = detail.current?.messageId;
        const messages = store.getState().messages.map((message) => ({
            ...message,
            isPlaying: message.id === currentId && detail.state === 'playing',
            durationLabel: message.id === currentId && detail.duration
                ? `${Math.floor(detail.duration / 60).toString().padStart(2, '0')}:${Math.floor(detail.duration % 60).toString().padStart(2, '0')}`
                : message.durationLabel,
        }));
        updateState({
            messages,
            audioState: detail.state === 'playing'
                ? 'speaking'
                : ['paused', 'ended', 'stopped', 'error'].includes(detail.state)
                    ? 'idle'
                    : store.getState().audioState,
        });
        if (detail.state === 'ended' && callMachine.state === CALL_STATES.SPEAKING) {
            callMachine.transition(CALL_STATES.CONNECTED);
        }
    });

    bridge.on(bridge.events.CHARACTER_MESSAGE_RENDERED, (messageId) => {
        window.setTimeout(() => inlinePlayers.decorateMessage(messageId), 0);
    });
    for (const eventName of [bridge.events.MESSAGE_SWIPED, bridge.events.MESSAGE_UPDATED, bridge.events.MESSAGE_EDITED]) {
        bridge.on(eventName, (messageId) => window.setTimeout(() => inlinePlayers.decorateMessage(messageId), 0));
    }
    bridge.on(bridge.events.MESSAGE_DELETED, () => {
        window.setTimeout(() => {
            inlinePlayers.reset();
            inlinePlayers.decorateAll();
        }, 0);
    });
    bridge.on(bridge.events.CHAT_CHANGED, () => {
        window.clearTimeout(callConnectTimer);
        providerCenter.cancel();
        audioFocus.stop();
        if (![CALL_STATES.IDLE, CALL_STATES.ENDED].includes(callMachine.state) && callMachine.canTransition(CALL_STATES.ENDED)) {
            callMachine.transition(CALL_STATES.ENDED);
        }
        if (callMachine.canTransition(CALL_STATES.IDLE)) callMachine.transition(CALL_STATES.IDLE);
        const nextMetadata = bridge.getPhoneMetadata();
        const nextSettings = bridge.getSettings();
        const nextContact = bridge.getContact();
        inlinePlayers.reset();
        inlinePlayers.updateSettings(nextSettings);
        updateState({
            contact: nextContact,
            userName: bridge.getUserName(),
            characters: bridge.getCharacterDirectory(nextSettings),
            selectedCharacterId: bridge.getCharacterDirectory(nextSettings)[0]?.id || '',
            selectedProviderId: nextSettings.ttsActiveProvider,
            messages: nextMetadata.messages,
            calls: nextMetadata.calls,
            pendingUserMessageIds: nextMetadata.pendingUserMessageIds,
            settings: { ...nextSettings },
            providerLabel: providerCenter.getActiveLabel(),
            providerSnapshot: providerCenter.snapshot(),
            generationProfiles: bridge.getGenerationProfiles(),
            generationTarget: bridge.getGenerationTarget(nextSettings),
            customModelStatus: '',
            generating: false,
            callDirection: null,
            callCaption: { source: '', translation: '' },
            callControls: { muted: false, speaker: false, captions: true },
            audioState: 'idle',
            unread: 0,
        });
        bridge.updateContinuityPrompt(nextMetadata);
        bridge.updateBodyPromptInjection();
        window.setTimeout(() => inlinePlayers.decorateAll(), 0);
    });
    for (const eventName of [bridge.events.CHAT_LOADED, bridge.events.SETTINGS_LOADED_AFTER, bridge.events.APP_READY].filter(Boolean)) {
        bridge.on(eventName, () => bridge.updateBodyPromptInjection());
    }
    if (bridge.events.GENERATION_AFTER_COMMANDS) {
        bridge.on(bridge.events.GENERATION_AFTER_COMMANDS, (type) => bridge.updateBodyPromptInjection(type));
    }

    view.mount();
    deviceMonitor.start();
    refreshAudioCacheStats();
    bridge.updateContinuityPrompt(metadata);
    bridge.updateBodyPromptInjection();
    window.setTimeout(() => inlinePlayers.decorateAll(), 0);

    const app = {
        version: APP_VERSION,
        store,
        bridge,
        view,
        inlinePlayers,
        providerCenter,
        dispose() {
            window.clearTimeout(callConnectTimer);
            bridge.dispose();
            providerCenter.dispose();
            deviceMonitor.dispose();
            inlinePlayers.dispose();
            audioFocus.dispose();
            view.dispose();
            delete globalThis.__phonieApp;
        },
    };
    globalThis.__phonieApp = app;
    console.info('[Phonie] Voice phone initialized.');
    return app;
}
