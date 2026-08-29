import {
    APP_VERSION,
    CALL_STATES,
    ISLAND_STATES,
    MESSAGE_KINDS,
    MODULE_ID,
    SCREENS,
    THEMES,
} from './core/constants.js';
import {
    IMAGE_PROMPT_SCHEMA,
    QQ_GENERATION_SCHEMA,
    SINGLE_CALL_SCHEMA,
    GROUP_CALL_SCHEMA,
} from './core/contracts.js';
import { createId, virtualPhoneNumber } from './core/id.js';
import { createStore } from './core/store.js';
import { createDeviceStatusSnapshot, DeviceStatusMonitor } from './device/device-status.js';
import {
    addPromptEntry,
    addPromptPreset,
    movePromptEntry,
    removePromptEntry,
    removePromptPreset,
    selectPromptPreset,
    updateActivePromptPreset,
    updatePromptEntry,
} from './dialogue/prompts.js';
import { findContactByVirtualNumber } from './phone/virtual-number.js';
import { createCallRecord, createMessage, recallMessage } from './phone/records.js';
import { SillyTavernBridge, detectTavernScheme } from './integrations/sillytavern.js';
import {
    migrateLegacySecrets,
    PHONIE_SECRET_KINDS,
    removePhonieSecret,
    savePhonieSecret,
} from './integrations/secrets.js';
import { AudioCache, cacheKey } from './tts/cache.js';
import { AudioFocusController, ProviderCenter } from './tts/providers.js';
import { typingDelay } from './ui/dom.js';
import { PhoneView } from './ui/phone-view.js';

