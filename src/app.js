import { APP_VERSION, CALL_STATES, MESSAGE_KINDS, SCREENS } from './core/constants.js';
import { createStore } from './core/store.js';
import { SillyTavernBridge } from './integrations/sillytavern.js';
import { CallMachine } from './phone/call-machine.js';
import { createCallRecord, createPhoneMessage } from './phone/chat-records.js';
import { AudioCache, makeAudioCacheKey } from './storage/audio-cache.js';
import { AudioFocusController } from './tts/audio-focus.js';
import { InlinePlayerManager } from './ui/inline-player.js';
import { PhoneView } from './ui/phone-view.js';

function normalizeSpeechText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildCallSummary(messages, contactName) {
    const lines = messages.slice(-6).map((message) => {
        const speaker = message.direction === 'outgoing' ? 'User' : contactName;
        return `${speaker}: ${String(message.originalText || '').replace(/\s+/g, ' ').slice(0, 180)}`;
    });
    return lines.join(' / ').slice(0, 900);
}

export async function createPhonieApp() {
    const existing = globalThis.__phonieApp;
    if (existing?.version === APP_VERSION && document.getElementById('phonie-root')) return existing;
    if (existing?.dispose) {
        try {
            existing.dispose();
        } catch (error) {
            console.debug('[Phonie] Previous runtime cleanup failed; rebuilding the interface.', error);
        }
    }
    document.getElementById('phonie-root')?.remove();
    document.getElementById('phonie-settings-launcher')?.remove();
    document.getElementById('phonie-wand-menu-item')?.remove();

    const bridge = new SillyTavernBridge();
    const settings = bridge.getSettings();
    const metadata = bridge.getPhoneMetadata();
    const callMachine = new CallMachine();
    const audioCache = new AudioCache();
    const audioFocus = new AudioFocusController();
    const pendingPhoneSpeech = [];
    let coreAudioElement = null;
    let coreAudioContext = null;
    let callConnectTimer = null;

    const store = createStore({
        open: false,
        screen: SCREENS.HOME,
        settings: { ...settings },
        contact: bridge.getContact(),
        messages: metadata.messages,
        calls: metadata.calls,
        providerLabel: bridge.getProviderLabel(),
        generationProfiles: bridge.getGenerationProfiles(),
        generationTarget: bridge.getGenerationTarget(settings),
        customModelStatus: '',
        generating: false,
        callState: CALL_STATES.IDLE,
        callStartedAt: null,
        callCaption: { source: '', translation: '' },
        audioState: 'idle',
        unread: 0,
        toast: null,
    });

    function updateState(patch) {
        store.setState((state) => ({ ...state, ...patch }));
    }

    function showToast(text) {
        updateState({ toast: { id: Date.now(), text } });
    }

    function persistPhoneState(messages = store.getState().messages, calls = store.getState().calls) {
        const nextMetadata = { schemaVersion: 1, messages, calls };
        bridge.savePhoneMetadata(nextMetadata);
        bridge.updateContinuityPrompt(nextMetadata);
    }

    async function preparePhoneAudio(message, voiceName, { autoplay = true } = {}) {
        const key = message.audioCacheKey || makeAudioCacheKey({
            chatId: bridge.getChatId(),
            messageId: message.id,
            text: message.originalText,
            provider: bridge.getProviderLabel(),
        });
        message.audioCacheKey = key;

        let source = audioFocus.getSource(`phone:${message.id}`);
        if (!source) source = await audioCache.get(key);
        if (source) {
            audioFocus.setSource(`phone:${message.id}`, source);
            if (autoplay) {
                bridge.stopSpeech();
                try {
                    await audioFocus.play(`phone:${message.id}`, { owner: 'phone', messageId: message.id });
                } catch (error) {
                    console.warn('[Phonie] Browser blocked cached audio autoplay.', error);
                }
            }
            return true;
        }

        const pending = {
            messageId: message.id,
            text: normalizeSpeechText(message.originalText),
            cacheKey: key,
        };
        pendingPhoneSpeech.push(pending);
        try {
            await bridge.speakText(message.originalText, voiceName);
        } catch (error) {
            const index = pendingPhoneSpeech.indexOf(pending);
            if (index >= 0) pendingPhoneSpeech.splice(index, 1);
            throw error;
        }
        return false;
    }

    async function sendMessage(text, kind, callMode) {
        const state = store.getState();
        if (state.generating) {
            showToast('上一条回复仍在生成');
            return;
        }
        if (callMode && ![CALL_STATES.CONNECTED, CALL_STATES.SPEAKING].includes(state.callState)) {
            showToast('请先接通电话');
            return;
        }
        const originChatId = bridge.getChatId();
        if (callMode && state.callState === CALL_STATES.SPEAKING) {
            bridge.stopSpeech();
            audioFocus.stop();
        }

        const outgoing = createPhoneMessage({
            direction: 'outgoing',
            author: bridge.getUserName(),
            originalText: text,
            kind,
        });
        const withOutgoing = [...state.messages, outgoing];
        updateState({ messages: withOutgoing, generating: true, audioState: 'generating' });
        persistPhoneState(withOutgoing, state.calls);

        if (callMode && callMachine.state === CALL_STATES.SPEAKING) {
            callMachine.transition(CALL_STATES.GENERATING);
        } else if (callMode && callMachine.state === CALL_STATES.CONNECTED) {
            callMachine.transition(CALL_STATES.GENERATING);
        }

        if (kind === MESSAGE_KINDS.VOICE) {
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
            updateState({
                messages,
                generating: false,
                callCaption: callMode
                    ? { source: incoming.originalText, translation: incoming.translationText }
                    : store.getState().callCaption,
                unread: store.getState().open ? 0 : store.getState().unread + 1,
            });
            persistPhoneState(messages, store.getState().calls);

            const shouldSpeak = callMode || currentSettings.autoPlayPhoneReplies;
            if (shouldSpeak) {
                if (callMode && callMachine.state === CALL_STATES.GENERATING) {
                    callMachine.transition(CALL_STATES.SPEAKING);
                }
                try {
                    await preparePhoneAudio(incoming, store.getState().contact.name, { autoplay: true });
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
            callCaption: { source: '', translation: '' },
        });
        callConnectTimer = window.setTimeout(() => {
            if (callMachine.state === CALL_STATES.DIALING) {
                callMachine.transition(CALL_STATES.CONNECTED);
            }
        }, 520);
    }

    function endCall() {
        window.clearTimeout(callConnectTimer);
        bridge.stopSpeech();
        audioFocus.stop();
        const state = store.getState();
        const startedAt = callMachine.startedAt;
        if ([CALL_STATES.IDLE, CALL_STATES.ENDED].includes(callMachine.state)) return;
        if (callMachine.canTransition(CALL_STATES.ENDED)) {
            callMachine.transition(CALL_STATES.ENDED);
        }
        if (startedAt) {
            const record = createCallRecord({
                contactName: state.contact.name,
                startedAt,
                endedAt: Date.now(),
                summary: buildCallSummary(state.messages, state.contact.name),
            });
            const calls = [...state.calls, record];
            updateState({ calls, generating: false, audioState: 'idle' });
            persistPhoneState(state.messages, calls);
        }
    }

    async function playPhoneAudio(messageId) {
        const message = store.getState().messages.find((entry) => entry.id === messageId);
        if (!message) return;
        try {
            await preparePhoneAudio(message, message.author, { autoplay: true });
        } catch (error) {
            console.error('[Phonie] Could not play phone audio.', error);
            showToast('这条语音暂时无法播放');
        }
    }

    const actions = {
        open() {
            const currentSettings = bridge.getSettings();
            updateState({
                open: true,
                unread: 0,
                settings: { ...currentSettings },
                providerLabel: bridge.getProviderLabel(),
                generationProfiles: bridge.getGenerationProfiles(),
                generationTarget: bridge.getGenerationTarget(currentSettings),
            });
        },
        close() {
            updateState({ open: false });
        },
        navigate(screen) {
            if (!Object.values(SCREENS).includes(screen)) return;
            updateState({ screen });
        },
        sendMessage,
        startCall,
        endCall,
        playPhoneAudio,
        updateSetting(key, value) {
            const nextSettings = bridge.updateSettings({ [key]: value });
            updateState({
                settings: { ...nextSettings },
                generationProfiles: bridge.getGenerationProfiles(),
                generationTarget: bridge.getGenerationTarget(nextSettings),
            });
            inlinePlayers.updateSettings(nextSettings);
            if (key === 'autoDecorateMessages' && value) inlinePlayers.decorateAll();
            if (key === 'injectContinuity') persistPhoneState();
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
        updatePromptPreset(promptPreset) {
            const nextSettings = bridge.updateSettings({ promptPreset });
            updateState({ settings: { ...nextSettings } });
        },
        updateDock({ dockSide, dockY }) {
            const nextSettings = bridge.updateSettings({ dockSide, dockY });
            updateState({ settings: { ...nextSettings } });
        },
        async clearCache() {
            await audioCache.clear();
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

    function bindCoreAudio() {
        const element = document.getElementById('tts_audio');
        if (!(element instanceof HTMLAudioElement) || element === coreAudioElement) return;
        coreAudioElement = element;
        element.addEventListener('play', () => {
            updateState({ audioState: 'speaking' });
            if (coreAudioContext?.messageId != null) inlinePlayers.setCorePlaying(coreAudioContext.messageId, true);
        });
        const onStopped = () => {
            updateState({ audioState: 'idle' });
            if (coreAudioContext?.messageId != null) inlinePlayers.setCorePlaying(coreAudioContext.messageId, false);
            if (coreAudioContext?.phoneMessageId) {
                const messages = store.getState().messages.map((message) => ({
                    ...message,
                    isPlaying: false,
                }));
                updateState({ messages });
            }
            coreAudioContext = null;
            if (callMachine.state === CALL_STATES.SPEAKING) {
                callMachine.transition(CALL_STATES.CONNECTED);
            }
        };
        element.addEventListener('ended', onStopped);
        element.addEventListener('pause', () => {
            if (!element.ended && element.currentTime > 0) onStopped();
        });
    }

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
        pendingPhoneSpeech.splice(0);
        audioFocus.stop();
        if (![CALL_STATES.IDLE, CALL_STATES.ENDED].includes(callMachine.state) && callMachine.canTransition(CALL_STATES.ENDED)) {
            callMachine.transition(CALL_STATES.ENDED);
        }
        if (callMachine.canTransition(CALL_STATES.IDLE)) callMachine.transition(CALL_STATES.IDLE);
        const nextMetadata = bridge.getPhoneMetadata();
        const nextSettings = bridge.getSettings();
        inlinePlayers.reset();
        inlinePlayers.updateSettings(nextSettings);
        updateState({
            contact: bridge.getContact(),
            messages: nextMetadata.messages,
            calls: nextMetadata.calls,
            settings: { ...nextSettings },
            providerLabel: bridge.getProviderLabel(),
            generationProfiles: bridge.getGenerationProfiles(),
            generationTarget: bridge.getGenerationTarget(nextSettings),
            customModelStatus: '',
            generating: false,
            callCaption: { source: '', translation: '' },
            audioState: 'idle',
            unread: 0,
        });
        bridge.updateContinuityPrompt(nextMetadata);
        window.setTimeout(() => inlinePlayers.decorateAll(), 0);
    });
    bridge.on(bridge.events.TTS_JOB_STARTED, (event) => {
        coreAudioContext = { messageId: event?.messageId ?? null, phoneMessageId: null };
        updateState({ audioState: 'generating' });
    });
    bridge.on(bridge.events.TTS_AUDIO_READY, async (event) => {
        updateState({ audioState: 'speaking' });
        if (event?.messageId != null) {
            coreAudioContext = { messageId: Number(event.messageId), phoneMessageId: null };
            await inlinePlayers.handleAudioReady(event);
        } else {
            const text = normalizeSpeechText(event?.text);
            const pendingIndex = pendingPhoneSpeech.findIndex((pending) => pending.text === text || pending.text.includes(text) || text.includes(pending.text));
            const pending = pendingIndex >= 0 ? pendingPhoneSpeech.splice(pendingIndex, 1)[0] : pendingPhoneSpeech.shift();
            if (pending && (event.audio instanceof Blob || typeof event.audio === 'string')) {
                audioFocus.setSource(`phone:${pending.messageId}`, event.audio);
                if (event.audio instanceof Blob) await audioCache.put(pending.cacheKey, event.audio);
                coreAudioContext = { messageId: null, phoneMessageId: pending.messageId };
                const messages = store.getState().messages.map((message) => ({
                    ...message,
                    isPlaying: message.id === pending.messageId,
                }));
                updateState({ messages });
                persistPhoneState(messages, store.getState().calls);
            }
        }
        window.setTimeout(bindCoreAudio, 0);
    });

    view.mount();
    bridge.updateContinuityPrompt(metadata);
    window.setTimeout(() => {
        bindCoreAudio();
        inlinePlayers.decorateAll();
    }, 0);

    const app = {
        version: APP_VERSION,
        store,
        bridge,
        view,
        inlinePlayers,
        dispose() {
            window.clearTimeout(callConnectTimer);
            bridge.dispose();
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
