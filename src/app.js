import { APP_VERSION, CALL_STATES, MESSAGE_KINDS, SCHEMA_VERSION, SCREENS, THEMES } from './core/constants.js';
import { createStore } from './core/store.js';
import { createDeviceStatusSnapshot, DeviceStatusMonitor } from './device/device-status.js';
import { DEFAULT_BODY_PROMPT_PRESET } from './dialogue/body-speech.js';
import {
    DEFAULT_CALL_PROMPT_PRESET,
    DEFAULT_CHAT_PROMPT_PRESET,
    DEFAULT_GROUP_CALL_PROMPT_PRESET,
    importPromptPresetLibrary,
    removePromptPreset,
    savePromptPreset as savePromptPresetToLibrary,
} from './dialogue/prompt-preset.js';
import { SillyTavernBridge } from './integrations/sillytavern.js';
import { CallMachine } from './phone/call-machine.js';
import {
    createCallRecord,
    createConversation,
    createConversationId,
    createPhoneMessage,
    recallPhoneMessage as markPhoneMessageRecalled,
} from './phone/chat-records.js';
import { AudioCache, makeAudioCacheKey } from './storage/audio-cache.js';
import { AudioFocusController } from './tts/audio-focus.js';
import { PhonieProviderCenter } from './tts/provider-center.js';
import { InlinePlayerManager } from './ui/inline-player.js';
import { PhoneView } from './ui/phone-view.js';
import { downloadAudioSource } from './ui/audio-action-menu.js';

function buildCallSummary(messages, contactName) {
    const lines = messages.slice(-6).map((message) => {
        const speaker = message.direction === 'outgoing' ? 'User' : contactName;
        return `${speaker}: ${String(message.originalText || '').replace(/\s+/g, ' ').slice(0, 180)}`;
    });
    return lines.join(' / ').slice(0, 900);
}

function buildCallTitle(value, fallback = '一通电话') {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return fallback;
    const first = text.split(/[。！？!?/]/u).find(Boolean) || text;
    return first.slice(0, 24);
}

function promptSettingKey(kind) {
    if (kind === 'body') return 'bodyPromptPreset';
    if (kind === 'call' || kind === 'call_single') return 'callPromptPreset';
    if (kind === 'call_group') return 'groupCallPromptPreset';
    return 'chatPromptPreset';
}