export async function createPhonieApp() {
    const existing = globalThis.__phonieApp;
    if (existing?.version === APP_VERSION && document.getElementById('phonie-root')) return existing;
    if (existing?.dispose) {
        try { existing.dispose(); } catch { /* 忽略 */ }
    }

    const bridge = new SillyTavernBridge();
    let settings = bridge.getSettings();
    try {
        settings = await migrateLegacySecrets(bridge, settings);
    } catch (error) {
        console.error('[Phonie] 旧版明文密钥迁移失败', error);
    }
    const contact = bridge.getContact();
    const providerCenter = new ProviderCenter({ bridge });
    const audioFocus = new AudioFocusController();
    const audioCache = new AudioCache();
    let callConnectTimer = null;
    let callClockTimer = null;

    const deviceMonitor = new DeviceStatusMonitor({ onChange: (deviceStatus) => updateState({ deviceStatus }) });

    const metadata = bridge.getChatMetadata();
    const store = createStore({
        open: false,
        screen: SCREENS.HOME,
        settings: { ...settings },
        contact,
        userName: bridge.getUserName(),
        characters: bridge.getCharacterDirectory(settings),
        selectedCharacterId: '',
        selectedEngineId: '',
        providerCheckResults: {},
        messages: metadata.messages || [],
        calls: metadata.calls || [],
        pendingUserMessageIds: metadata.pendingUserMessageIds || [],
        temporarilyDeletedCharacterIds: metadata.temporarilyDeletedCharacterIds || [],
        composerText: '',
        composerKind: MESSAGE_KINDS.TEXT,
        chatToolsOpen: false,
        chatSettingsOpen: false,
        addFriendOpen: false,
        createGroupOpen: false,
        contactRouteOpen: false,
        generating: false,
        islandState: ISLAND_STATES.IDLE,
        deviceStatus: createDeviceStatusSnapshot(),
        tavernScheme: detectTavernScheme(),
        toast: null,
        themeAssetUrls: {},
        novelStatus: '',
        novelImage: '',
        novelIdea: '',
        novelTags: '',
        audioCacheStats: null,
        promptWorkflow: 'body',
        callState: CALL_STATES.IDLE,
        callDirection: null,
        callActive: false,
        callStartedAt: null,
        callDuration: '',
        callCaption: { source: '', translation: '' },
        callParticipants: [],
        callSpeaker: '',
        callStrategy: 'context',
        callTopic: '',
        callLength: 'normal',
        callNumber: '',
        callScriptQueue: [],
        callScriptIndex: -1,
        callReplayMode: false,
    });

    function updateState(patch) {
        store.setState((state) => ({ ...state, ...patch }));
    }

    function showToast(text) {
        const id = Date.now();
        updateState({ toast: { id, text } });
        window.setTimeout(() => {
            if (store.getState().toast?.id === id) updateState({ toast: null });
        }, 2200);
    }

    function persistChat() {
        const state = store.getState();
        bridge.saveChatMetadata({
            messages: state.messages,
            calls: state.calls,
            pendingUserMessageIds: state.pendingUserMessageIds,
            temporarilyDeletedCharacterIds: state.temporarilyDeletedCharacterIds,
        });
    }

    function computeIslandState() {
        const state = store.getState();
        if (state.callActive) {
            if (state.callState === CALL_STATES.RINGING) return ISLAND_STATES.RINGING;
            if ([CALL_STATES.DIALING, CALL_STATES.GENERATING].includes(state.callState)) return ISLAND_STATES.PREPARING_CALL;
            if ([CALL_STATES.CONNECTED, CALL_STATES.SPEAKING].includes(state.callState)) return ISLAND_STATES.CONNECTED;
        }
        if (state.generating) return ISLAND_STATES.GENERATING;
        return ISLAND_STATES.IDLE;
    }

    function pushIsland() {
        updateState({ islandState: computeIslandState() });
    }

    async function refreshAudioCacheStats() {
        const audioCacheStats = await audioCache.getStats();
        updateState({ audioCacheStats });
    }

    // ---- QQ ---------------------------------------------------------------
    async function speakMessage(message) {
        const state = store.getState();
        const speaker = message.direction === 'outgoing' ? state.userName : message.author;
        const route = state.settings?.ttsCharacterRoutes?.[message.authorId || ''] || {};
        const key = cacheKey({ text: message.originalText, provider: state.settings.ttsActiveProvider, voice: route.voice || speaker });
        try {
            let cached = await audioCache.get(key);
            if (cached) {
                await audioFocus.playBlob(cached, { owner: 'phone' });
                return;
            }
            const result = await providerCenter.synthesize({ text: message.originalText, speaker, language: route.lang || state.settings.sourceLanguage, providerId: route.providerId, emotion: message.emotion });
            if (result.speech) {
                await audioFocus.playSpeech(result.speech.text, { lang: result.speech.lang || 'zh-CN', owner: 'phone' });
            } else if (result.blob) {
                await audioCache.put(key, result.blob);
                await audioFocus.playBlob(result.blob, { owner: 'phone' });
                refreshAudioCacheStats();
            }
        } catch (error) {
            showToast(error?.message || '语音播放失败');
        }
    }

    function appendMessage(message) {
        const messages = [...store.getState().messages, message];
        updateState({ messages });
        persistChat();
        return message;
    }

    /** 按说话人名字解析稳定角色 ID，逐段查询声线路由。 */
    function resolveSpeakerId(name) {
        const state = store.getState();
        const match = state.characters.find((character) => character.name === name) || state.contact;
        return match?.id || '';
    }

    async function requestCharacterReply() {
        const state = store.getState();
        if (state.generating) return;
        // 先进入 GENERATING；待回复消息在成功写入全部回复后才清空，失败时回到 QUEUED 不丢失。
        updateState({ generating: true });
        persistChat();
        pushIsland();
        try {
            const pending = state.pendingUserMessageIds.map((id) => state.messages.find((message) => message.id === id)).filter(Boolean);
            const result = await bridge.generateJson({
                workflow: 'chat',
                schema: QQ_GENERATION_SCHEMA,
                vars: {
                    char: state.contact.name,
                    user: state.userName,
                    qqMessages: state.messages,
                    pendingMessages: pending.map((message) => message.originalText).join('\n'),
                },
            });
            const items = Array.isArray(result?.messages) ? result.messages : [];
            let hasBackgroundWork = false;
            for (const item of items) {
                const sourceText = String(item.sourceText || item.imageDescription || item.note || '').trim();
                await new Promise((resolve) => window.setTimeout(resolve, typingDelay(sourceText)));
                const incoming = createMessage({
                    direction: 'incoming',
                    author: item.speaker || state.contact.name,
                    authorId: (store.getState().characters.find((character) => character.name === (item.speaker || state.contact.name)) || state.contact).id,
                    kind: item.kind === 'sticker' ? MESSAGE_KINDS.STICKER : item.kind,
                    originalText: sourceText || (item.kind === 'sticker' ? item.stickerName : ''),
                    translatedText: item.translatedText || '',
                    emotion: item.emotion || 'neutral',
                    amount: item.amount,
                    note: item.note,
                    stickerName: item.stickerName,
                    imageDescription: item.imageDescription,
                    imageStatus: item.kind === 'image' ? 'pending' : undefined,
                });
                appendMessage(incoming);
                if (item.kind === 'voice') {
                    hasBackgroundWork = true;
                    const message = incoming;
                    const route = state.settings?.ttsCharacterRoutes?.[message.authorId || ''] || {};
                    const key = cacheKey({ text: message.originalText, provider: state.settings.ttsActiveProvider, voice: route.voice || message.author });
                    providerCenter.synthesize({ text: message.originalText, speaker: message.author, language: route.lang || state.settings.sourceLanguage, providerId: route.providerId, emotion: message.emotion })
                        .then((resolved) => { if (resolved.blob) audioCache.put(key, resolved.blob).then(refreshAudioCacheStats); })
                        .catch(() => {});
                }
                if (item.kind === 'image') {
                    hasBackgroundWork = true;
                    generateImageForMessage(incoming.id, item.imageDescription);
                }
            }
            updateState({ generating: false, pendingUserMessageIds: [] });
            persistChat();
            pushIsland();

            const intent = result?.proactiveCall;
            const proactive = state.settings?.proactiveCalls || {};
            const caller = store.getState().contact;
            const lastCallAt = Number(proactive.cooldownByContact?.[caller.id] || 0);
            const cooldownMs = Math.min(1440, Math.max(0, Number(proactive.cooldownMinutes) || 0)) * 60000;
            if (intent?.shouldCall && !hasBackgroundWork && proactive.enabled !== false
                && [CALL_STATES.IDLE, CALL_STATES.ENDED].includes(store.getState().callState)
                && Date.now() - lastCallAt >= cooldownMs) {
                const nextCooldown = { ...proactive.cooldownByContact, [caller.id]: Date.now() };
                const nextSettings = bridge.updateSettings({ proactiveCalls: { ...proactive, cooldownByContact: nextCooldown } });
                updateState({ settings: { ...nextSettings } });
                startIncomingCall({ topic: intent.reason });
            }
        } catch (error) {
            console.error('[Phonie] QQ 回复失败', error);
            updateState({ generating: false });
            pushIsland();
            showToast('没有收到回复，请检查生成接口');
        }
    }

    async function generateImageForMessage(messageId, description) {
        try {
            const tags = await bridge.generateJson({
                workflow: 'image',
                schema: IMAGE_PROMPT_SCHEMA,
                vars: { imageIntent: description },
            });
            const image = await bridge.generateNovelAiImage({ prompt: tags?.dynamicPositiveTags || description });
            const messages = store.getState().messages.map((message) => message.id === messageId
                ? { ...message, imageStatus: 'ready', imageUrl: image }
                : message);
            updateState({ messages });
            persistChat();
        } catch (error) {
            const messages = store.getState().messages.map((message) => message.id === messageId
                ? { ...message, imageStatus: 'error' }
                : message);
            updateState({ messages });
            persistChat();
        }
    }

    // ---- 电话 -------------------------------------------------------------
    function startCallClock() {
        window.clearInterval(callClockTimer);
        const startedAt = store.getState().callStartedAt || Date.now();
        const tick = () => {
            if (!store.getState().callActive) return;
            updateState({ callDuration: formatCallDuration(startedAt) });
        };
        tick();
        callClockTimer = window.setInterval(tick, 1000);
    }

    function formatCallDuration(startedAt) {
        const total = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
        return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
    }

    async function generateCallScript({ participants, direction }) {
        const state = store.getState();
        const group = participants.length > 1;
        const lengthRanges = { short: [4, 6], normal: [7, 10], long: [12, 18] };
        const [minSeg, maxSeg] = group ? [15, 28] : (lengthRanges[state.callLength] || [7, 10]);
        const schema = group ? GROUP_CALL_SCHEMA : SINGLE_CALL_SCHEMA;
        const result = await bridge.generateJson({
            workflow: group ? 'group_call' : 'single_call',
            schema,
            vars: {
                char: state.contact.name,
                user: state.userName,
                participants: participants.map((entry) => entry.name).join('、'),
                topic: state.callTopic,
                direction,
                callLength: state.callLength,
            },
            maxTokens: group ? 12288 : 8192,
        });
        let segments = Array.isArray(result?.segments) ? result.segments : [];
        if (!group && segments.length) {
            // 单人电话：不得代写 user 台词，speaker 统一为远端角色。
            const fallback = participants[0]?.name || state.contact.name;
            segments = segments.map((segment) => ({ ...segment, speaker: segment.speaker || fallback }));
        }
        if (!segments.length || segments.length < minSeg) {
            showToast('生成的通话段落不足，请重试');
            return null;
        }
        const capped = segments.slice(0, maxSeg);
        return {
            title: group ? result.summary : result.title,
            reason: group ? result.summary : result.reason,
            segments: capped,
        };
    }

    async function startOutgoingCall() {
        const state = store.getState();
        let participants = [];
        const number = String(state.callNumber || '').trim();
        if (number) {
            const matched = findContactByVirtualNumber(state.characters, number);
            if (!matched) { showToast('这个号码不在通讯录中'); return; }
            participants = [matched];
        } else {
            participants = (state.characters || []).filter((character) => state.selectedCallContactIds?.includes(character.id));
        }
        if (!participants.length) participants = [state.contact];
        updateState({ callActive: true, callState: CALL_STATES.DIALING, callDirection: 'outgoing', callParticipants: participants, screen: SCREENS.PHONE, callCaption: { source: '', translation: '' } });
        pushIsland();
        window.clearTimeout(callConnectTimer);
        callConnectTimer = window.setTimeout(async () => {
            try {
                updateState({ callState: CALL_STATES.GENERATING });
                pushIsland();
                const script = await generateCallScript({ participants, direction: 'outgoing' });
                if (!script) { endCall('generation_failed'); return; }
                const messages = script.segments.map((segment) => createMessage({
                    direction: 'incoming',
                    author: segment.speaker,
                    authorId: resolveSpeakerId(segment.speaker),
                    originalText: segment.sourceText,
                    translatedText: segment.translatedText,
                    emotion: segment.emotion,
                    kind: MESSAGE_KINDS.VOICE,
                    channel: 'call',
                }));
                updateState({ messages: [...store.getState().messages, ...messages], callScriptQueue: messages.map((message) => message.id), callScriptIndex: -1 });
                persistChat();
                updateState({ callState: CALL_STATES.CONNECTED, callStartedAt: Date.now() });
                startCallClock();
                pushIsland();
                playCallSegment(0);
            } catch (error) {
                console.error('[Phonie] 电话准备失败', error);
                endCall('generation_failed');
                showToast(error?.message || '电话内容准备失败');
            }
        }, 700);
    }

    async function startIncomingCall({ topic = '' } = {}) {
        const state = store.getState();
        if (![CALL_STATES.IDLE, CALL_STATES.ENDED].includes(state.callState)) return;
        const participants = [state.contact];
        updateState({ callActive: true, callState: CALL_STATES.GENERATING, callDirection: 'incoming', callParticipants: participants, callTopic: topic, callStrategy: topic ? 'topic' : 'context', callCaption: { source: '', translation: '' } });
        pushIsland();
        try {
            const script = await generateCallScript({ participants, direction: 'incoming' });
            if (!script) { endCall('generation_failed'); return; }
            const messages = script.segments.map((segment) => createMessage({
                direction: 'incoming', author: segment.speaker, authorId: resolveSpeakerId(segment.speaker), originalText: segment.sourceText, translatedText: segment.translatedText, emotion: segment.emotion, kind: MESSAGE_KINDS.VOICE, channel: 'call',
            }));
            updateState({ messages: [...store.getState().messages, ...messages], callScriptQueue: messages.map((message) => message.id), callScriptIndex: -1, callTitle: script.title || script.reason });
            persistChat();
            updateState({ callState: CALL_STATES.RINGING, screen: SCREENS.PHONE });
            pushIsland();
            if (globalThis.navigator?.vibrate) globalThis.navigator.vibrate([160, 90, 160, 360, 160, 90, 160]);
            window.clearTimeout(callConnectTimer);
            callConnectTimer = window.setTimeout(() => {
                if (store.getState().callState === CALL_STATES.RINGING) endCall('missed');
            }, 30000);
        } catch (error) {
            console.error('[Phonie] 来电准备失败', error);
            endCall('generation_failed');
            showToast(error?.message || '来电准备失败');
        }
    }

    function acceptCall() {
        if (store.getState().callState !== CALL_STATES.RINGING) return;
        if (globalThis.navigator?.vibrate) globalThis.navigator.vibrate(0);
        window.clearTimeout(callConnectTimer);
        updateState({ callState: CALL_STATES.CONNECTED, callStartedAt: Date.now() });
        startCallClock();
        pushIsland();
        playCallSegment(0);
    }

    function declineCall() {
        if (store.getState().callState !== CALL_STATES.RINGING) return;
        endCall('declined');
    }

    async function playCallSegment(index) {
        const state = store.getState();
        const messageId = state.callScriptQueue?.[index];
        const message = state.messages.find((entry) => entry.id === messageId);
        if (!message) { endCall('completed'); return; }
        updateState({ callScriptIndex: index, callCaption: { source: message.originalText, translation: message.translatedText }, callSpeaker: message.author });
        if ([CALL_STATES.CONNECTED, CALL_STATES.GENERATING].includes(store.getState().callState)) {
            updateState({ callState: CALL_STATES.SPEAKING });
            pushIsland();
        }
        try {
            await speakMessage(message);
        } catch {
            // 单段失败保留字幕，自然停顿后继续。
        }
        const next = index + 1;
        if (next < (store.getState().callScriptQueue?.length || 0)) {
            window.setTimeout(() => playCallSegment(next), 600);
        } else {
            updateState({ callState: CALL_STATES.CONNECTED });
            window.setTimeout(() => endCall('completed'), 800);
        }
    }

    function endCall(outcome = 'completed') {
        window.clearTimeout(callConnectTimer);
        window.clearInterval(callClockTimer);
        audioFocus.stop();
        const state = store.getState();
        if (!state.callActive && !['generation_failed', 'missed', 'declined'].includes(outcome)) return;
        if (state.callDirection && !state.callReplayMode) {
            const record = createCallRecord({
                contactName: (state.callParticipants || []).map((entry) => entry.name).join('、') || state.contact.name,
                direction: state.callDirection,
                outcome,
                title: ['missed'].includes(outcome) ? '未接来电' : ['declined'].includes(outcome) ? '已拒绝' : (state.callTitle || '通话'),
                summary: ['missed'].includes(outcome) ? '30 秒内未接听' : ['declined'].includes(outcome) ? '已拒绝来电' : (state.callScriptQueue.length ? `${state.callScriptQueue.length} 段对话` : ''),
                startedAt: state.callStartedAt || Date.now(),
                endedAt: Date.now(),
                participants: state.callParticipants,
                messageIds: state.callScriptQueue,
                messages: state.callScriptQueue.map((id) => state.messages.find((message) => message.id === id)).filter(Boolean),
            });
            updateState({ calls: [...state.calls, record] });
        }
        updateState({
            callActive: false, callState: CALL_STATES.ENDED, callDirection: null,
            callCaption: { source: '', translation: '' }, callParticipants: [], callSpeaker: '',
            callScriptQueue: [], callScriptIndex: -1, callReplayMode: false, callDuration: '',
        });
        persistChat();
        pushIsland();
    }

    function replayCall(callId) {
        const record = store.getState().calls.find((entry) => entry.id === callId);
        if (!record) return;
        const messages = (record.messages || []).map((message) => ({ ...message, id: createId('msg') }));
        const queue = messages.map((message) => message.id);
        updateState({
            callActive: true, callState: CALL_STATES.DIALING, callDirection: record.direction,
            callParticipants: record.participants?.length ? record.participants : [store.getState().contact],
            messages: [...store.getState().messages, ...messages], callScriptQueue: queue, callScriptIndex: -1,
            callReplayMode: true, callCaption: { source: '', translation: '' }, screen: SCREENS.PHONE,
        });
        pushIsland();
        window.setTimeout(() => {
            updateState({ callState: CALL_STATES.CONNECTED, callStartedAt: Date.now() });
            startCallClock();
            playCallSegment(0);
        }, 400);
    }

    // ---- 主题 -------------------------------------------------------------
    function setTheme(theme) {
        if (!Object.values(THEMES).includes(theme)) return;
        const nextSettings = bridge.updateSettings({ theme });
        updateState({ settings: { ...nextSettings } });
        showToast({ [THEMES.DAY]: '已切换为日间主题', [THEMES.NIGHT]: '已切换为夜间主题', [THEMES.TAVERN]: '已跟随酒馆主题', [THEMES.CUSTOM]: '已切换为自定义主题' }[theme]);
    }

    async function uploadWallpaper(file) {
        if (!(file instanceof Blob)) return;
        const url = URL.createObjectURL(file);
        const current = store.getState().settings.customTheme || {};
        const settings = bridge.updateSettings({ customTheme: { ...current, wallpaperUrl: '' } });
        updateState({ settings: { ...settings }, themeAssetUrls: { ...store.getState().themeAssetUrls, wallpaper: url } });
    }

    // ---- 引擎 -------------------------------------------------------------
    async function setProvider(providerId) {
        if (!store.getState().providerCheckResults?.[providerId]) {
            showToast('请先完成连接检测');
            return;
        }
        const settings = bridge.updateSettings({ ttsActiveProvider: providerId });
        updateState({ settings: { ...settings } });
        showToast('当前语音引擎已切换');
    }

    async function checkProvider(providerId) {
        showToast('正在检测连接');
        try {
            await providerCenter.checkProvider(providerId);
            updateState({ providerCheckResults: { ...store.getState().providerCheckResults, [providerId]: true } });
            showToast('语音服务连接可用');
        } catch (error) {
            updateState({ providerCheckResults: { ...store.getState().providerCheckResults, [providerId]: false } });
            showToast(error?.message || '连接失败');
        }
    }

    function updateEngineField(key, value) {
        const state = store.getState();
        if (!state.selectedEngineId) return;
        const settings = providerCenter.updateProvider(state.selectedEngineId, { [key]: value });
        updateState({ settings: { ...settings } });
    }

    async function saveEngineSecret(providerId, value) {
        if (providerId !== 'elevenlabs') return;
        const state = store.getState();
        const previousId = state.settings.ttsProviderSettings?.elevenlabs?.secretId || '';
        try {
            const secretId = await savePhonieSecret(PHONIE_SECRET_KINDS.ELEVENLABS, value, 'Phonie · ElevenLabs');
            const nextSettings = providerCenter.updateProvider('elevenlabs', { secretId });
            updateState({ settings: { ...nextSettings } });
            if (previousId && previousId !== secretId) await removePhonieSecret(PHONIE_SECRET_KINDS.ELEVENLABS, previousId);
            showToast('ElevenLabs 密钥已保存到 SillyTavern Secrets');
        } catch (error) {
            showToast(error?.message || '密钥保存失败');
        }
    }

    async function syncProviderResources(providerId) {
        showToast('正在同步模型与音色目录');
        try {
            const catalog = await providerCenter.syncResources(providerId);
            const modelIds = (catalog.models || []).map((entry) => entry.id).filter(Boolean);
            const voiceIds = (catalog.voices || []).map((entry) => entry.id).filter(Boolean);
            const warnings = catalog.warnings || [];
            updateState({ providerCatalog: { ...(store.getState().providerCatalog || {}), [providerId]: catalog } });
            const message = [`已同步 ${modelIds.length} 个模型、${voiceIds.length} 个音色`, ...warnings].join('；');
            showToast(message);
        } catch (error) {
            showToast(error?.message || '资源同步失败');
        }
    }

    // ---- 通讯录 -----------------------------------------------------------
    function addManualContact() {
        const input = document.querySelector('#phonie-root [data-role="manual-contact-name"]');
        const name = String(input?.value || '').trim();
        if (!name) return;
        const id = 'speaker:' + encodeURIComponent(name.toLocaleLowerCase('zh-CN'));
        const contacts = store.getState().settings.contacts || [];
        const nextSettings = bridge.updateSettings({
            contacts: [...contacts.filter((entry) => entry.id !== id), { id, name, source: 'manual' }],
            ignoredContacts: (store.getState().settings.ignoredContacts || []).filter((entry) => String(entry).toLocaleLowerCase() !== name.toLocaleLowerCase()),
        });
        updateState({ settings: { ...nextSettings }, characters: bridge.getCharacterDirectory(nextSettings) });
        if (input) input.value = '';
        showToast(name + ' 已加入通讯录');
    }

    function deleteContact(contactId) {
        const character = store.getState().characters.find((entry) => entry.id === contactId);
        if (!character || character.current) return;
        const settings = store.getState().settings;
        const nextSettings = bridge.updateSettings({
            contacts: (settings.contacts || []).filter((entry) => entry.id !== contactId),
            ignoredContacts: [...new Set([...(settings.ignoredContacts || []), character.name])],
            qqFriends: (settings.qqFriends || []).filter((id) => id !== contactId),
            qqGroups: (settings.qqGroups || []).map((group) => ({ ...group, memberIds: group.memberIds.filter((id) => id !== contactId) })).filter((group) => group.memberIds.length >= 2),
        });
        updateState({ settings: { ...nextSettings }, characters: bridge.getCharacterDirectory(nextSettings) });
        showToast('联系人已删除');
    }

    function saveContactRoute() {
        const state = store.getState();
        const contactEntry = state.characters.find((entry) => entry.id === state.selectedCharacterId) || state.contact;
        const engineSelect = document.querySelector('#phonie-root [data-role="route-engine"]');
        const voiceInput = document.querySelector('#phonie-root [data-role="route-voice"]');
        const langInput = document.querySelector('#phonie-root [data-role="route-lang"]');
        const routes = { ...(state.settings.ttsCharacterRoutes || {}), [contactEntry.id]: { providerId: engineSelect?.value, voice: voiceInput?.value || '', lang: langInput?.value || '' } };
        const settings = bridge.updateSettings({ ttsCharacterRoutes: routes });
        updateState({ settings: { ...settings }, contactRouteOpen: false });
        showToast(contactEntry.name + ' 的声线已保存');
    }

    // ---- 提示词 -----------------------------------------------------------
    function updatePromptEntryField(entryId, key, value) {
        const state = store.getState();
        const kind = state.promptWorkflow || 'body';
        const presets = { ...(state.settings.promptPresets || {}) };
        const nextActive = updatePromptEntry(presets[kind], entryId, { [key]: value });
        presets[kind] = updateActivePromptPreset(presets[kind], nextActive, kind);
        const settings = bridge.updateSettings({ promptPresets: presets });
        updateState({ settings: { ...settings } });
        if (kind === 'body') bridge.updateBodyPromptInjection();
    }

    // ---- 动作表 -----------------------------------------------------------
    const actions = {
        open() {
            const currentSettings = bridge.getSettings();
            updateState({
                open: true,
                screen: SCREENS.HOME,
                settings: { ...currentSettings },
                contact: bridge.getContact(),
                userName: bridge.getUserName(),
                characters: bridge.getCharacterDirectory(currentSettings),
                tavernScheme: detectTavernScheme(),
            });
            refreshAudioCacheStats();
        },
        close() { updateState({ open: false }); },
        navigate(screen) {
            if (!Object.values(SCREENS).includes(screen)) return;
            updateState({ screen });
        },
        resumeActive() {
            updateState({ screen: store.getState().callActive ? SCREENS.PHONE : SCREENS.HOME, open: true });
        },
        setTheme,
        updateSetting(key, value) {
            const nextSettings = bridge.updateSettings({ [key]: value });
            updateState({ settings: { ...nextSettings }, characters: bridge.getCharacterDirectory(nextSettings) });
            if (key === 'bodyTtsEnabled' || key === 'bodyPromptEnabled') bridge.updateBodyPromptInjection();
        },
        updateProactive(key, value) {
            const proactive = { ...(store.getState().settings.proactiveCalls || {}), [key]: value };
            const settings = bridge.updateSettings({ proactiveCalls: proactive });
            updateState({ settings: { ...settings } });
        },
        updateDock({ dockSide, dockY }) {
            const nextSettings = bridge.updateSettings({ dockSide, dockY });
            updateState({ settings: { ...nextSettings } });
        },
        updateCustomColor(key, value) {
            const state = store.getState();
            const colorKeyMap = { base: '--phonie-bg', panel: '--phonie-surface', accent: '--phonie-accent', glow: '--phonie-glow' };
            const cssKey = colorKeyMap[key];
            if (!cssKey) return;
            const current = state.settings.customTheme || {};
            const colors = { ...(current.colors || {}), [cssKey]: value };
            const settings = bridge.updateSettings({ customTheme: { ...current, colors } });
            updateState({ settings: { ...settings } });
        },
        updateWallpaperUrl(url) {
            const current = store.getState().settings.customTheme || {};
            const settings = bridge.updateSettings({ customTheme: { ...current, wallpaperUrl: url, wallpaperAssetKey: '' } });
            updateState({ settings: { ...settings }, themeAssetUrls: { ...store.getState().themeAssetUrls, wallpaper: url } });
        },
        uploadWallpaper,
        // QQ
        openChat(contactId) {
            const character = store.getState().characters.find((entry) => entry.id === contactId);
            if (!character) return;
            updateState({ screen: SCREENS.CHAT, chatParticipants: [character] });
        },
        openGroup(groupId) {
            const group = (store.getState().settings.qqGroups || []).find((entry) => entry.id === groupId);
            if (!group) return;
            const participants = group.memberIds.map((id) => store.getState().characters.find((entry) => entry.id === id)).filter(Boolean);
            if (participants.length >= 2) updateState({ screen: SCREENS.CHAT, chatParticipants: participants });
        },
        toggleAddFriend() { updateState({ addFriendOpen: !store.getState().addFriendOpen, createGroupOpen: false }); },
        toggleCreateGroup() { updateState({ createGroupOpen: !store.getState().createGroupOpen, addFriendOpen: false }); },
        confirmAddFriend() {
            const select = document.querySelector('#phonie-root [data-role="add-friend-select"]');
            const characterId = select?.value;
            const character = store.getState().characters.find((entry) => entry.id === characterId);
            if (!character) return;
            const qqFriends = [...new Set([...(store.getState().settings.qqFriends || []), character.id])];
            const settings = bridge.updateSettings({ qqFriends });
            updateState({ settings: { ...settings }, addFriendOpen: false });
            showToast(character.name + ' 已添加为好友');
        },
        confirmCreateGroup() {
            const nameInput = document.querySelector('#phonie-root [data-role="group-name"]');
            const name = String(nameInput?.value || '').trim();
            const memberIds = [...document.querySelectorAll('#phonie-root [data-group-member]:checked')].map((input) => input.dataset.groupMember);
            if (!name || memberIds.length < 2) { showToast('需要群名和至少两位好友'); return; }
            const group = { id: createId('group'), name: name.slice(0, 80), memberIds, createdAt: Date.now() };
            const settings = bridge.updateSettings({ qqGroups: [...(store.getState().settings.qqGroups || []), group] });
            updateState({ settings: { ...settings }, createGroupOpen: false });
            showToast('群聊已创建');
        },
        toggleGroupMember() { /* 复选框状态由 DOM 保存 */ },
        setComposerKind(kind) {
            updateState({ composerKind: kind, chatToolsOpen: false });
            showToast({ text: '文字消息', voice: '语音消息（user 为文字描述）', image: '图片（文字描述版）', transfer: '转账' }[kind] || '');
        },
        toggleChatTools() { updateState({ chatToolsOpen: !store.getState().chatToolsOpen }); },
        toggleChatSettings() { updateState({ chatSettingsOpen: !store.getState().chatSettingsOpen, chatToolsOpen: false }); },
        clearChat() {
            const messages = store.getState().messages.filter((message) => message.channel === 'call');
            updateState({ messages, pendingUserMessageIds: [], chatSettingsOpen: false });
            persistChat();
            showToast('当前 QQ 记录已清空');
        },
        removeCurrentFriend() {
            const state = store.getState();
            const participant = state.chatParticipants?.[0];
            if (!participant) return;
            if (participant.current || participant.id === state.contact?.id) {
                updateState({
                    temporarilyDeletedCharacterIds: [...new Set([...(state.temporarilyDeletedCharacterIds || []), participant.id])],
                    screen: SCREENS.QQ,
                    chatSettingsOpen: false,
                });
                persistChat();
            } else {
                const settings = bridge.updateSettings({ qqFriends: (state.settings.qqFriends || []).filter((id) => id !== participant.id) });
                updateState({ settings: { ...settings }, screen: SCREENS.QQ, chatSettingsOpen: false });
            }
            showToast('好友已从当前列表移除');
        },
        updateComposerText(text) { updateState({ composerText: text }); },
        sendChat() {
            const state = store.getState();
            const text = String(state.composerText || '').trim();
            if (text) {
                const outgoing = createMessage({ direction: 'outgoing', author: state.userName, kind: state.composerKind, originalText: text });
                if (state.composerKind === MESSAGE_KINDS.VOICE) outgoing.originalText = `[语音] ${text}`;
                if (state.composerKind === MESSAGE_KINDS.IMAGE) { outgoing.kind = MESSAGE_KINDS.IMAGE; outgoing.imageDescription = text; }
                if (state.composerKind === MESSAGE_KINDS.TRANSFER) {
                    const amount = Number.parseFloat(text);
                    outgoing.kind = MESSAGE_KINDS.TRANSFER;
                    outgoing.amount = Number.isFinite(amount) ? amount : 0;
                    outgoing.note = '转账';
                    outgoing.originalText = `转账 ¥${outgoing.amount.toFixed(2)}`;
                }
                appendMessage(outgoing);
                updateState({ composerText: '', pendingUserMessageIds: [...state.pendingUserMessageIds, outgoing.id] });
                persistChat();
                return;
            }
            if (state.pendingUserMessageIds.length) requestCharacterReply();
        },
        playMessageAudio(messageId) {
            const message = store.getState().messages.find((entry) => entry.id === messageId);
            if (message) speakMessage(message);
        },
        recallMessage(messageId) {
            const messages = store.getState().messages.map((message) => message.id === messageId ? recallMessage(message) : message);
            updateState({ messages });
            persistChat();
        },
        sendSticker(name) {
            const state = store.getState();
            const sticker = (state.settings.stickers || []).find((entry) => entry.name === name);
            if (!sticker) return;
            const message = createMessage({ direction: 'outgoing', author: state.userName, kind: MESSAGE_KINDS.STICKER, stickerName: sticker.name, imageUrl: sticker.url });
            appendMessage(message);
            updateState({ pendingUserMessageIds: [...store.getState().pendingUserMessageIds, message.id], chatToolsOpen: false });
            persistChat();
        },
        // 电话
        dialDigit(digit) {
            updateState({ callNumber: store.getState().callNumber + String(digit || '') });
        },
        dialBackspace() {
            updateState({ callNumber: store.getState().callNumber.slice(0, -1) });
        },
        updateCallStrategy(value) {
            updateState({ callStrategy: value });
            const topicRow = document.querySelector('#phonie-root [data-role="call-topic-row"]');
            if (topicRow) topicRow.hidden = value !== 'topic';
        },
        updateCallLength(value) { updateState({ callLength: value }); },
        updateCallContacts(contactIds) {
            const ids = Array.isArray(contactIds) ? contactIds.filter(Boolean) : [];
            updateState({ selectedCallContactIds: ids, callNumber: ids.length === 1 ? virtualPhoneNumber(ids[0]) : '' });
        },
        startCall: startOutgoingCall,
        acceptCall,
        declineCall,
        endCall: () => endCall('completed'),
        minimizeCall() { updateState({ screen: SCREENS.HOME }); },
        replayCall,
        rerenderCall: replayCall,
        favoriteCall(callId) {
            const state = store.getState();
            const record = state.calls.find((entry) => entry.id === callId);
            if (!record) return;
            const exists = (state.settings.favoriteCalls || []).some((entry) => entry.id === record.id);
            const favoriteCalls = exists
                ? state.settings.favoriteCalls.filter((entry) => entry.id !== record.id)
                : [...(state.settings.favoriteCalls || []), { ...record, favoritedAt: Date.now() }];
            const settings = bridge.updateSettings({ favoriteCalls });
            updateState({ settings: { ...settings } });
            showToast(exists ? '已取消收藏' : '已收藏通话');
        },
        deleteCall(callId) {
            const calls = store.getState().calls.filter((record) => record.id !== callId);
            updateState({ calls });
            persistChat();
            showToast('通话记录已删除');
        },
        // 通讯录
        addManualContact,
        deleteContact(contactId) { deleteContact(contactId); },
        openContactRoute(contactId) {
            updateState({ selectedCharacterId: contactId, contactRouteOpen: true });
        },
        saveContactRoute,
        updateRouteEngine() {},
        updateRouteVoice() {},
        // 引擎
        openEngine(engineId) {
            updateState({ selectedEngineId: engineId, screen: SCREENS.ENGINE_DETAIL });
        },
        setProvider,
        checkProvider,
        syncResources: syncProviderResources,
        updateEngineField,
        saveEngineSecret,
        // 绘画
        updateNovelAiTags(text) { updateState({ novelTags: text }); },
        updateNovelAiSetting(key, value) {
            const current = store.getState().settings.novelAi || {};
            const novelAi = { ...current, [key]: value };
            if (key === 'steps') novelAi.steps = Math.min(28, Math.max(1, Number(value) || 28));
            const settings = bridge.updateSettings({ novelAi });
            updateState({ settings: { ...settings } });
        },
        async generateNovelAiTags() {
            const idea = document.querySelector('#phonie-root [data-role="novelai-idea"]')?.value || '';
            if (!idea.trim()) { showToast('请先填写画面意图'); return; }
            updateState({ novelStatus: '正在整理提示词…' });
            try {
                const result = await bridge.generateJson({ workflow: 'image', schema: IMAGE_PROMPT_SCHEMA, vars: { imageIntent: idea } });
                const tags = result?.dynamicPositiveTags || '';
                updateState({ novelTags: tags, novelStatus: '提示词已生成' });
                const tagsInput = document.querySelector('#phonie-root [data-role="novelai-tags"]');
                if (tagsInput) tagsInput.value = tags;
            } catch (error) {
                updateState({ novelStatus: '' });
                showToast(error?.message || '提示词生成失败');
            }
        },
        async generateNovelAiImage() {
            const tags = store.getState().novelTags || document.querySelector('#phonie-root [data-role="novelai-tags"]')?.value || '';
            if (!tags.trim()) { showToast('请先生成或填写正面 Tag'); return; }
            updateState({ novelStatus: '正在生成图片…' });
            try {
                const config = store.getState().settings.novelAi || {};
                const [width, height] = String(config.size || '832x1216').split('x').map(Number);
                const prompt = [config.prefix, tags, config.suffix].map((part) => String(part || '').trim()).filter(Boolean).join(', ');
                const image = await bridge.generateNovelAiImage({
                    prompt,
                    negativePrompt: config.negative || '',
                    model: config.model,
                    width,
                    height,
                    sampler: config.sampler,
                    scheduler: config.scheduler,
                    seed: config.seed,
                    steps: Math.min(28, Number(config.steps) || 28),
                    scale: config.scale,
                    guidanceRescale: config.guidanceRescale,
                    decrisper: config.decrisper,
                });
                updateState({ novelImage: image, novelStatus: '生成完成' });
            } catch (error) {
                updateState({ novelStatus: '' });
                showToast(error?.message || '图片生成失败');
            }
        },
        // 表情包
        importStickers() {
            const text = document.querySelector('#phonie-root [data-role="sticker-import"]')?.value || '';
            const stickers = text.split(',').map((item) => {
                const match = item.trim().match(/(https?:\/\/)/i);
                if (!match) return null;
                const index = match.index;
                const name = item.trim().slice(0, index).trim();
                const url = item.trim().slice(index).trim();
                return name && /^https?:\/\//i.test(url) ? { name: name.slice(0, 80), url: url.slice(0, 2000) } : null;
            }).filter(Boolean);
            if (!stickers.length) { showToast('没有解析到有效的表情包'); return; }
            const settings = bridge.updateSettings({ stickers: [...(store.getState().settings.stickers || []), ...stickers] });
            updateState({ settings: { ...settings } });
            showToast(`已导入 ${stickers.length} 个表情包`);
        },
        removeSticker(name) {
            const settings = bridge.updateSettings({ stickers: (store.getState().settings.stickers || []).filter((entry) => entry.name !== name) });
            updateState({ settings: { ...settings } });
        },
        clearStickers() {
            const settings = bridge.updateSettings({ stickers: [] });
            updateState({ settings: { ...settings } });
            showToast('表情包已清空');
        },
        // 缓存
        async clearCache() {
            await audioCache.clear();
            await refreshAudioCacheStats();
            showToast('语音缓存已清除');
        },
        // 模型来源
        addOpenAIProfile() {
            const id = createId('openai');
            const preset = { id, name: '自定义 OpenAI', endpoint: '', secretId: '', model: '', models: [], temperature: 0.7, maxTokens: 8192 };
            const settings = bridge.updateSettings({ customOpenAIPresets: [...(store.getState().settings.customOpenAIPresets || []), preset], activeCustomOpenAIPresetId: id, generationMode: 'custom' });
            updateState({ settings: { ...settings } });
        },
        updateOpenAIProfile(profileId, key, value) {
            if (key === 'apiKey' || key === 'secretId') return;
            if (key === 'temperature') value = Math.min(2, Math.max(0, Number(value) || 0));
            if (key === 'maxTokens') value = Math.min(30000, Math.max(1, Number(value) || 8192));
            const presets = (store.getState().settings.customOpenAIPresets || []).map((preset) => preset.id === profileId ? { ...preset, [key]: value } : preset);
            const settings = bridge.updateSettings({ customOpenAIPresets: presets });
            updateState({ settings: { ...settings } });
        },
        async saveOpenAISecret(profileId, value) {
            const current = (store.getState().settings.customOpenAIPresets || []).find((preset) => preset.id === profileId);
            if (!current) return;
            try {
                const secretId = await savePhonieSecret(PHONIE_SECRET_KINDS.OPENAI, value, `Phonie · ${current.name || 'OpenAI'}`);
                const presets = (store.getState().settings.customOpenAIPresets || []).map((preset) => preset.id === profileId ? { ...preset, secretId } : preset);
                const settings = bridge.updateSettings({ customOpenAIPresets: presets });
                updateState({ settings: { ...settings } });
                if (current.secretId && current.secretId !== secretId) await removePhonieSecret(PHONIE_SECRET_KINDS.OPENAI, current.secretId);
                showToast('API Key 已保存到 SillyTavern Secrets');
            } catch (error) {
                showToast(error?.message || '密钥保存失败');
            }
        },
        activateOpenAIProfile(profileId) {
            const settings = bridge.updateSettings({ activeCustomOpenAIPresetId: profileId, generationMode: 'custom' });
            updateState({ settings: { ...settings } });
            showToast('已启用该预设');
        },
        async deleteOpenAIProfile(profileId) {
            const current = (store.getState().settings.customOpenAIPresets || []).find((preset) => preset.id === profileId);
            if (!current) return;
            if (typeof globalThis.confirm === 'function' && !globalThis.confirm(`删除模型预设“${current.name}”及其密钥？`)) return;
            if (current.secretId) await removePhonieSecret(PHONIE_SECRET_KINDS.OPENAI, current.secretId);
            const presets = (store.getState().settings.customOpenAIPresets || []).filter((preset) => preset.id !== profileId);
            const patch = { customOpenAIPresets: presets };
            if (store.getState().settings.activeCustomOpenAIPresetId === profileId) {
                patch.activeCustomOpenAIPresetId = '';
                patch.generationMode = 'tavern';
            }
            const settings = bridge.updateSettings(patch);
            updateState({ settings: { ...settings } });
        },
        toggleSecret(profileId) {
            const input = document.querySelector(`#phonie-root [data-openai-secret][data-id="${profileId}"]`);
            if (input) input.type = input.type === 'password' ? 'text' : 'password';
        },
        // 提示词
        selectPromptWorkflow(kind) { updateState({ promptWorkflow: kind }); },
        addPromptEntry() {
            const state = store.getState();
            const kind = state.promptWorkflow || 'body';
            const presets = { ...(state.settings.promptPresets || {}) };
            presets[kind] = updateActivePromptPreset(presets[kind], addPromptEntry(presets[kind]), kind);
            const settings = bridge.updateSettings({ promptPresets: presets });
            updateState({ settings: { ...settings } });
            if (kind === 'body') bridge.updateBodyPromptInjection();
        },
        addPromptPreset() {
            const state = store.getState();
            const kind = state.promptWorkflow || 'body';
            const presets = { ...(state.settings.promptPresets || {}) };
            const count = presets[kind]?.presets?.length || 1;
            presets[kind] = addPromptPreset(presets[kind], { kind, name: `预设 ${count + 1}` });
            const settings = bridge.updateSettings({ promptPresets: presets });
            updateState({ settings: { ...settings } });
            if (kind === 'body') bridge.updateBodyPromptInjection();
        },
        selectPromptPreset(presetId) {
            const state = store.getState();
            const kind = state.promptWorkflow || 'body';
            const presets = { ...(state.settings.promptPresets || {}) };
            presets[kind] = selectPromptPreset(presets[kind], presetId, kind);
            const settings = bridge.updateSettings({ promptPresets: presets });
            updateState({ settings: { ...settings } });
            if (kind === 'body') bridge.updateBodyPromptInjection();
        },
        renamePromptPreset(name) {
            const state = store.getState();
            const kind = state.promptWorkflow || 'body';
            const presets = { ...(state.settings.promptPresets || {}) };
            presets[kind] = updateActivePromptPreset(presets[kind], { ...presets[kind], name }, kind);
            const settings = bridge.updateSettings({ promptPresets: presets });
            updateState({ settings: { ...settings } });
            if (kind === 'body') bridge.updateBodyPromptInjection();
        },
        deletePromptPreset() {
            const state = store.getState();
            const kind = state.promptWorkflow || 'body';
            const library = state.settings.promptPresets?.[kind];
            if (!library || (library.presets?.length || 1) <= 1) return showToast('至少保留一个提示词预设');
            if (!globalThis.confirm?.(`删除提示词预设“${library.name}”？`)) return;
            const presets = { ...(state.settings.promptPresets || {}) };
            presets[kind] = removePromptPreset(library, library.activePresetId, kind);
            const settings = bridge.updateSettings({ promptPresets: presets });
            updateState({ settings: { ...settings } });
            if (kind === 'body') bridge.updateBodyPromptInjection();
        },
        updatePromptEntryField,
        removePromptEntry(entryId) {
            const state = store.getState();
            const kind = state.promptWorkflow || 'body';
            const presets = { ...(state.settings.promptPresets || {}) };
            presets[kind] = updateActivePromptPreset(presets[kind], removePromptEntry(presets[kind], entryId), kind);
            const settings = bridge.updateSettings({ promptPresets: presets });
            updateState({ settings: { ...settings } });
            if (kind === 'body') bridge.updateBodyPromptInjection();
        },
        movePromptEntry(entryId, direction) {
            const state = store.getState();
            const kind = state.promptWorkflow || 'body';
            const presets = { ...(state.settings.promptPresets || {}) };
            presets[kind] = updateActivePromptPreset(presets[kind], movePromptEntry(presets[kind], entryId, direction), kind);
            const settings = bridge.updateSettings({ promptPresets: presets });
            updateState({ settings: { ...settings } });
            if (kind === 'body') bridge.updateBodyPromptInjection();
        },
    };

    const view = new PhoneView({ store, actions });
    view.mount();
    deviceMonitor.start();
    refreshAudioCacheStats();
    bridge.updateBodyPromptInjection();

    const app = {
        version: APP_VERSION,
        store,
        bridge,
        view,
        providerCenter,
        dispose() {
            window.clearTimeout(callConnectTimer);
            window.clearInterval(callClockTimer);
            deviceMonitor.dispose();
            audioFocus.dispose();
            bridge.dispose();
            view.dispose();
            delete globalThis.__phonieApp;
        },
    };
    globalThis.__phonieApp = app;
    console.info(`[Phonie] 声纹手机已就绪（${MODULE_ID} ${APP_VERSION}）。`);
    return app;
}