function defaultPromptForKind(kind) {
    if (kind === 'body') return DEFAULT_BODY_PROMPT_PRESET;
    if (kind === 'call' || kind === 'call_single') return DEFAULT_CALL_PROMPT_PRESET;
    if (kind === 'call_group') return DEFAULT_GROUP_CALL_PROMPT_PRESET;
    return DEFAULT_CHAT_PROMPT_PRESET;
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
    const initialConversationId = createConversationId([contact]);
    const initialConversation = metadata.conversations?.[initialConversationId];
    const initialMessages = initialConversation?.messages || metadata.messages;
    const initialPending = initialConversation?.pendingUserMessageIds || metadata.pendingUserMessageIds;
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
        messages: initialMessages,
        calls: metadata.calls,
        pendingUserMessageIds: initialPending,
        conversations: metadata.conversations || {},
        activeConversationId: initialConversationId,
        providerLabel: providerCenter.getActiveLabel(),
        providerSnapshot: providerCenter.snapshot(),
        deviceStatus: createDeviceStatusSnapshot(),
        generationTarget: bridge.getGenerationTarget(settings),
        customModelStatus: '',
        generating: false,
        callState: CALL_STATES.IDLE,
        callDirection: null,
        callStartedAt: null,
        callCaption: { source: '', translation: '' },
        callParticipants: [contact],
        chatParticipants: [contact],
        callSpeaker: '',
        callTopic: '',
        callStrategy: 'context',
        callLength: settings.callLength,
        callNumber: '',
        callScriptQueue: [],
        callScriptIndex: -1,
        callPreparationLabel: '',
        callTitle: '',
        callSummary: '',
        callReplayMode: false,
        audioState: 'idle',
        audioCacheStats: { count: 0, bytes: 0 },
        cacheBusy: false,
        novelImage: '',
        novelBusy: false,
        novelTagBusy: false,
        novelStatus: '待命',
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

    function setMessageAudioStatus(messageId, audioStatus) {
        const messages = store.getState().messages.map((message) => (
            message.id === messageId ? { ...message, audioStatus } : message
        ));
        updateState({ messages });
    }

    function persistPhoneState(
        messages = store.getState().messages,
        calls = store.getState().calls,
        pendingUserMessageIds = store.getState().pendingUserMessageIds,
    ) {
        const state = store.getState();
        const participants = state.chatParticipants?.length ? state.chatParticipants : [state.contact];
        const activeConversationId = state.activeConversationId || createConversationId(participants);
        const conversation = createConversation({
            ...(state.conversations?.[activeConversationId] || {}),
            id: activeConversationId,
            participantIds: participants.map((entry) => entry.id),
            title: participants.length > 1 ? participants.map((entry) => entry.name).join('、') : participants[0]?.name,
            messages,
            pendingUserMessageIds,
            updatedAt: Date.now(),
        });
        const conversations = { ...(state.conversations || {}), [activeConversationId]: conversation };
        updateState({ conversations, activeConversationId });
        const nextMetadata = {
            schemaVersion: SCHEMA_VERSION,
            messages,
            calls,
            pendingUserMessageIds,
            conversations,
            activeConversationId,
        };
        bridge.savePhoneMetadata(nextMetadata);
        bridge.updateContinuityPrompt(nextMetadata);
    }

    function openConversation(participants) {
        const safeParticipants = (participants || []).filter(Boolean);
        if (!safeParticipants.length) return;
        persistPhoneState();
        const state = store.getState();
        const activeConversationId = createConversationId(safeParticipants);
        const saved = state.conversations?.[activeConversationId];
        updateState({
            chatParticipants: safeParticipants,
            selectedCharacterId: safeParticipants[0]?.id || state.selectedCharacterId,
            activeConversationId,
            messages: saved?.messages || [],
            pendingUserMessageIds: saved?.pendingUserMessageIds || [],
            screen: SCREENS.CHAT,
            open: true,
        });
    }

    async function preparePhoneAudio(message, voiceName, { autoplay = true, rateLimited = false, force = false } = {}) {
        const currentRouteKey = makeAudioCacheKey({
            chatId: bridge.getChatId(),
            messageId: message.id,
            text: message.originalText,
            provider: providerCenter.getCacheSignature(voiceName),
        });
        const key = force ? currentRouteKey : (message.audioCacheKey || currentRouteKey);
        message.audioCacheKey = key;

        if (force) {
            audioFocus.deleteSource(`phone:${message.id}`);
            await audioCache.delete(key);
        }

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

        setMessageAudioStatus(message.id, 'generating');
        let result;
        try {
            result = await providerCenter.synthesize({
                text: message.originalText,
                speaker: voiceName,
                emotion: message.emotion,
                language: message.language || store.getState().settings.sourceLanguage,
                rateLimited,
            });
        } catch (error) {
            setMessageAudioStatus(message.id, 'error');
            throw error;
        }
        audioFocus.setSource(`phone:${message.id}`, result.blob);
        await audioCache.put(key, result.blob);
        refreshAudioCacheStats();
        if (autoplay) {
            await audioFocus.play(`phone:${message.id}`, { owner: 'phone', messageId: message.id });
        } else {
            setMessageAudioStatus(message.id, 'idle');
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
                channel: callMode ? 'call' : 'chat',
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
            const reply = await bridge.generatePhoneReply({
                history: withOutgoing,
                callMode,
                participants: callMode ? state.callParticipants : state.chatParticipants,
                topic: state.callTopic,
                strategy: state.callStrategy,
            });
            if (bridge.getChatId() !== originChatId) return;
            const currentSettings = store.getState().settings;
            const currentState = store.getState();
            const activeParticipants = callMode ? currentState.callParticipants : currentState.chatParticipants;
            const participantNames = new Set((activeParticipants || []).map((entry) => entry.name).filter(Boolean));
            const fallbackAuthor = activeParticipants?.[0]?.name || currentState.contact.name;
            const replyTurns = !callMode && Array.isArray(reply.turns) && reply.turns.length
                ? reply.turns.slice(0, 8)
                : [reply];
            const incomingMessages = replyTurns.map((turn) => createPhoneMessage({
                direction: 'incoming',
                author: participantNames.has(turn.speaker) ? turn.speaker : fallbackAuthor,
                originalText: turn.originalText,
                translationText: turn.translationText,
                kind: callMode || currentSettings.autoPlayPhoneReplies ? MESSAGE_KINDS.VOICE : MESSAGE_KINDS.TEXT,
                emotion: turn.emotion,
                channel: callMode ? 'call' : 'chat',
            }));
            const incoming = incomingMessages[0];
            const messages = [...currentState.messages, ...incomingMessages];
            const nextPending = callMode ? store.getState().pendingUserMessageIds : [];
            updateState({
                messages,
                pendingUserMessageIds: nextPending,
                generating: false,
                callCaption: callMode
                    ? { source: incoming.originalText, translation: incoming.translationText }
                    : store.getState().callCaption,
                unread: store.getState().open ? 0 : store.getState().unread + incomingMessages.length,
            });
            persistPhoneState(messages, store.getState().calls, nextPending);

            const shouldSpeak = callMode || currentSettings.autoPlayPhoneReplies;
            if (shouldSpeak) {
                if (callMode && callMachine.state === CALL_STATES.GENERATING) {
                    callMachine.transition(CALL_STATES.SPEAKING);
                }
                try {
                    await preparePhoneAudio(incoming, incoming.author, { autoplay: true });
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

    async function playCallScriptAt(index) {
        const state = store.getState();
        const messageId = state.callScriptQueue?.[index];
        const message = state.messages.find((entry) => entry.id === messageId);
        if (!message) return false;
        updateState({
            callScriptIndex: index,
            callCaption: { source: message.originalText, translation: message.translationText },
            callSpeaker: message.author,
        });
        if ([CALL_STATES.CONNECTED, CALL_STATES.GENERATING].includes(callMachine.state)) {
            callMachine.transition(CALL_STATES.SPEAKING);
        }
        await preparePhoneAudio(message, message.author, { autoplay: true });
        return true;
    }

    async function generatePreparedCall() {
        if (callMachine.state !== CALL_STATES.CONNECTED) return;
        updateState({
            generating: true,
            audioState: 'generating',
            callPreparationLabel: '正在编排完整电话',
            callScriptQueue: [],
            callScriptIndex: -1,
        });
        callMachine.transition(CALL_STATES.GENERATING);
        try {
            const call = store.getState();
            const reply = await bridge.generatePhoneReply({
                history: call.messages,
                callMode: true,
                scriptMode: true,
                participants: call.callParticipants,
                topic: call.callTopic,
                strategy: call.callStrategy,
                callLength: call.callLength,
            });
            const fallbackSpeaker = call.callParticipants?.[0]?.name || call.contact.name;
            const turns = reply.turns?.length ? reply.turns : [reply];
            const prepared = turns.map((turn) => createPhoneMessage({
                direction: 'incoming',
                author: turn.speaker || fallbackSpeaker,
                originalText: turn.originalText,
                translationText: turn.translationText,
                kind: MESSAGE_KINDS.VOICE,
                emotion: turn.emotion,
                channel: 'call',
            }));
            const messages = [...store.getState().messages, ...prepared];
            const queue = prepared.map((message) => message.id);
            updateState({
                messages,
                callScriptQueue: queue,
                callTitle: buildCallTitle(reply.title || reply.summary, `${fallbackSpeaker}来电`),
                callSummary: String(reply.summary || '').trim(),
                callPreparationLabel: `正在准备语音 0/${prepared.length}`,
            });
            persistPhoneState(messages, store.getState().calls);
            for (let index = 0; index < prepared.length; index += 1) {
                updateState({ callPreparationLabel: `正在准备语音 ${index + 1}/${prepared.length}` });
                await preparePhoneAudio(prepared[index], prepared[index].author, { autoplay: false, rateLimited: true });
            }
            updateState({ generating: false, callPreparationLabel: '' });
            await playCallScriptAt(0);
        } catch (error) {
            console.error('[Phonie] Prepared call failed.', error);
            updateState({ generating: false, audioState: 'idle', callPreparationLabel: '', callScriptQueue: [] });
            if ([CALL_STATES.GENERATING, CALL_STATES.SPEAKING].includes(callMachine.state)) {
                callMachine.transition(CALL_STATES.CONNECTED);
            }
            showToast('电话内容准备失败，请检查模型与语音引擎');
        }
    }

    function startCall(options = {}) {
        const state = store.getState();
        if ([CALL_STATES.DIALING, CALL_STATES.RINGING, CALL_STATES.CONNECTED, CALL_STATES.GENERATING, CALL_STATES.SPEAKING].includes(callMachine.state)) {
            updateState({ screen: SCREENS.CALL, open: true });
            return;
        }
        const selected = (state.characters || []).filter((entry) => options.participantIds?.includes(entry.id));
        const callParticipants = selected.length ? selected : [state.contact];
        window.clearTimeout(callConnectTimer);
        callMachine.transition(CALL_STATES.DIALING, { contact: state.contact.name });
        updateState({
            open: true,
            screen: SCREENS.CALL,
            callDirection: 'outgoing',
            callCaption: { source: '', translation: '' },
            callParticipants,
            callTopic: String(options.topic || ''),
            callStrategy: options.strategy === 'topic' ? 'topic' : 'context',
            callLength: ['short', 'normal', 'long'].includes(options.callLength) ? options.callLength : state.settings.callLength,
            callNumber: String(options.number || ''),
            callScriptQueue: [],
            callScriptIndex: -1,
            callPreparationLabel: '',
            callTitle: '',
            callSummary: '',
            callReplayMode: false,
        });
        callConnectTimer = window.setTimeout(() => {
            if (callMachine.state === CALL_STATES.DIALING) {
                callMachine.transition(CALL_STATES.RINGING);
                callConnectTimer = window.setTimeout(() => {
                    if (callMachine.state === CALL_STATES.RINGING && store.getState().callDirection === 'outgoing') {
                        callMachine.transition(CALL_STATES.CONNECTED);
                        window.setTimeout(() => generatePreparedCall(), 220);
                    }
                }, 900);
            }
        }, 420);
    }

    function startIncomingCall(options = {}) {
        if (![CALL_STATES.IDLE, CALL_STATES.ENDED].includes(callMachine.state)) return;
        const state = store.getState();
        const selected = (state.characters || []).filter((entry) => options.participantIds?.includes(entry.id));
        window.clearTimeout(callConnectTimer);
        callMachine.transition(CALL_STATES.RINGING, { contact: store.getState().contact.name, direction: 'incoming' });
        updateState({
            open: true,
            screen: SCREENS.CALL,
            callDirection: 'incoming',
            callCaption: { source: '', translation: '' },
            callParticipants: selected.length ? selected : [state.contact],
            callTopic: String(options.topic || ''),
            callStrategy: options.strategy === 'topic' ? 'topic' : 'context',
            callLength: ['short', 'normal', 'long'].includes(options.callLength) ? options.callLength : state.settings.callLength,
            callNumber: String(options.number || ''),
            callScriptQueue: [],
            callScriptIndex: -1,
            callPreparationLabel: '',
            callTitle: '',
            callSummary: '',
            callReplayMode: false,
        });
        globalThis.navigator?.vibrate?.([160, 90, 160, 360, 160, 90, 160]);
    }

    function acceptCall() {
        if (callMachine.state !== CALL_STATES.RINGING || store.getState().callDirection !== 'incoming') return;
        globalThis.navigator?.vibrate?.(0);
        callMachine.transition(CALL_STATES.CONNECTED);
        window.setTimeout(() => generatePreparedCall(), 360);
    }

    function declineCall() {
        if (callMachine.state !== CALL_STATES.RINGING) return;
        globalThis.navigator?.vibrate?.(0);
        endCall('declined');
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
        if (state.callDirection && !state.callReplayMode) {
            const endedAt = Date.now();
            const callMessages = state.callScriptQueue
                .map((id) => state.messages.find((message) => message.id === id))
                .filter(Boolean)
                .map((message) => ({ ...message, channel: 'call' }));
            const record = createCallRecord({
                contactName: state.callParticipants?.map((entry) => entry.name).join('、') || state.contact.name,
                startedAt: startedAt || endedAt,
                endedAt,
                direction: state.callDirection,
                outcome,
                title: outcome === 'declined'
                    ? '未接来电'
                    : buildCallTitle(state.callTitle || state.callSummary, `${state.callParticipants?.[0]?.name || state.contact.name}的电话`),
                summary: outcome === 'declined'
                    ? '已拒绝来电'
                    : state.callSummary || buildCallSummary(state.messages.filter((message) => message.channel === 'call'), state.callParticipants?.[0]?.name || state.contact.name),
                messageIds: state.callScriptQueue,
                messages: callMessages,
                participants: state.callParticipants,
            });
            const calls = [...state.calls, record];
            updateState({
                calls,
                generating: false,
                audioState: 'idle',
                callDirection: null,
                callScriptQueue: [],
                callScriptIndex: -1,
                callPreparationLabel: '',
                callTitle: '',
                callSummary: '',
                callSpeaker: '',
                callReplayMode: false,
            });
            persistPhoneState(state.messages, calls);
        } else {
            updateState({
                generating: false,
                audioState: 'idle',
                callDirection: null,
                callScriptQueue: [],
                callScriptIndex: -1,
                callPreparationLabel: '',
                callTitle: '',
                callSummary: '',
                callSpeaker: '',
                callReplayMode: false,
            });
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

    async function regeneratePhoneAudio(messageId) {
        const state = store.getState();
        const message = state.messages.find((entry) => entry.id === messageId);
        if (!message) return;
        const speaker = message.direction === 'incoming' ? message.author : bridge.getUserName();
        try {
            await preparePhoneAudio(message, speaker, { autoplay: true, force: true });
            persistPhoneState(store.getState().messages, store.getState().calls);
            showToast('已使用当前声线路由重新生成');
        } catch (error) {
            console.error('[Phonie] Could not regenerate phone audio.', error);
            showToast(error?.message || '重新生成语音失败');
        }
    }

    async function downloadPhoneAudio(messageId) {
        const state = store.getState();
        const message = state.messages.find((entry) => entry.id === messageId);
        if (!message) return;
        try {
            const speaker = message.direction === 'incoming' ? message.author : bridge.getUserName();
            await preparePhoneAudio(message, speaker, { autoplay: false });
            downloadAudioSource(audioFocus.getSource(`phone:${message.id}`), `${message.author || 'Phonie'}-${message.id}`);
            showToast('音频已开始下载');
        } catch (error) {
            console.error('[Phonie] Could not download phone audio.', error);
            showToast(error?.message || '音频下载失败');
        }
    }

    function replayCallRecord(callId) {
        const state = store.getState();
        const record = state.calls.find((entry) => entry.id === callId);
        const knownIds = new Set(state.messages.map((message) => message.id));
        const restored = (record?.messages || []).filter((message) => message?.id && !knownIds.has(message.id));
        const replayMessages = [...state.messages, ...restored];
        const queue = (record?.messageIds || []).filter((id) => replayMessages.some((message) => message.id === id));
        if (!record || !queue.length) {
            showToast('这条旧记录没有可重播的语音段');
            return;
        }
        if (![CALL_STATES.IDLE, CALL_STATES.ENDED].includes(callMachine.state)) endCall('interrupted');
        if (callMachine.state === CALL_STATES.ENDED) callMachine.transition(CALL_STATES.IDLE);
        const participants = (record.participants || []).map((saved) => (
            state.characters.find((entry) => entry.id === saved.id || entry.name === saved.name) || saved
        ));
        callMachine.transition(CALL_STATES.DIALING);
        updateState({
            open: true,
            screen: SCREENS.CALL,
            callDirection: record.direction || 'incoming',
            callParticipants: participants.length ? participants : [state.contact],
            messages: replayMessages,
            callScriptQueue: queue,
            callScriptIndex: -1,
            callCaption: { source: '', translation: '' },
            callPreparationLabel: '',
            callReplayMode: true,
        });
        window.setTimeout(() => {
            if (callMachine.state !== CALL_STATES.DIALING) return;
            callMachine.transition(CALL_STATES.CONNECTED);
            playCallScriptAt(0).catch((error) => {
                console.warn('[Phonie] Recorded call replay failed.', error);
                showToast('通话重播失败');
                endCall('error');
            });
        }, 260);
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
        endCall,
        playPhoneAudio,
        regeneratePhoneAudio,
        downloadPhoneAudio,
        replayCallRecord,
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
        openContactChat(characterId) {
            const character = store.getState().characters.find((entry) => entry.id === characterId);
            if (!character) return;
            openConversation([character]);
        },
        toggleChatContact(characterId) {
            const state = store.getState();
            const character = state.characters.find((entry) => entry.id === characterId);
            if (!character) return;
            const current = Array.isArray(state.chatParticipants) ? state.chatParticipants : [];
            const selected = current.some((entry) => entry.id === characterId)
                ? current.filter((entry) => entry.id !== characterId)
                : [...current.filter((entry) => state.characters.some((candidate) => candidate.id === entry.id)), character];
            updateState({ chatParticipants: selected });
        },
        clearGroupSelection() {
            updateState({ chatParticipants: [] });
        },
        openGroupChat() {
            const state = store.getState();
            const participants = (state.chatParticipants || []).filter((entry) => (
                state.characters.some((candidate) => candidate.id === entry.id)
            ));
            if (participants.length < 2) {
                showToast('请先选择至少两位联系人');
                return;
            }
            openConversation(participants);
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
        addManualCharacter(name) {
            const cleanName = String(name || '').trim();
            if (!cleanName) return;
            const id = 'speaker:' + encodeURIComponent(cleanName.toLocaleLowerCase('zh-CN'));
            providerCenter.setCharacterRoute({ id, name: cleanName }, {});
            const nextSettings = bridge.getSettings();
            const characters = bridge.getCharacterDirectory(nextSettings);
            updateState({ settings: { ...nextSettings }, characters, selectedCharacterId: id });
            showToast(cleanName + ' 已加入通讯录');
        },
        deleteCharacterRoute() {
            const state = store.getState();
            const character = state.characters.find((entry) => entry.id === state.selectedCharacterId);
            if (!character) return;
            providerCenter.deleteCharacterRoute(character);
            const nextSettings = bridge.getSettings();
            const characters = bridge.getCharacterDirectory(nextSettings);
            updateState({ settings: { ...nextSettings }, characters, selectedCharacterId: characters[0]?.id || '' });
            showToast(character.name + ' 的专属路由已删除');
        },
        updateSetting(key, value) {
            const nextSettings = bridge.updateSettings({ [key]: value });
            updateState({
                settings: { ...nextSettings },
                ...(key === 'ttsFallbackProvider' ? { providerSnapshot: providerCenter.snapshot() } : {}),
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
        async saveNovelAiToken(value) {
            try {
                await bridge.saveNovelAiToken(value);
                updateState({ novelStatus: 'Token 已安全保存' });
                showToast('NovelAI Token 已保存到酒馆安全密钥槽');
                return true;
            } catch (error) {
                showToast(error?.message || 'NovelAI Token 保存失败');
                return false;
            }
        },
        async generateNovelAiImage(payload) {
            updateState({ novelBusy: true, novelStatus: '正在生成影像…' });
            try {
                const image = await bridge.generateNovelAiImage(payload);
                updateState({ novelImage: image, novelBusy: false, novelStatus: '生成完成' });
                showToast('NovelAI 图片已生成');
                return image;
            } catch (error) {
                console.error('[Phonie] NovelAI image generation failed.', error);
                updateState({ novelBusy: false, novelStatus: error?.message || '生成失败' });
                showToast(error?.message || 'NovelAI 图片生成失败');
                return '';
            }
        },
        async generateNovelAiTags(payload) {
            updateState({ novelTagBusy: true, novelStatus: '正在整理提示词…' });
            try {
                const tags = await bridge.generateNovelAiTags(payload);
                updateState({ novelTagBusy: false, novelStatus: '提示词已生成' });
                showToast('画面提示词已生成');
                return tags;
            } catch (error) {
                console.error('[Phonie] NovelAI tag generation failed.', error);
                updateState({ novelTagBusy: false, novelStatus: error?.message || '提示词生成失败' });
                showToast(error?.message || '提示词生成失败');
                return null;
            }
        },
        sendNovelAiImage() {
            const state = store.getState();
            if (!state.novelImage) return;
            const message = createPhoneMessage({
                direction: 'incoming',
                author: state.chatParticipants?.[0]?.name || state.contact.name,
                originalText: '分享了一张图片',
                kind: MESSAGE_KINDS.IMAGE,
                attachmentName: 'NovelAI 生成图片',
                description: '角色在私人频道分享了一张图片',
                imageUrl: state.novelImage,
            });
            const messages = [...state.messages, message];
            updateState({ messages, screen: SCREENS.CHAT });
            persistPhoneState(messages, state.calls, state.pendingUserMessageIds);
            showToast('角色图片已加入当前会话');
        },
        downloadNovelAiImage() {
            const image = store.getState().novelImage;
            if (!image) return;
            const link = document.createElement('a');
            link.href = image;
            link.download = `phonie-novelai-${Date.now()}.png`;
            link.click();
        },
        updatePromptPreset(kind, promptPreset) {
            const key = promptSettingKey(kind);
            const nextSettings = bridge.updateSettings({ [key]: promptPreset });
            updateState({ settings: { ...nextSettings } });
            if (kind === 'body') bridge.updateBodyPromptInjection();
        },
        savePromptPreset(kind, promptPreset, asNew = false) {
            const settings = store.getState().settings;
            const saved = savePromptPresetToLibrary(settings.promptPresetLibraries, kind, promptPreset, { asNew });
            const key = promptSettingKey(kind);
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
            const key = promptSettingKey(kind);
            const nextSettings = bridge.updateSettings({ [key]: preset });
            updateState({ settings: { ...nextSettings } });
            if (kind === 'body') bridge.updateBodyPromptInjection();
            showToast('预设已应用');
        },
        deletePromptPreset(kind, presetId) {
            const settings = store.getState().settings;
            const fallback = defaultPromptForKind(kind);
            const library = removePromptPreset(settings.promptPresetLibraries, kind, presetId, fallback);
            const nextPreset = library[kind][0];
            const key = promptSettingKey(kind);
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
                    chat: settings.chatPromptPreset || DEFAULT_CHAT_PROMPT_PRESET,
                    call_single: settings.callPromptPreset || DEFAULT_CALL_PROMPT_PRESET,
                    call_group: settings.groupCallPromptPreset || DEFAULT_GROUP_CALL_PROMPT_PRESET,
                });
                const library = Object.fromEntries(['body', 'chat', 'call_single', 'call_group'].map((kind) => {
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
        deleteCallRecord(callId) {
            const state = store.getState();
            const calls = state.calls.filter((record) => record.id !== callId);
            if (calls.length === state.calls.length) return;
            updateState({ calls });
            persistPhoneState(state.messages, calls);
            showToast('通话记录已删除');
        },
        clearCurrentConversation() {
            const state = store.getState();
            updateState({ messages: [], pendingUserMessageIds: [] });
            persistPhoneState([], state.calls, []);
            showToast('当前会话已清空');
        },
        deleteCurrentConversation() {
            const state = store.getState();
            const conversations = { ...(state.conversations || {}) };
            delete conversations[state.activeConversationId];
            const nextMetadata = {
                schemaVersion: SCHEMA_VERSION,
                messages: [],
                calls: state.calls,
                pendingUserMessageIds: [],
                conversations,
                activeConversationId: state.activeConversationId,
            };
            updateState({ messages: [], pendingUserMessageIds: [], conversations });
            bridge.savePhoneMetadata(nextMetadata);
            bridge.updateContinuityPrompt(nextMetadata);
            showToast('当前会话已删除');
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
        view.setAudioLevel(detail.level, detail.levels);
        if (detail.state === 'progress') return;
        const currentId = detail.current?.messageId;
        const messages = store.getState().messages.map((message) => ({
            ...message,
            isPlaying: message.id === currentId && detail.state === 'playing',
            audioStatus: message.id === currentId
                ? (detail.state === 'playing' ? 'playing' : detail.state === 'paused' ? 'paused' : ['ended', 'stopped'].includes(detail.state) ? 'idle' : detail.state === 'error' ? 'error' : message.audioStatus)
                : message.audioStatus === 'playing' ? 'idle' : message.audioStatus,
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
            const call = store.getState();
            const nextIndex = Number(call.callScriptIndex) + 1;
            if (nextIndex < (call.callScriptQueue?.length || 0)) {
                window.setTimeout(() => playCallScriptAt(nextIndex).catch((error) => {
                    console.warn('[Phonie] Could not continue prepared call.', error);
                    if (callMachine.state === CALL_STATES.SPEAKING) callMachine.transition(CALL_STATES.CONNECTED);
                }), 180);
            } else {
                callMachine.transition(CALL_STATES.CONNECTED);
                window.setTimeout(() => {
                    if (callMachine.state === CALL_STATES.CONNECTED) endCall('completed');
                }, 720);
            }
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
        const nextConversationId = createConversationId([nextContact]);
        const nextConversation = nextMetadata.conversations?.[nextConversationId];
        inlinePlayers.reset();
        inlinePlayers.updateSettings(nextSettings);
        updateState({
            contact: nextContact,
            userName: bridge.getUserName(),
            characters: bridge.getCharacterDirectory(nextSettings),
            selectedCharacterId: bridge.getCharacterDirectory(nextSettings)[0]?.id || '',
            selectedProviderId: nextSettings.ttsActiveProvider,
            messages: nextConversation?.messages || nextMetadata.messages,
            calls: nextMetadata.calls,
            pendingUserMessageIds: nextConversation?.pendingUserMessageIds || nextMetadata.pendingUserMessageIds,
            conversations: nextMetadata.conversations || {},
            activeConversationId: nextConversationId,
            settings: { ...nextSettings },
            providerLabel: providerCenter.getActiveLabel(),
            providerSnapshot: providerCenter.snapshot(),
            generationTarget: bridge.getGenerationTarget(nextSettings),
            customModelStatus: '',
            generating: false,
            callDirection: null,
            callCaption: { source: '', translation: '' },
            callSpeaker: '',
            callParticipants: [nextContact],
            chatParticipants: [nextContact],
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
