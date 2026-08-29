import { TTS_ProviderRegistry } from '../tts/provider-registry.js';
import { TTS_AudioCache, TTS_ImageCache } from '../tts/cache.js';
import { FrontendVoiceTools } from '../dialogue/voice-tools.js';
import { icon } from './mobile-icons.js';
import { createPhoneMotionRuntime } from './motion.js';
import { extension_settings } from '/scripts/extensions.js';
import { saveSettingsDebounced, generateQuietPrompt, getRequestHeaders } from '/script.js';

const CONSOLE_STYLE_URL = new URL('../../styles/voice-console.css', import.meta.url).href;
const MINIMAX_TOOL_REQUEST_INTERVAL_MS = 2000;
const NOTIFICATION_STORAGE_KEY = 'tts_voice_hub_notifications_v1';
const NOTIFICATION_SESSION_STARTED_AT = Date.now();
let miniMaxToolNextRequestAt = 0;
let motionRuntime = null;

function loadVoiceNotifications() {
    try {
        const values = JSON.parse(localStorage.getItem(NOTIFICATION_STORAGE_KEY) || '[]');
        if (!Array.isArray(values)) return [];
        return values.filter(item => item?.id && item?.title).slice(0, 100);
    } catch {
        return [];
    }
}

const savedUiSettings = TTS_ProviderRegistry.getUiSettings();
const legacyTheme = localStorage.getItem('tts_voice_hub_theme');
const state = {
    open: false,
    route: 'home',
    providerId: null,
    routeCharacter: null,
    contactName: '',
    previewUrl: null,
    previewController: null,
    previewProviderId: null,
    previewResultProviderId: null,
    unsubscribe: null,
    eventRoot: null,
    mountObserver: null,
    theme: savedUiSettings.theme || (legacyTheme === 'light' ? 'light' : 'system'),
    homePage: Number(savedUiSettings.homePage) === 1 ? 1 : 0,
    suppressHomeClickUntil: 0,
    suppressTriggerClick: false,
    triggerPosition: null,
    triggerDock: savedUiSettings.triggerDock || 'right',
    triggerShelfTimer: null,
    scrollHintTimer: null,
    scrollIdleTimer: null,
    resizeBound: false,
    cacheStats: { count: null, bytes: null },
    featureBusy: null,
    featureAudioUrl: null,
    featureAudioKey: null,
    featureAudioController: null,
    phonePlan: null,
    phoneStage: 'setup',
    phoneAudioElement: null,
    phoneElapsed: 0,
    phoneDuration: 0,
    phoneSegmentIndex: 0,
    phoneNeedsResume: false,
    phoneError: '',
    conversationTrack: null,
    phoneBrief: '',
    phoneLength: 'short',
    phoneCaller: 'auto',
    phoneParticipants: [],
    phoneDirection: 'outgoing',
    phoneContentSource: 'context',
    phoneRingTimer: null,
    dialInput: '',
    tracksFilter: 'all',
    stickerSelected: [],
    stickerEditingId: '',
    stickerBulkEditOpen: false,
    plannerModels: [],
    plannerModelsBusy: false,
    toolAudioCache: new Map(),
    phoneAudioQueue: [],
    phoneCompletedDuration: 0,
    toolAudioElement: null,
    toolAudioQueue: [],
    toolPlaybackKey: '',
    toolPlaybackIndex: 0,
    favoriteManageKey: '',
    chatQuoteId: '',
    chatActionId: '',
    chatComposerTool: '',
    promptWorkflow: 'chat',
    promptLabKind: 'body',
    settingsTab: '',
    drawingDynamic: '',
    drawingLastImage: null,
    drawingRecentImages: [],
    promptLabResult: null,
    promptLabError: '',
    notifications: loadVoiceNotifications(),
    notificationFilter: 'all',
    restoreRollback: null,
    lastBackupAt: localStorage.getItem('tts_voice_hub_last_backup_at') || '',
    chatAudioKey: '',
    chatAudioElement: null,
    chatVoiceExpanded: new Set(),
    chatScrollToBottom: false,
    activeGroupId: '',
    groupQuoteId: '',
    groupActionId: '',
    groupComposerTool: '',
    groupAudioKey: '',
    groupAudioElement: null,
    groupVoiceExpanded: new Set(),
    groupScrollToBottom: false,
    batteryManager: null,
    systemStatusBound: false,
    renderKey: '',
    toolsUnsubscribe: null,
    schedulerUnsubscribe: null,
    toastTimer: null,
    clockTimer: null,
    initialized: false,
};

const safe = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const statusText = {
    idle: '等待检测',
    checking: '正在连接',
    generating: '正在合成',
    ready: '运行就绪',
    reachable: '服务可访问',
    offline: '服务未启动',
    'needs-config': '需要配置',
    unavailable: '暂不可用',
    error: '连接异常',
};

const generationTaskStatusText = {
    queued: '等待生成',
    generating: '正在生成',
    ready: '生成完成',
    error: '生成失败',
    cancelled: '已取消',
};

const featureTaskMeta = {
    'phone-plan': ['规划通话', '电话'],
    'phone-regenerate': ['重新规划通话', '电话'],
    'phone-audio': ['生成通话语音', '电话'],
    'chat-reply': ['生成角色回复', '聊天'],
    'phone-chat-proactive': ['生成角色主动消息', '聊天'],
    'drawing-tags': ['生成绘图 Tag', '绘画'],
    'novelai-draw': ['NovelAI 绘制', '绘画'],
    'group-chat-reply': ['生成群聊回复', '群聊'],
    'group-chat-audio': ['生成群聊语音', '群聊'],
    'chat-call': ['规划聊天通话', '聊天'],
    'chat-audio': ['生成聊天语音', '聊天'],
    'prompt-lab': ['试运行提示词', '提示词实验室'],
};

function persistVoiceNotifications() {
    try {
        localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(state.notifications.slice(0, 100)));
    } catch (error) {
        console.warn('[TTS Console] 通知记录保存失败。', error);
    }
}

function addVoiceNotification({ level = 'info', title, body = '', route = '', dedupeKey = '' } = {}) {
    const notificationTitle = String(title || '').trim();
    if (!notificationTitle) return null;
    if (dedupeKey && state.notifications.some(item => item.dedupeKey === dedupeKey)) return null;
    const item = {
        id: `notice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        level: ['success', 'error', 'warning'].includes(level) ? level : 'info',
        title: notificationTitle.slice(0, 100),
        body: String(body || '').trim().slice(0, 500),
        route: String(route || '').trim(),
        dedupeKey: String(dedupeKey || '').trim(),
        read: false,
        createdAt: new Date().toISOString(),
    };
    state.notifications.unshift(item);
    state.notifications = state.notifications.slice(0, 100);
    persistVoiceNotifications();
    return item;
}

function markVoiceNotificationRead(id) {
    const item = state.notifications.find(notification => notification.id === id);
    if (!item || item.read) return item || null;
    item.read = true;
    persistVoiceNotifications();
    return item;
}

function unreadVoiceNotificationCount() {
    return state.notifications.filter(item => !item.read).length;
}

function syncTaskNotifications(detail = {}) {
    for (const task of detail.snapshot?.tasks || []) {
        if (!['ready', 'error'].includes(task.status)) continue;
        const timestamp = Number(task.finishedAt || task.updatedAt || 0);
        if (timestamp < NOTIFICATION_SESSION_STARTED_AT) continue;
        const failed = task.status === 'error';
        addVoiceNotification({
            level: failed ? 'error' : 'success',
            title: failed ? `${task.title || '语音'}生成失败` : `${task.title || '语音'}已生成`,
            body: failed ? (task.error || '可以前往任务中心重试。') : (task.text || task.source || '语音任务已完成。'),
            route: 'tasks',
            dedupeKey: `task:${task.key}:${task.status}:${timestamp}`,
        });
    }
}

function syncFrontendToolNotification(detail = {}) {
    const records = {
        'phone-plan': ['success', '通话已生成', '可以进入电话 APP 或追踪 APP 回放。', 'tracks'],
        'group-phone-plan': ['success', '多人通话已生成', '可以进入追踪 APP 回放。', 'tracks'],
        'call-favorite': ['info', '通话收藏已更新', '进入追踪 APP 查看你的收藏。', 'tracks'],
        'prompt-workflow-import': ['success', '提示词预设已导入', '导入的条目已经可以使用。', 'prompt-lab'],
        'backup-restored': ['success', '手机数据已恢复', '配置与记录已经重新载入。', 'backup'],
    };
    const mapped = records[detail.type];
    if (mapped) {
        addVoiceNotification({
            level: mapped[0],
            title: mapped[1],
            body: mapped[2],
            route: mapped[3],
            dedupeKey: `${detail.type}:${detail.id || detail.kinds?.join('-') || Date.now()}`,
        });
    }
    if (detail.type === 'phone-chat-message' && detail.sender === 'character' && state.route !== 'chat') {
        const chat = detail.snapshot?.phoneChat;
        const message = [...(chat?.thread?.messages || [])].reverse().find(item => item.sender === 'character');
        addVoiceNotification({
            level: 'info',
            title: `${chat?.thread?.charName || '角色'}发来新消息`,
            body: message?.translation || message?.content || '打开聊天查看消息。',
            route: 'chat',
            dedupeKey: `chat:${message?.id || detail.messageIds?.join('-') || Date.now()}`,
        });
    }
    if (detail.type === 'group-chat-message' && detail.sender === 'character' && state.route !== 'group-chat') {
        const groupChat = detail.snapshot?.groupChat;
        const group = groupChat?.groups?.find(item => item.id === detail.groupId) || groupChat?.activeGroup;
        const message = [...(group?.messages || [])].reverse().find(item => item.sender === 'character');
        addVoiceNotification({
            level: 'info',
            title: `${group?.name || '群聊'}有新消息`,
            body: `${message?.speaker ? `${message.speaker}：` : ''}${message?.translation || message?.content || '打开群聊查看消息。'}`,
            route: 'groups',
            dedupeKey: `group:${message?.id || detail.messageIds?.join('-') || Date.now()}`,
        });
    }
}

function syncProviderNotification(detail = {}) {
    if (detail.type !== 'runtime' || !detail.providerId) return;
    const provider = detail.snapshot?.providers?.find(item => item.id === detail.providerId);
    if (provider?.runtime?.status !== 'error') return;
    addVoiceNotification({
        level: 'error',
        title: `${provider.name} 连接异常`,
        body: provider.runtime.message || '请检查引擎配置。',
        route: 'engines',
        dedupeKey: `provider:${provider.id}:${provider.runtime.checkedAt || Date.now()}`,
    });
}

function createVoiceBackupBundle() {
    return {
        format: 'sillytavern-tts-pocket-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        secretsExcluded: true,
        registry: TTS_ProviderRegistry.exportBackupData(),
        frontend: FrontendVoiceTools.exportBackupData(),
    };
}

function restoreVoiceBackupBundle(payload, { keepRollback = true } = {}) {
    const source = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (!source || source.format !== 'sillytavern-tts-pocket-backup' || !source.registry || !source.frontend) {
        throw new Error('这不是可识别的语音手机完整备份。');
    }
    const previous = createVoiceBackupBundle();
    try {
        TTS_ProviderRegistry.importBackupData(source.registry);
        FrontendVoiceTools.importBackupData(source.frontend);
    } catch (error) {
        TTS_ProviderRegistry.importBackupData(previous.registry);
        FrontendVoiceTools.importBackupData(previous.frontend);
        throw error;
    }
    if (keepRollback) state.restoreRollback = previous;
    const ui = TTS_ProviderRegistry.getUiSettings();
    state.theme = ui.theme || 'system';
    state.homePage = Number(ui.homePage) === 1 ? 1 : 0;
    applyTheme(state.theme, false);
    return source;
}

function getSnapshot() {
    return TTS_ProviderRegistry.getSnapshot();
}

function currentProvider() {
    const snapshot = getSnapshot();
    return snapshot.providers.find(item => item.id === (state.providerId || snapshot.activeProvider))
        || snapshot.providers[0];
}

function currentMotionActivity() {
    if (state.route === 'incoming' && ['ringing', 'connecting', 'active'].includes(state.phoneStage)) return 'call';
    if (state.phoneAudioElement || state.toolAudioElement || state.chatAudioElement) return 'playing';
    if (state.featureBusy || state.previewController) return 'generating';
    return 'idle';
}

function syncPhoneMotion({ animateRoute = false } = {}) {
    motionRuntime?.sync({
        open: state.open,
        route: state.route,
        renderKey: currentRenderKey(),
        activity: currentMotionActivity(),
        animateRoute,
    });
}

function providerCard(provider, activeProvider) {
    const isActive = provider.id === activeProvider;
    const runtime = provider.runtime || { status: 'idle', message: provider.mode };
    return `
        <button class="voice-provider-card provider-${provider.id}${isActive ? ' is-active' : ''}"
            id="tts-provider-card-${provider.id}" type="button" data-open-provider="${provider.id}">
            <span class="provider-emblem">${icon(provider.icon, 20)}</span>
            <span class="provider-card-copy">
                <strong>${safe(provider.name)}</strong>
                <small>${isActive ? '当前引擎' : safe(provider.mode)}</small>
            </span>
            <span class="provider-state state-${safe(runtime.status)}" aria-label="${safe(statusText[runtime.status] || runtime.status)}">
                <i aria-hidden="true"></i>
            </span>
            ${icon('chevronRight', 16)}
        </button>`;
}

function getGenerationTaskSnapshot() {
    const schedulerSnapshot = window.TTS_Scheduler?.getTaskSnapshot?.() || {
        paused: false,
        running: false,
        queueLength: 0,
        counts: {},
        tasks: [],
    };
    const feature = featureTaskMeta[state.featureBusy];
    const liveTasks = feature ? [{
        key: `mobile:${state.featureBusy}`,
        kind: 'feature',
        title: feature[0],
        source: feature[1],
        character: FrontendVoiceTools.getContextSnapshot().charName || '',
        providerId: getSnapshot().activeProvider,
        text: '',
        status: 'generating',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        transient: true,
    }] : [];
    const tasks = [...liveTasks, ...(schedulerSnapshot.tasks || [])];
    const counts = tasks.reduce((result, task) => {
        result[task.status] = (result[task.status] || 0) + 1;
        return result;
    }, {});
    return { ...schedulerSnapshot, counts, tasks };
}

function renderHomePageButton(page, label) {
    const active = state.homePage === page;
    return `<button type="button" data-set-home-page="${page}" class="${active ? 'is-active' : ''}" aria-label="${label}" aria-current="${active ? 'page' : 'false'}"><i></i></button>`;
}

function themeLabel(theme) {
    return ({ system: '跟随酒馆主题', dark: '夜间主题', light: '日间主题' })[theme] || '跟随酒馆主题';
}

function renderHome() {
    const snapshot = getSnapshot();
    const tools = FrontendVoiceTools.getSnapshot();
    const active = snapshot.providers.find(item => item.id === snapshot.activeProvider) || snapshot.providers[0];
    const currentRole = tools.context.charName || '当前角色';
    const chatMessages = tools.phoneChat?.thread?.messages || [];
    const customWallpaper = TTS_ProviderRegistry.getUiSettings().customTheme?.wallpaper || '';
    const wallpaper = customWallpaper
        ? `<img class="voice-desktop-wallpaper" src="${safe(customWallpaper)}" alt="">`
        : tools.context.avatarUrl
            ? `<img class="voice-desktop-wallpaper" src="${safe(tools.context.avatarUrl)}" alt="">`
            : '';
    const taskSnapshot = getGenerationTaskSnapshot();
    const activeTasks = Number(taskSnapshot.counts.generating || 0) + Number(taskSnapshot.counts.queued || 0);
    const contacts = tools.contacts || FrontendVoiceTools.getVoiceContacts?.() || [];
    const unreadNotifications = unreadVoiceNotificationCount();
    const groupChats = tools.groupChat?.groups || [];

    return `
        <section class="voice-home-view voice-phone-desktop" aria-labelledby="voice-home-heading">
            <h1 id="voice-home-heading" class="sr-only">语音主页</h1>
            ${wallpaper}
            <div class="voice-desktop-tint" aria-hidden="true"></div>
            <canvas class="voice-motion-canvas" data-voice-motion-canvas aria-hidden="true"></canvas>
            <div class="voice-home-pages" data-home-pages data-home-page="0" tabindex="0" aria-label="手机桌面，共一页">
                <div class="voice-home-pages-track">
                    <section class="voice-home-page" data-home-page-panel="0" aria-label="手机桌面" aria-hidden="false">
                        <section class="voice-desktop-widget" aria-label="手机概览">
                            <div><time data-home-clock></time><small id="tts-home-date"></small></div>
                            <span><small>当前聊天</small><strong>${safe(currentRole)}</strong><em>${chatMessages.length} 条手机消息</em></span>
                        </section>
                        <nav class="voice-os-app-grid" aria-label="常用应用">
                            <button id="tts-app-chat" class="app-chat" type="button" data-route="qq"><span>${icon('messageCircle', 25)}</span><strong>QQ</strong><small>${chatMessages.length ? `${chatMessages.length} 条` : '角色私聊'}</small></button>
                            <button id="tts-feature-incoming" class="app-call" type="button" data-open-panel="incoming"><span>${icon('phone', 25)}</span><strong>电话</strong><small>${tools.calls.length} 通</small></button>
                            <button id="tts-app-contacts" class="app-contacts" type="button" data-route="contacts"><span>${icon('users', 25)}</span><strong>通讯录</strong><small>${contacts.length} 位角色</small></button>
                            <button id="tts-feature-eavesdrop" class="app-track" type="button" data-route="tracks"><span>${icon('headphones', 25)}</span><strong>追踪</strong><small>${tools.calls.length} 通</small></button>
                            <button id="tts-app-engines" class="app-engine provider-${safe(active.id)}" type="button" data-route="engines"><span>${icon(active.icon, 25)}</span><strong>引擎</strong><small>${safe(active.name)}</small></button>
                            <button id="tts-app-drawing" class="app-drawing" type="button" data-route="drawing"><span>${icon('edit', 25)}</span><strong>绘画</strong><small>NovelAI 文生图</small></button>
                            <button id="tts-app-themes" class="app-themes" type="button" data-route="themes"><span>${icon('sun', 25)}</span><strong>主题</strong><small>${themeLabel(state.theme)}</small></button>
                            <button id="tts-app-settings" class="app-settings" type="button" data-route="settings"><span>${icon('settings', 25)}</span><strong>设置</strong><small>手机与编排</small></button>
                        </nav>
                    </section>
                </div>
            </div>
            <article class="voice-desktop-now provider-${safe(active.id)}">
                <span>${icon('radio', 17)}</span><div><small>语音服务</small><strong>${safe(currentRole)} · ${safe(active.name)}</strong></div><i aria-label="语音服务可用"></i>
            </article>
        </section>`;
}

function qqFriendAvatar(friend) {
    return `<span class="voice-qq-avatar" aria-hidden="true">${safe(String(friend?.name || '友').slice(0, 1))}</span>`;
}

function renderQqApp() {
    const tools = FrontendVoiceTools.getSnapshot();
    const context = tools.context;
    const contacts = tools.contacts || FrontendVoiceTools.getVoiceContacts?.() || [];
    const qq = TTS_ProviderRegistry.getQqState();
    const friends = Array.isArray(qq.friends) ? qq.friends : [];
    const groups = Array.isArray(qq.groups) ? qq.groups : [];
    const threadMessages = tools.phoneChat?.thread?.messages || [];
    const currentName = context.charName || '当前角色';
    const lastPreview = threadMessages.length ? chatMessagePreview(threadMessages[threadMessages.length - 1]) : '暂无消息';
    const addable = contacts.filter(contact => contact.name && contact.name !== currentName
        && !friends.some(friend => friend.name === contact.name)).slice(0, 40);
    const openGroup = state.qqOpenGroup ? groups.find(group => group.id === state.qqOpenGroup) : null;
    const draft = state.qqGroupDraft || { name: '', members: [] };
    const memberCandidates = friends.filter(friend => friend.name && friend.name !== currentName);
    const hiddenCurrent = TTS_ProviderRegistry.getUiSettings().hiddenCurrentCharName === currentName;
    return `
        <section class="voice-secondary-view voice-qq-app" aria-labelledby="voice-qq-heading">
            <h1 id="voice-qq-heading">QQ</h1>
            <section class="voice-qq-recent" aria-label="最近会话">
                <button type="button" data-route="chat">
                    ${renderCallerAvatar(context)}
                    <span class="voice-qq-copy"><strong>${safe(currentName)}</strong><small>${safe(lastPreview)}</small></span>
                    ${icon('chevronRight', 16)}
                </button>
            </section>
            <section class="voice-qq-section" aria-label="好友">
                <header><strong>好友</strong><span>${friends.length + 1} 位</span><button type="button" data-qq-add-friend aria-pressed="${state.qqAddFriendOpen}">${icon('plus', 15)} 添加好友</button></header>
                <div class="voice-qq-list">
                    ${hiddenCurrent ? `
                    <div class="voice-qq-row is-current is-hidden">
                        ${qqFriendAvatar({ name: currentName })}
                        <span class="voice-qq-copy"><strong>${safe(currentName)}</strong><small>已删除 · 切换角色卡或新开聊天后自动恢复</small></span>
                        <button type="button" data-qq-restore-current>${icon('undo', 14)} 恢复</button>
                    </div>` : `
                    <div class="voice-qq-row is-current">
                        <button type="button" class="voice-qq-open" data-route="chat">
                            ${qqFriendAvatar({ name: currentName })}
                            <span class="voice-qq-copy"><strong>${safe(currentName)}</strong><small>当前角色卡 · 私聊</small></span>
                            <i>当前</i>
                        </button>
                        <button type="button" class="voice-qq-row-action" data-qq-hide-current aria-label="删除好友 ${safe(currentName)}">${icon('trash', 14)}</button>
                    </div>`}
                    ${friends.map(friend => `<button type="button" class="voice-qq-row" data-qq-open-friend="${safe(friend.name)}">
                        ${qqFriendAvatar(friend)}
                        <span class="voice-qq-copy"><strong>${safe(friend.name)}</strong><small>${friend.addedAt ? `添加于 ${formatToolTime(friend.addedAt)}` : '好友'}</small></span>
                        ${icon('chevronRight', 15)}
                    </button>`).join('')}
                </div>
                ${state.qqAddFriendOpen ? `
                <div class="voice-qq-picker" data-qq-friend-picker>
                    <header><span>从通讯录选择好友</span><button type="button" data-qq-close-picker aria-label="关闭">${icon('close', 15)}</button></header>
                    <div class="voice-qq-list">
                        ${addable.length ? addable.map(contact => `<button type="button" class="voice-qq-row" data-qq-pick-friend="${safe(contact.name)}">
                            ${qqFriendAvatar(contact)}
                            <span class="voice-qq-copy"><strong>${safe(contact.name)}</strong><small>${contact.configured ? `${safe(contact.providerName)} · 已配声线` : '通讯录联系人'}</small></span>
                            ${icon('plus', 15)}
                        </button>`).join('') : `<p class="voice-qq-picker-empty">没有可添加的联系人。</p>`}
                    </div>
                </div>` : ''}
            </section>
            <section class="voice-qq-section" aria-label="群聊">
                <header><strong>群聊</strong><span>${groups.length} 个</span><button type="button" data-qq-create-group aria-pressed="${state.qqGroupFormOpen}">${icon('plus', 15)} 创建群聊</button></header>
                <div class="voice-qq-list">
                    ${groups.length ? groups.map(group => `<button type="button" class="voice-qq-row" data-qq-open-group="${safe(group.id)}">
                        <span class="voice-qq-avatar is-group" aria-hidden="true">${icon('users', 16)}</span>
                        <span class="voice-qq-copy"><strong>${safe(group.name)}</strong><small>${group.members.length} 名成员</small></span>
                        ${icon('chevronRight', 15)}
                    </button>`).join('') : `<p class="voice-qq-list-empty">还没有群聊，点右上角创建。</p>`}
                </div>
                ${state.qqGroupFormOpen ? `
                <form class="voice-qq-picker" data-qq-group-form>
                    <header><span>创建群聊</span><button type="button" data-qq-close-picker aria-label="关闭">${icon('close', 15)}</button></header>
                    <label class="voice-qq-group-name"><span>群名称</span><input name="groupName" type="text" maxlength="40" value="${safe(draft.name)}" placeholder="例如：深夜电台群"></label>
                    <div class="voice-qq-list">
                        ${memberCandidates.length ? memberCandidates.map(friend => `<label class="voice-qq-row">
                            ${qqFriendAvatar(friend)}
                            <span class="voice-qq-copy"><strong>${safe(friend.name)}</strong><small>好友</small></span>
                            <input type="checkbox" name="member" value="${safe(friend.name)}" ${draft.members.includes(friend.name) ? 'checked' : ''}><i></i>
                        </label>`).join('') : `<p class="voice-qq-picker-empty">先添加好友，才能创建群聊。</p>`}
                    </div>
                    <button class="voice-button primary wide" type="submit">${icon('check', 16)} 创建群聊</button>
                </form>` : ''}
            </section>
            ${openGroup ? `
            <section class="voice-qq-group-detail" aria-label="${safe(openGroup.name)}">
                <header><button type="button" data-qq-close-group aria-label="返回群聊列表">${icon('arrowLeft', 16)}</button><strong>${safe(openGroup.name)}</strong><span>${openGroup.members.length} 名成员</span></header>
                <div class="voice-qq-list">
                    <button type="button" class="voice-qq-row is-current" data-route="chat">
                        ${qqFriendAvatar({ name: currentName })}
                        <span class="voice-qq-copy"><strong>${safe(currentName)}</strong><small>群主</small></span><i>当前</i>
                    </button>
                    ${openGroup.members.map(name => `<button type="button" class="voice-qq-row" data-qq-open-friend="${safe(name)}">
                        ${qqFriendAvatar({ name })}
                        <span class="voice-qq-copy"><strong>${safe(name)}</strong><small>群成员</small></span>
                        ${icon('messageCircle', 15)}
                    </button>`).join('')}
                </div>
            </section>` : ''}
        </section>`;
}

function renderTaskCenter() {
    const snapshot = getGenerationTaskSnapshot();
    const providers = new Map(getSnapshot().providers.map(provider => [provider.id, provider.name]));
    const generating = Number(snapshot.counts.generating || 0);
    const queued = Number(snapshot.counts.queued || 0);
    const failed = Number(snapshot.counts.error || 0);
    const tasks = snapshot.tasks.slice(0, 60);
    return `
        <section class="voice-secondary-view voice-task-center" aria-labelledby="voice-task-center-heading">
            <h1 id="voice-task-center-heading">任务中心</h1>
            <section class="voice-task-overview" aria-label="语音任务概览">
                <div class="is-generating"><span>${generating}</span><small>生成中</small></div>
                <div class="is-queued"><span>${queued}</span><small>等待</small></div>
                <div class="is-error"><span>${failed}</span><small>失败</small></div>
            </section>
            <div class="voice-task-toolbar" role="group" aria-label="任务队列控制">
                <button type="button" data-task-action="${snapshot.paused ? 'resume' : 'pause'}" aria-pressed="${snapshot.paused}">
                    ${icon(snapshot.paused ? 'play' : 'pause', 16)}<span>${snapshot.paused ? '继续队列' : '暂停队列'}</span>
                </button>
                <button type="button" data-task-action="cancel-pending" ${queued ? '' : 'disabled'}>${icon('close', 16)}<span>取消等待</span></button>
                <button type="button" data-task-action="clear-finished" ${snapshot.counts.ready || snapshot.counts.cancelled ? '' : 'disabled'}>${icon('trash', 16)}<span>清理完成</span></button>
            </div>
            ${snapshot.paused ? `<p class="voice-task-pause-note">${generating ? '当前任务完成后暂停' : '队列已暂停'}</p>` : ''}
            <div class="voice-task-list" data-preserve-scroll="generation-task-list">
                ${tasks.length ? tasks.map(task => {
        const providerName = providers.get(task.providerId) || task.providerId || '前端编排';
        const cancellable = !task.transient && ['queued', 'generating'].includes(task.status);
        const retryable = !task.transient && ['error', 'cancelled'].includes(task.status);
        return `<article class="voice-task-card state-${safe(task.status)}" data-generation-task="${safe(task.key)}">
                        <header><span><i></i>${safe(generationTaskStatusText[task.status] || task.status)}</span><time>${safe(formatToolTime(task.updatedAt))}</time></header>
                        <div class="voice-task-card-main">
                            <span>${icon(task.kind === 'feature' ? 'spark' : 'waveform', 19)}</span>
                            <div><strong>${safe(task.title || '语音生成')}</strong><small>${safe(task.source || '正文 TTS')} · ${safe(providerName)}</small></div>
                        </div>
                        ${task.text ? `<p>${safe(task.text)}</p>` : ''}
                        ${task.error && task.status === 'error' ? `<p class="voice-task-error">${safe(task.error)}</p>` : ''}
                        ${cancellable || retryable ? `<footer>
                            ${cancellable ? `<button type="button" data-task-cancel="${safe(task.key)}">${icon('close', 15)} 取消</button>` : ''}
                            ${retryable ? `<button type="button" data-task-retry="${safe(task.key)}">${icon('repeat', 15)} 重试</button>` : ''}
                        </footer>` : ''}
                    </article>`;
    }).join('') : `<div class="voice-tool-empty voice-task-empty">${icon('tasks', 25)}<strong>暂时没有生成任务</strong></div>`}
            </div>
        </section>`;
}

function renderContactAvatar(contact) {
    return contact.avatarUrl
        ? `<img src="${safe(contact.avatarUrl)}" alt="">`
        : `<span>${safe(contact.name.slice(0, 1) || '角')}</span>`;
}

function renderContactsApp() {
    const tools = FrontendVoiceTools.getSnapshot();
    const contacts = tools.contacts || FrontendVoiceTools.getVoiceContacts?.() || [];
    return `
        <section class="voice-secondary-view voice-contacts-app" aria-labelledby="voice-contacts-heading">
            <h1 id="voice-contacts-heading">通讯录</h1>
            <section class="voice-contacts-summary" aria-label="角色资源概览">
                <div><strong>${contacts.length}</strong><small>联系人</small></div>
                <div><strong>${contacts.filter(item => item.configured).length}</strong><small>已配声线</small></div>
                <div><strong>${contacts.filter(item => item.favorite).length}</strong><small>绑定收藏</small></div>
            </section>
            <label class="voice-tool-search voice-contact-search" for="tts-contact-search">
                ${icon('search', 17)}<span>搜索联系人</span>
                <input id="tts-contact-search" type="search" autocomplete="off" aria-label="搜索联系人">
                <kbd id="tts-contact-count">${contacts.length}</kbd>
            </label>
            <div class="voice-contact-list" data-preserve-scroll="voice-contact-list">
                ${contacts.length ? contacts.map(contact => {
        const expanded = state.contactName === contact.name;
        const searchText = `${contact.name} ${contact.providerName} ${contact.voice} ${contact.favorite?.name || ''}`.toLocaleLowerCase('zh-CN');
        return `<article class="voice-contact-card${expanded ? ' is-expanded' : ''}" data-contact-item data-contact-search="${safe(searchText)}">
                        <button type="button" data-contact-toggle="${safe(contact.name)}" aria-expanded="${expanded}">
                            <span class="voice-contact-avatar">${renderContactAvatar(contact)}</span>
                            <span class="voice-contact-copy">
                                <strong>${safe(contact.name)}${contact.current ? '<i>当前</i>' : ''}</strong>
                                <small>${safe(contact.configured ? `${contact.providerName}${contact.voice ? ` · ${contact.voice}` : ''}` : '尚未配置声线')}</small>
                            </span>
                            <span class="voice-contact-state${contact.configured ? ' is-ready' : ''}" aria-label="${contact.configured ? '已配置声线' : '未配置声线'}"></span>
                            ${icon('chevronRight', 16)}
                        </button>
                        ${expanded ? `<div class="voice-contact-details">
                            <dl>
                                <div><dt>路由</dt><dd>${safe(contact.configured ? contact.providerName : '默认')}</dd></div>
                                <div><dt>收藏</dt><dd>${safe(contact.favorite?.name || '未绑定')}</dd></div>
                                <div><dt>消息</dt><dd>${contact.messageCount}</dd></div>
                            </dl>
                            ${contact.lastMessage ? `<p>${safe(contact.lastMessage)}</p>` : ''}
                            <div class="voice-contact-actions">
                                ${contact.current ? `<button type="button" data-contact-open-chat="${safe(contact.name)}">${icon('messageCircle', 15)} 聊天</button>` : ''}
                                <button type="button" data-contact-open-route="${safe(contact.name)}">${icon('sliders', 15)} 声线路由</button>
                                <button type="button" data-contact-open-favorites>${icon('bookmark', 15)} 声线收藏</button>
                            </div>
                        </div>` : ''}
                    </article>`;
    }).join('') : `<div class="voice-tool-empty voice-contact-empty">${icon('users', 25)}<strong>暂无联系人</strong></div>`}
                <p id="tts-contact-empty" hidden>没有符合条件的联系人。</p>
            </div>
        </section>`;
}

function renderEnginesApp() {
    const snapshot = getSnapshot();
    return `
        <section class="voice-secondary-view voice-engine-app" aria-labelledby="voice-engine-heading">
            <h1 id="voice-engine-heading">语音引擎</h1>
            <div class="voice-section-heading compact">
                <div><span>服务列表</span><h2>切换当前引擎</h2></div>
                <button id="tts-check-all-providers" type="button" data-check-all aria-label="检测所有引擎">${icon('refresh', 17)}</button>
            </div>
            <div class="voice-provider-grid">${snapshot.providers.map(provider => providerCard(provider, snapshot.activeProvider)).join('')}</div>
            <button class="voice-route-shortcut" id="tts-engine-character-routes" type="button" data-route="library">
                ${icon('library', 18)}<span><strong>角色专属路由</strong></span>${icon('chevronRight', 16)}
            </button>
        </section>`;
}

function renderField(provider, field) {
    const value = provider.settings[field.key] ?? '';
    const fieldId = `tts-field-${provider.id}-${field.key}`;
    if (field.type === 'secret') {
        return `
            <div class="voice-field secret-field">
                <span class="voice-field-label">${safe(field.label)}</span>
                <button id="${fieldId}" class="manage-api-keys voice-secret-button" type="button" data-key="${safe(field.dataKey)}">
                    ${icon('key', 18)}<span>${provider.vaultSecretsReady ? '已存入安全保险箱' : '打开密钥保险箱'}</span>${icon('chevronRight', 16)}
                </button>
            </div>`;
    }
    if (field.type === 'switch') {
        return `
            <label class="voice-field switch-field" for="${fieldId}">
                <span><b>${safe(field.label)}</b>${field.help ? `<small>${safe(field.help)}</small>` : ''}</span>
                <input id="${fieldId}" name="${safe(field.key)}" type="checkbox" ${value ? 'checked' : ''}>
                <i aria-hidden="true"></i>
            </label>`;
    }
    if (field.type === 'select') {
        return `
            <label class="voice-field" for="${fieldId}">
                <span class="voice-field-label">${safe(field.label)}</span>
                <select id="${fieldId}" name="${safe(field.key)}">
                    ${(field.options || []).map(([key, label]) => `<option value="${safe(key)}" ${String(value) === String(key) ? 'selected' : ''}>${safe(label)}</option>`).join('')}
                </select>
                ${field.help ? `<small>${safe(field.help)}</small>` : ''}
            </label>`;
    }
    if (field.type === 'combo') {
        const listId = `${fieldId}-options`;
        return `
            <label class="voice-field" for="${fieldId}">
                <span class="voice-field-label">${safe(field.label)}</span>
                <input id="${fieldId}" name="${safe(field.key)}" type="text" list="${listId}" value="${safe(value)}" autocomplete="off">
                <datalist id="${listId}">
                    ${(field.options || []).map(([key, label]) => `<option value="${safe(key)}">${safe(label)}</option>`).join('')}
                </datalist>
                ${field.help ? `<small>${safe(field.help)}</small>` : ''}
            </label>`;
    }
    if (field.type === 'range') {
        return `
            <label class="voice-field range-field" for="${fieldId}">
                <span class="voice-field-label">${safe(field.label)} <output id="${fieldId}-output">${safe(value)}</output></span>
                <input id="${fieldId}" name="${safe(field.key)}" type="range" value="${safe(value)}"
                    min="${field.min}" max="${field.max}" step="${field.step}" data-range-output="${fieldId}-output">
            </label>`;
    }
    return `
        <div class="voice-field-stack">
            <label class="voice-field" for="${fieldId}">
                <span class="voice-field-label">${safe(field.label)}</span>
                <input id="${fieldId}" name="${safe(field.key)}" type="${field.type === 'url' ? 'url' : field.type === 'password' ? 'password' : 'text'}" value="${safe(value)}" autocomplete="off">
                ${field.help ? `<small>${safe(field.help)}</small>` : ''}
            </label>
            ${field.info ? `
                <details class="voice-info-popover">
                    <summary id="${fieldId}-info" aria-label="查看${safe(field.label)}填写说明">${icon('info', 14)} 填写说明</summary>
                    <p>${safe(field.info)}</p>
                </details>` : ''}
    </div>`;
}

const miniMaxVoiceCategoryNames = {
    system: '系统音色',
    cloning: '快速复刻',
    generation: '音色设计',
    music: '音乐音色',
    custom: '手动填写',
};

function renderMiniMaxResources(provider) {
    const catalog = TTS_ProviderRegistry.getMiniMaxCatalog();
    const isDirect = provider.settings.credentialMode !== 'vault';
    const syncedDate = catalog.syncedAt ? new Date(catalog.syncedAt) : null;
    const syncedText = syncedDate && Number.isFinite(syncedDate.getTime())
        ? new Intl.DateTimeFormat('zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        }).format(syncedDate)
        : '尚未同步账户';
    const categoryCounts = catalog.voices.reduce((counts, voice) => {
        counts[voice.category] = (counts[voice.category] || 0) + 1;
        return counts;
    }, {});
    const filterButtons = [
        ['all', '全部', catalog.voices.length],
        ['system', '系统', categoryCounts.system || 0],
        ['cloning', '复刻', categoryCounts.cloning || 0],
        ['generation', '设计', categoryCounts.generation || 0],
    ];

    return `
        <input id="tts-field-minimax-model" name="model" type="hidden" value="${safe(provider.settings.model)}">
        <input id="tts-field-minimax-voice" name="voice" type="hidden" value="${safe(provider.settings.voice)}">
        <details class="minimax-start-card">
            <summary id="tts-minimax-start-title">
                <span class="minimax-start-mark">${icon('orbit', 20)}<b>MINIMAX</b></span>
                <strong>首次设置</strong><small>3 步</small>${icon('chevronRight', 15)}
            </summary>
            <div class="minimax-start-body">
                <div class="minimax-steps">
                    <div><i>01</i><strong>${isDirect ? '填写 API Key' : '保存 API Key'}</strong></div>
                    <div><i>02</i><strong>同步账户资源</strong></div>
                    <div><i>03</i><strong>选择并试听</strong></div>
                </div>
                <details class="minimax-device-note">
                    <summary id="tts-minimax-device-note-toggle">${icon('info', 14)} 连接方式</summary>
                    <p>${isDirect
                        ? '浏览器直连，密钥保存在当前 SillyTavern 用户设置中。'
                        : '保险箱代理，需要安装随扩展提供的服务插件。'}</p>
                </details>
            </div>
        </details>
        <section class="minimax-resource-hub" aria-labelledby="tts-minimax-resource-title">
            <header>
                <div>
                    <span>账户资源</span>
                    <h2 id="tts-minimax-resource-title">模型与音色库</h2>
                    <small>${safe(syncedText)} · ${catalog.models.length} 个语音模型 · ${catalog.voices.length} 个音色</small>
                </div>
                <button id="tts-minimax-sync-resources" type="button" data-minimax-sync ${provider.secretsReady ? '' : 'disabled'}>
                    ${icon('refresh', 16)}<span>同步官方资源</span>
                </button>
            </header>
            ${catalog.warnings.length ? `
                <div class="minimax-resource-notice">${icon('info', 15)}<span>${safe(catalog.warnings.join('；'))}</span></div>
            ` : ''}
            <div class="minimax-resource-heading">
                <div><span>模型目录</span></div>
                <b>${safe(provider.settings.model)}</b>
            </div>
            <div class="minimax-model-rail" role="list" aria-label="MiniMax 语音模型">
                ${catalog.models.map(model => `
                    <button id="tts-minimax-model-${safe(model.id).replace(/[^a-zA-Z0-9_-]/g, '-')}" type="button"
                        class="${model.id === provider.settings.model ? 'is-selected' : ''}"
                        data-minimax-resource="model" data-minimax-resource-id="${safe(model.id)}" role="listitem">
                        <span>${model.id.startsWith('speech-2.8') ? '最新' : '可用'}</span>
                        <strong>${safe(model.name || model.id)}</strong>
                        <small>${safe(model.note || 'MiniMax 语音模型')}</small>
                        ${icon('chevronRight', 14)}
                    </button>
                `).join('')}
            </div>
            <div class="minimax-resource-heading voices">
                <div><span>音色目录</span></div>
                <b>${catalog.voices.length}</b>
            </div>
            <label class="minimax-search" for="tts-minimax-voice-search">
                ${icon('search', 17)}
                <span>搜索音色</span>
                <input id="tts-minimax-voice-search" type="search" autocomplete="off" aria-label="搜索音色名称或 Voice ID">
                <kbd id="tts-minimax-voice-visible-count">${catalog.voices.length}</kbd>
            </label>
            <div class="minimax-voice-filters" role="group" aria-label="筛选音色类型">
                ${filterButtons.map(([key, label, count], index) => `
                    <button id="tts-minimax-filter-${key}" type="button" class="${index === 0 ? 'is-active' : ''}"
                        data-minimax-voice-filter="${key}">${label}<span>${count}</span></button>
                `).join('')}
            </div>
            <div class="minimax-voice-results" id="tts-minimax-voice-results" role="list" aria-label="MiniMax 音色搜索结果">
                ${catalog.voices.map((voice, index) => {
        const favorite = FrontendVoiceTools.isVoiceFavorite('minimax', voice.id);
        return `
                    <article data-minimax-voice-item
                        data-minimax-voice-category="${safe(voice.category || 'custom')}"
                        data-minimax-voice-search="${safe(`${voice.name} ${voice.id} ${voice.description || ''}`.toLowerCase())}"
                        role="listitem">
                        <button id="tts-minimax-voice-${index}" class="minimax-voice-select ${voice.id === provider.settings.voice ? 'is-selected' : ''}" type="button"
                            data-minimax-resource="voice" data-minimax-resource-id="${safe(voice.id)}">
                            <span class="minimax-voice-type">${safe(miniMaxVoiceCategoryNames[voice.category] || '账户音色')}</span>
                            <strong>${safe(voice.name || voice.id)}</strong>
                            <code>${safe(voice.id)}</code>
                            ${voice.description ? `<small>${safe(voice.description)}</small>` : ''}
                            ${icon('check', 15)}
                        </button>
                        <button id="tts-minimax-favorite-${index}" class="minimax-favorite-button${favorite ? ' is-favorite' : ''}" type="button"
                            data-toggle-voice-favorite data-provider-id="minimax" data-voice-id="${safe(voice.id)}"
                            data-voice-name="${safe(voice.name || voice.id)}" data-voice-category="${safe(voice.category || 'custom')}"
                            data-voice-description="${safe(voice.description || '')}" data-voice-model="${safe(provider.settings.model)}"
                            aria-label="${favorite ? '取消收藏' : '收藏'} ${safe(voice.name || voice.id)}" aria-pressed="${favorite}">
                            ${icon('bookmark', 17)}
                        </button>
                    </article>
                `;
    }).join('')}
                <p id="tts-minimax-voice-empty" hidden>没有符合当前搜索条件的音色。</p>
            </div>
        </section>`;
}

function renderElevenLabsResources(provider) {
    const catalog = TTS_ProviderRegistry.getElevenLabsCatalog();
    const syncedDate = catalog.syncedAt ? new Date(catalog.syncedAt) : null;
    const syncedText = syncedDate && Number.isFinite(syncedDate.getTime())
        ? new Intl.DateTimeFormat('zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        }).format(syncedDate)
        : '尚未同步账户';
    return `
        <input id="tts-field-elevenlabs-model" name="model" type="hidden" value="${safe(provider.settings.model)}">
        <input id="tts-field-elevenlabs-voice" name="voice" type="hidden" value="${safe(provider.settings.voice)}">
        <section class="minimax-resource-hub elevenlabs-resource-hub" aria-labelledby="tts-elevenlabs-resource-title">
            <header>
                <div>
                    <span>账户资源</span>
                    <h2 id="tts-elevenlabs-resource-title">ElevenLabs 模型与音色库</h2>
                    <small>${safe(syncedText)} · ${catalog.models.length} 个语音模型 · ${catalog.voices.length} 个账号音色</small>
                </div>
                <button id="tts-elevenlabs-sync-resources" type="button" data-elevenlabs-sync ${provider.secretsReady ? '' : 'disabled'}>
                    ${icon('refresh', 16)}<span>同步账户音色</span>
                </button>
            </header>
            <div class="minimax-resource-heading"><div><span>模型目录</span></div><b>${safe(provider.settings.model)}</b></div>
            <div class="minimax-model-rail" role="list" aria-label="ElevenLabs 语音模型">
                ${catalog.models.map(model => `
                    <button type="button" class="${model.id === provider.settings.model ? 'is-selected' : ''}"
                        data-elevenlabs-resource="model" data-elevenlabs-resource-id="${safe(model.id)}" role="listitem">
                        <span>可用</span><strong>${safe(model.name || model.id)}</strong><small>${safe(model.id)}</small>${icon('chevronRight', 14)}
                    </button>`).join('')}
            </div>
            <div class="minimax-resource-heading voices"><div><span>账号音色</span></div><b>${catalog.voices.length}</b></div>
            <label class="minimax-search" for="tts-elevenlabs-voice-search">
                ${icon('search', 17)}<span>搜索音色</span>
                <input id="tts-elevenlabs-voice-search" type="search" autocomplete="off" aria-label="搜索 ElevenLabs 音色名称或 Voice ID">
                <kbd id="tts-elevenlabs-voice-visible-count">${catalog.voices.length}</kbd>
            </label>
            <div class="minimax-voice-results" id="tts-elevenlabs-voice-results" role="list" aria-label="ElevenLabs 音色搜索结果">
                ${catalog.voices.map((voice, index) => {
        const favorite = FrontendVoiceTools.isVoiceFavorite('elevenlabs', voice.id);
        return `<article data-elevenlabs-voice-item data-elevenlabs-voice-search="${safe(`${voice.name} ${voice.id} ${voice.description || ''}`.toLowerCase())}" role="listitem">
                        <button class="minimax-voice-select ${voice.id === provider.settings.voice ? 'is-selected' : ''}" type="button"
                            data-elevenlabs-resource="voice" data-elevenlabs-resource-id="${safe(voice.id)}">
                            <span class="minimax-voice-type">${safe(voice.category || '账号音色')}</span>
                            <strong>${safe(voice.name || voice.id)}</strong><code>${safe(voice.id)}</code>
                            ${voice.description ? `<small>${safe(voice.description)}</small>` : ''}${icon('check', 15)}
                        </button>
                        <button id="tts-elevenlabs-favorite-${index}" class="minimax-favorite-button${favorite ? ' is-favorite' : ''}" type="button"
                            data-toggle-voice-favorite data-provider-id="elevenlabs" data-voice-id="${safe(voice.id)}"
                            data-voice-name="${safe(voice.name || voice.id)}" data-voice-category="${safe(voice.category || 'account')}"
                            data-voice-description="${safe(voice.description || '')}" data-voice-model="${safe(provider.settings.model)}"
                            aria-label="${favorite ? '取消收藏' : '收藏'} ${safe(voice.name || voice.id)}" aria-pressed="${favorite}">${icon('bookmark', 17)}</button>
                    </article>`;
    }).join('')}
                <p id="tts-elevenlabs-voice-empty" ${catalog.voices.length ? 'hidden' : ''}>检测连接后即可载入账号音色。</p>
            </div>
        </section>`;
}

function renderProviderConsole() {
    const provider = currentProvider();
    const snapshot = getSnapshot();
    const groups = provider.fields.reduce((result, field) => {
        (result[field.group] ||= []).push(field);
        return result;
    }, {});
    const runtime = provider.runtime || { status: 'idle', message: provider.mode };
    const isActive = snapshot.activeProvider === provider.id;
    const isGeneratingPreview = Boolean(state.previewController && state.previewProviderId === provider.id);
    const hasPreviewResult = Boolean(state.previewUrl && state.previewResultProviderId === provider.id);

    return `
        <section class="voice-console-view provider-${provider.id}" aria-labelledby="voice-provider-heading">
            <button class="voice-back-button" id="tts-provider-back" type="button" data-route="home">
                ${icon('arrowLeft', 18)} 返回语音引擎
            </button>
            <header class="voice-console-hero">
                <div class="console-emblem">${icon(provider.icon, 29)}</div>
                <div>
                    <span>${safe(provider.category)}</span>
                    <h1 id="voice-provider-heading">${safe(provider.name)}</h1>
                    <p>${safe(provider.description)}</p>
                </div>
                <span class="console-status state-${safe(runtime.status)}"><i></i>${safe(statusText[runtime.status] || runtime.status)}</span>
            </header>
            <div class="voice-capabilities">
                ${provider.capabilities.map(item => `<span>${icon('check', 13)}${safe(item)}</span>`).join('')}
            </div>
            <form id="tts-provider-form-${provider.id}" class="voice-provider-form" data-provider-form="${provider.id}">
                ${Object.entries(groups)
                    .filter(([group]) => !(['minimax', 'elevenlabs'].includes(provider.id) && ['模型', '声线'].includes(group)))
                    .map(([group, fields]) => `
                    <fieldset>
                        <legend>${safe(group)}</legend>
                        ${fields.map(field => renderField(provider, field)).join('')}
                    </fieldset>
                    ${provider.id === 'minimax' && group === '连接' ? renderMiniMaxResources(provider) : ''}
                    ${provider.id === 'elevenlabs' && group === '凭据' ? renderElevenLabsResources(provider) : ''}`).join('')}
                <div class="voice-form-actions">
                    <button id="tts-save-provider-${provider.id}" class="voice-button primary" type="submit">
                        ${icon('check', 17)} 保存配置
                    </button>
                    <button id="tts-check-provider-${provider.id}" class="voice-button secondary" type="button" data-check-provider="${provider.id}">
                        ${icon('activity', 17)} 检测连接
                    </button>
                </div>
            </form>
            ${provider.id === 'gpt_sovits' ? `
            <aside class="voice-preview-guide" aria-labelledby="tts-preview-title-${provider.id}">
                <div>${icon('waveform', 21)}<span><h2 id="tts-preview-title-${provider.id}">角色试听</h2></span></div>
                <button id="tts-gpt-open-library" type="button" data-route="library">前往角色与声线${icon('chevronRight', 16)}</button>
            </aside>` : `
            <section class="voice-preview-panel" aria-labelledby="tts-preview-title-${provider.id}">
                <div>
                    <span>实时试听</span>
                    <h2 id="tts-preview-title-${provider.id}">检查合成效果</h2>
                </div>
                <label class="sr-only" for="tts-preview-text-${provider.id}">试听文本</label>
                <textarea id="tts-preview-text-${provider.id}" rows="3">${safe(TTS_ProviderRegistry.DEFAULT_PREVIEW_TEXT)}</textarea>
                <button id="tts-preview-provider-${provider.id}" class="voice-preview-button${isGeneratingPreview ? ' is-cancelling' : ''}" type="button" data-preview-provider="${provider.id}" ${provider.preview ? '' : 'disabled'}>
                    ${icon(isGeneratingPreview ? 'close' : 'play', 18)}
                    ${isGeneratingPreview ? '取消生成' : provider.preview ? '生成并试听' : '待接入该服务的生成协议'}
                </button>
                <div id="tts-preview-audio-slot-${provider.id}" class="voice-audio-slot">
                    ${hasPreviewResult ? `<audio id="tts-preview-audio-${provider.id}" controls src="${safe(state.previewUrl)}"></audio>` : ''}
                </div>
            </section>`}
            <button id="tts-activate-provider-${provider.id}" class="voice-activate-button${isActive ? ' is-active' : ''}" type="button" data-activate-provider="${provider.id}">
                ${icon(isActive ? 'check' : 'radio', 18)}
                ${isActive ? '当前默认语音引擎' : '设为默认语音引擎'}
            </button>
        </section>`;
}

function renderLibrary() {
    const snapshot = getSnapshot();
    const names = new Set(Object.keys(snapshot.characterRoutes || {}));
    (snapshot.manualCharacters || []).forEach(name => names.add(name));
    Object.keys(window.TTS_State?.CACHE?.mappings || {}).forEach(name => {
        if (TTS_ProviderRegistry.shouldShowCharacter(name)) names.add(name);
    });
    document.querySelectorAll('.voice-bubble[data-voice-name]').forEach(element => {
        const name = element.getAttribute('data-voice-name')?.trim();
        if (TTS_ProviderRegistry.shouldShowCharacter(name)) names.add(name);
    });
    const characters = [...names].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const route = state.routeCharacter
        ? TTS_ProviderRegistry.resolveRoute(state.routeCharacter)
        : null;
    const active = snapshot.providers.find(item => item.id === snapshot.activeProvider);
    const models = Object.keys(window.TTS_State?.CACHE?.models || {});
    const mappedModel = state.routeCharacter
        ? window.TTS_State?.CACHE?.mappings?.[state.routeCharacter] || ''
        : '';
    const miniMaxCatalog = TTS_ProviderRegistry.getMiniMaxCatalog();
    const miniMaxSettings = TTS_ProviderRegistry.getSettings('minimax');
    const selectedMiniMaxModel = route?.providerId === 'minimax' ? route.model || miniMaxSettings.model : miniMaxSettings.model;
    const selectedMiniMaxVoice = route?.providerId === 'minimax' ? route.voice || miniMaxSettings.voice : miniMaxSettings.voice;
    const elevenLabsCatalog = TTS_ProviderRegistry.getElevenLabsCatalog();
    const elevenLabsSettings = TTS_ProviderRegistry.getSettings('elevenlabs');
    const selectedElevenLabsModel = route?.providerId === 'elevenlabs' ? route.model || elevenLabsSettings.model : elevenLabsSettings.model;
    const selectedElevenLabsVoice = route?.providerId === 'elevenlabs' ? route.voice || elevenLabsSettings.voice : elevenLabsSettings.voice;
    return `
        <section class="voice-secondary-view" aria-labelledby="voice-library-heading">
            <div class="voice-kicker">${icon('library', 15)} 声线路由</div>
            <h1 id="voice-library-heading">角色与声线</h1>
            <article class="route-card"><span>当前默认路由</span><strong>${safe(active.name)}</strong><small>未指定角色声线时使用</small></article>
            <form id="tts-add-character-route-form" class="voice-inline-form" data-add-character-route-form>
                <label for="tts-add-character-name">添加角色</label>
                <input id="tts-add-character-name" name="characterName" type="text" autocomplete="off" aria-describedby="tts-add-character-help">
                <button id="tts-add-character-route" type="submit">${icon('plus', 16)} 添加角色</button>
                <small id="tts-add-character-help">可提前建立路由，也可等待聊天语音标签自动识别。</small>
            </form>
            ${characters.length ? `
                <details class="voice-quick-route-editor">
                    <summary>${icon('sliders', 16)} 批量快速编辑 · ${characters.length} 个角色</summary>
                    <div>
                        <label class="voice-tool-search" for="tts-quick-route-search">
                            ${icon('search', 16)}<span>筛选角色</span>
                            <input id="tts-quick-route-search" type="search" autocomplete="off">
                        </label>
                        <datalist id="tts-quick-route-resource-options">
                            ${[...models, ...miniMaxCatalog.voices.map(item => item.id), ...elevenLabsCatalog.voices.map(item => item.id)].map(value => `<option value="${safe(value)}"></option>`).join('')}
                        </datalist>
                        <div class="voice-quick-route-list">
                            ${characters.map(name => {
                                const savedRoute = snapshot.characterRoutes?.[name];
                                const legacyMappedModel = window.TTS_State?.CACHE?.mappings?.[name] || '';
                                const providerId = savedRoute?.providerId || (legacyMappedModel ? 'gpt_sovits' : snapshot.activeProvider);
                                const resource = providerId === 'gpt_sovits'
                                    ? legacyMappedModel
                                    : savedRoute?.voice || '';
                                return `<form data-quick-character-route="${safe(name)}" data-quick-route-search="${safe(name.toLocaleLowerCase('zh-CN'))}">
                                    <strong>${safe(name)}</strong>
                                    <select name="providerId" aria-label="${safe(name)} 的语音引擎">
                                        ${snapshot.providers.map(provider => `<option value="${provider.id}" ${provider.id === providerId ? 'selected' : ''}>${safe(provider.name)}</option>`).join('')}
                                    </select>
                                    <input name="resource" type="text" list="tts-quick-route-resource-options" value="${safe(resource)}" autocomplete="off" aria-label="${safe(name)} 的音色或模型">
                                    <div class="voice-quick-route-actions">
                                        <button type="submit" aria-label="保存 ${safe(name)} 的快速路由" title="保存路由">${icon('check', 16)}</button>
                                        <button class="is-danger" type="button" data-delete-quick-character="${safe(name)}" aria-label="删除角色 ${safe(name)}" title="删除角色">${icon('trash', 16)}</button>
                                    </div>
                                </form>`;
                            }).join('')}
                        </div>
                    </div>
                </details>` : ''}
            <div class="voice-route-list" data-preserve-scroll="character-route-list" aria-label="已识别角色">
                ${characters.length ? characters.map(name => {
                    const savedRoute = snapshot.characterRoutes?.[name];
                    const provider = snapshot.providers.find(item => item.id === (savedRoute?.providerId || snapshot.activeProvider));
                    const expanded = name === state.routeCharacter;
                    return `<button id="tts-route-character-${encodeURIComponent(name)}" class="${expanded ? 'is-active' : ''}" type="button" data-edit-route="${safe(name)}" aria-expanded="${expanded}" aria-controls="tts-character-route-form">
                        <span>${safe(name.slice(0, 1))}</span><b>${safe(name)}</b><small>${safe(provider?.name || '默认路由')}</small>${icon('chevronRight', 16)}
                    </button>`;
                }).join('') : `<div class="voice-route-empty">${icon('radio', 24)}<strong>等待识别角色</strong></div>`}
            </div>
            ${route ? `
                <form id="tts-character-route-form" class="voice-route-editor" data-character-route-form="${safe(state.routeCharacter)}">
                    <div class="voice-section-heading compact"><div><span>专属路由</span><h2>${safe(state.routeCharacter)}</h2></div></div>
                    <label class="voice-field" for="tts-route-provider">
                        <span class="voice-field-label">语音引擎</span>
                        <select id="tts-route-provider" name="providerId">
                            ${snapshot.providers.map(provider => `<option value="${provider.id}" ${provider.id === route.providerId ? 'selected' : ''}>${safe(provider.name)}</option>`).join('')}
                        </select>
                    </label>
                    <label class="voice-field" for="tts-route-voice" data-route-generic-voice ${['gpt_sovits', 'minimax', 'elevenlabs'].includes(route.providerId) ? 'hidden' : ''}>
                        <span class="voice-field-label">音色或说话人标识</span>
                        <input id="tts-route-voice" name="voice" type="text" value="${safe(route.voice)}" autocomplete="off">
                        <small>豆包、Edge TTS 与兼容服务可填写对应的音色或说话人标识。</small>
                    </label>
                    <section class="route-minimax-resources" data-route-provider-only="minimax" ${route.providerId === 'minimax' ? '' : 'hidden'} aria-labelledby="tts-route-minimax-heading">
                        <div class="voice-section-heading compact">
                            <div><span>已同步资源</span><h3 id="tts-route-minimax-heading">MiniMax 模型与音色</h3></div>
                            <small>${miniMaxCatalog.models.length} / ${miniMaxCatalog.voices.length}</small>
                        </div>
                        <label class="voice-field" for="tts-route-minimax-model">
                            <span class="voice-field-label">语音模型</span>
                            <select id="tts-route-minimax-model" name="minimaxModel">
                                ${miniMaxCatalog.models.map(model => `<option value="${safe(model.id)}" ${model.id === selectedMiniMaxModel ? 'selected' : ''}>${safe(model.name || model.id)} · ${safe(model.id)}</option>`).join('')}
                            </select>
                            <small>直接使用 MiniMax 控制台已经同步的模型目录。</small>
                        </label>
                        <label class="voice-field" for="tts-route-minimax-voice">
                            <span class="voice-field-label">角色音色</span>
                            <input id="tts-route-minimax-voice" name="minimaxVoice" type="text" list="tts-route-minimax-voice-options" value="${safe(selectedMiniMaxVoice)}" autocomplete="off">
                            <datalist id="tts-route-minimax-voice-options">
                                ${miniMaxCatalog.voices.map(voice => `<option value="${safe(voice.id)}">${safe(voice.name || voice.id)}</option>`).join('')}
                            </datalist>
                            <small>输入中文名称或 ID 即可搜索已同步音色，选择后会自动写入真实 ID。</small>
                        </label>
                    </section>
                    <section class="route-provider-resources provider-elevenlabs" data-route-provider-only="elevenlabs" ${route.providerId === 'elevenlabs' ? '' : 'hidden'} aria-labelledby="tts-route-elevenlabs-heading">
                        <div class="voice-section-heading compact">
                            <div><span>账号资源</span><h3 id="tts-route-elevenlabs-heading">ElevenLabs 模型与音色</h3></div>
                            <small>${elevenLabsCatalog.models.length} / ${elevenLabsCatalog.voices.length}</small>
                        </div>
                        <label class="voice-field" for="tts-route-elevenlabs-model">
                            <span class="voice-field-label">语音模型</span>
                            <select id="tts-route-elevenlabs-model" name="elevenLabsModel">
                                ${elevenLabsCatalog.models.map(model => `<option value="${safe(model.id)}" ${model.id === selectedElevenLabsModel ? 'selected' : ''}>${safe(model.name || model.id)} · ${safe(model.id)}</option>`).join('')}
                            </select>
                        </label>
                        <label class="voice-field" for="tts-route-elevenlabs-voice">
                            <span class="voice-field-label">角色音色</span>
                            <input id="tts-route-elevenlabs-voice" name="elevenLabsVoice" type="text" list="tts-route-elevenlabs-voice-options" value="${safe(selectedElevenLabsVoice)}" autocomplete="off">
                            <datalist id="tts-route-elevenlabs-voice-options">
                                ${elevenLabsCatalog.voices.map(voice => `<option value="${safe(voice.id)}">${safe(voice.name || voice.id)}</option>`).join('')}
                            </datalist>
                            <small>${elevenLabsCatalog.voices.length ? '选择已同步的账号音色，也可直接填写 Voice ID。' : '先到 ElevenLabs 引擎页保存密钥并检测连接。'}</small>
                        </label>
                    </section>
                    <div data-route-reference-fields ${['indextts2', 'voxcpm2'].includes(route.providerId) ? '' : 'hidden'}>
                        <label class="voice-field" for="tts-route-reference-audio">
                            <span class="voice-field-label">角色参考音频</span>
                            <input id="tts-route-reference-audio" name="referenceAudio" type="text" value="${safe(route.referenceAudio)}" autocomplete="off">
                            <small>仅 IndexTTS2 与 VoxCPM2 的参考音频克隆需要。</small>
                        </label>
                        <label class="voice-field" for="tts-route-prompt-text">
                            <span class="voice-field-label">参考音频文本</span>
                            <input id="tts-route-prompt-text" name="promptText" type="text" value="${safe(route.promptText)}" autocomplete="off">
                            <small>逐字填写参考音频中实际说出的台词。</small>
                        </label>
                        <details id="tts-route-reference-help" class="voice-info-popover route-reference-help">
                            <summary id="tts-route-reference-help-toggle" aria-label="查看角色参考音频填写说明">${icon('info', 14)} 参考音频怎么填？</summary>
                            <div data-route-provider-only="indextts2" ${route.providerId === 'indextts2' ? '' : 'hidden'}>填写 IndexTTS2 服务能读取的音频路径或 URL；建议使用 3–10 秒、单人、无音乐且吐字清晰的音频。</div>
                            <div data-route-provider-only="voxcpm2" ${route.providerId === 'voxcpm2' ? '' : 'hidden'}>填写 VoxCPM2 服务能读取的参考音频路径；参考文本必须与录音内容一致。</div>
                        </details>
                    </div>
                    <label class="voice-field" for="tts-route-legacy-model" data-route-provider-only="gpt_sovits" ${route.providerId === 'gpt_sovits' ? '' : 'hidden'}>
                        <span class="voice-field-label">GPT-SoVITS 模型文件夹</span>
                        <select id="tts-route-legacy-model" name="legacyModel" ${models.length ? '' : 'disabled'}>
                            <option value="">选择已扫描模型</option>
                            ${models.map(model => `<option value="${safe(model)}" ${model === mappedModel ? 'selected' : ''}>${safe(model)}</option>`).join('')}
                        </select>
                        <small>${models.length ? '保存路由时会同步完成角色模型绑定。' : '当前管理后端未启动，启动后点击主页“全部检测”即可载入模型列表。'}</small>
                    </label>
                    <div class="voice-form-actions">
                        <button id="tts-save-character-route" class="voice-button primary" type="submit">${icon('check', 17)} 保存路由</button>
                        <button id="tts-remove-character-route" class="voice-button secondary" type="button" data-remove-route="${safe(state.routeCharacter)}">${icon('close', 17)} 使用默认</button>
                        <button id="tts-delete-character" class="voice-button danger" type="button" data-delete-character="${safe(state.routeCharacter)}">${icon('trash', 17)} 删除角色</button>
                    </div>
                    <p class="voice-route-note" data-route-provider-only="gpt_sovits" ${route.providerId === 'gpt_sovits' ? '' : 'hidden'}>自动使用模型文件夹内的参考音频。</p>
                </form>` : ''}
        </section>`;
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function settingsPageHeader(kicker, title) {
    return `
        <div class="voice-kicker">${icon('settings', 15)} ${safe(kicker)}</div>
        <h1 id="voice-settings-heading">${safe(title)}</h1>
        <button class="voice-settings-back" type="button" data-settings-back>${icon('arrowLeft', 16)} 返回设置首页</button>`;
}

function renderThemesPanel() {
    const ui = TTS_ProviderRegistry.getUiSettings();
    const custom = ui.customTheme || {};
    const modes = [
        { id: 'system', name: '跟随酒馆', icon: 'spark', note: '使用酒馆配色令牌' },
        { id: 'dark', name: '夜间', icon: 'moon', note: '深色玻璃质感' },
        { id: 'light', name: '日间', icon: 'sun', note: '明亮简洁' },
        { id: 'custom', name: '自定义', icon: 'edit', note: '四级配色与壁纸' },
    ];
    const colorFields = [
        { key: 'bg', label: '主背景（60%）', fallback: '#121419' },
        { key: 'surface', label: '重点面板（30%）', fallback: '#1a1d24' },
        { key: 'accent', label: '激活状态（7%）', fallback: '#3fb6c4' },
        { key: 'glow', label: '高光辉光（3%）', fallback: '#e09666' },
    ];
    return `
        <section class="voice-secondary-view voice-themes-app" aria-labelledby="voice-themes-heading">
            <div class="voice-kicker">${icon('sun', 15)} 手机主题</div>
            <h1 id="voice-themes-heading">主题</h1>
            <div class="voice-theme-mode-grid">
                ${modes.map(mode => `<button type="button" class="${state.theme === mode.id ? 'is-active' : ''}" data-set-theme="${mode.id}">
                    <span>${icon(mode.icon, 22)}</span><strong>${mode.name}</strong><small>${mode.note}</small>
                </button>`).join('')}
            </div>
            ${state.theme === 'custom' ? `
            <form class="voice-route-editor voice-custom-theme-form" data-custom-theme-form>
                <div class="voice-section-heading compact"><div><span>自定义主题</span><h2>四级配色与壁纸</h2></div></div>
                ${colorFields.map(field => `<label class="voice-field voice-color-field" for="tts-custom-${field.key}">
                    <span class="voice-field-label">${field.label}</span>
                    <input id="tts-custom-${field.key}" name="${field.key}" type="color" value="${safe(custom[field.key] || field.fallback)}">
                </label>`).join('')}
                <label class="voice-field" for="tts-custom-wallpaper">
                    <span class="voice-field-label">壁纸图片地址</span>
                    <input id="tts-custom-wallpaper" name="wallpaper" type="url" value="${safe(custom.wallpaper || '')}" placeholder="https://…" autocomplete="off">
                    <small>留空使用当前角色头像作为桌面壁纸。</small>
                </label>
                <div class="voice-form-actions">
                    <button class="voice-button primary" type="submit">${icon('check', 16)} 保存自定义主题</button>
                    <button class="voice-button secondary" type="button" data-reset-custom-theme>${icon('undo', 16)} 恢复默认</button>
                </div>
            </form>` : ''}
            <p class="voice-settings-note">主题配色采用语义化令牌：60% 主背景、30% 重点面板、7% 激活状态、3% 渐变高光。</p>
        </section>`;
}

function renderDrawingPanel() {
    const drawing = TTS_ProviderRegistry.getDrawingSettings();
    const presets = Array.isArray(drawing.presets) ? drawing.presets : [];
    const activePreset = presets.find(item => item.id === drawing.activePresetId) || null;
    const params = drawing.params || {};
    const dynamic = state.drawingDynamic ?? activePreset?.dynamic ?? '';
    const busy = state.featureBusy === 'novelai-draw';
    const sizeOptions = [
        { id: 'portrait', label: '竖图 · 832×1216', width: 832, height: 1216 },
        { id: 'landscape', label: '横图 · 1216×832', width: 1216, height: 832 },
        { id: 'square', label: '方图 · 1024×1024', width: 1024, height: 1024 },
    ];
    const selectedSize = sizeOptions.find(item => item.id === (params.size || 'portrait')) || sizeOptions[0];
    const lastImage = state.drawingLastImage || null;
    return `
        <section class="voice-secondary-view voice-drawing-app" aria-labelledby="voice-drawing-heading">
            <div class="voice-kicker">${icon('edit', 15)} NovelAI 文生图</div>
            <h1 id="voice-drawing-heading">绘画</h1>
            <section class="voice-drawing-presets" aria-label="绘图预设">
                <div class="voice-section-heading compact">
                    <div><span>绘图预设</span><h2>固定提示词组合</h2></div>
                    <label class="voice-drawing-preset-name" for="tts-drawing-preset-name">
                        <input id="tts-drawing-preset-name" type="text" maxlength="40" placeholder="新预设名称" autocomplete="off">
                        <button type="button" data-save-drawing-preset>${icon('plus', 15)} 保存</button>
                    </label>
                </div>
                <div class="voice-drawing-preset-list">
                    ${presets.length ? presets.map(preset => `<button type="button" class="${preset.id === drawing.activePresetId ? 'is-active' : ''}" data-select-drawing-preset="${safe(preset.id)}">
                        <span><strong>${safe(preset.name)}</strong><small>${safe(preset.prefix.slice(0, 40)) || '无前置词'}</small></span>
                        ${icon('chevronRight', 15)}
                    </button>`).join('') : `<p class="voice-qq-picker-empty">还没有预设，保存后可在聊天中复用。</p>`}
                    ${drawing.activePresetId ? `<button class="voice-button danger wide" type="button" data-delete-drawing-preset="${safe(drawing.activePresetId)}">${icon('trash', 15)} 删除当前预设</button>` : ''}
                </div>
            </section>
            <form class="voice-route-editor voice-drawing-form" data-drawing-form>
                <div class="voice-section-heading compact"><div><span>固定提示词</span><h2>前置 · 后置 · 负面</h2></div></div>
                <label class="voice-field" for="tts-drawing-prefix">
                    <span class="voice-field-label">前置固定正面词</span>
                    <textarea id="tts-drawing-prefix" name="prefix" rows="2" placeholder="quality tags, masterpiece, …">${safe(activePreset?.prefix || '')}</textarea>
                </label>
                <label class="voice-field" for="tts-drawing-suffix">
                    <span class="voice-field-label">后置固定正面词</span>
                    <textarea id="tts-drawing-suffix" name="suffix" rows="2" placeholder="style tags, …">${safe(activePreset?.suffix || '')}</textarea>
                </label>
                <label class="voice-field" for="tts-drawing-negative">
                    <span class="voice-field-label">固定负面词</span>
                    <textarea id="tts-drawing-negative" name="negative" rows="2" placeholder="lowres, bad anatomy, …">${safe(activePreset?.negative || '')}</textarea>
                </label>
                <div class="voice-section-heading compact"><div><span>动态 Tag</span><h2>交给模型生成</h2></div></div>
                <label class="voice-field" for="tts-drawing-dynamic">
                    <span class="voice-field-label">动态正面 Tag</span>
                    <textarea id="tts-drawing-dynamic" name="dynamic" rows="3" placeholder="点击“生成动态 Tag”由 LLM 根据聊天场景生成">${safe(dynamic)}</textarea>
                    <small>最终正面词顺序固定为：前置 + 动态 + 后置。</small>
                </label>
                <button class="voice-button secondary wide" type="button" data-generate-drawing-tags ${busy ? 'disabled' : ''}>${icon(busy ? 'activity' : 'spark', 16)} ${busy ? '正在生成' : '生成动态 Tag'}</button>
                <div class="voice-section-heading compact"><div><span>NovelAI 参数</span><h2>模型与采样</h2></div></div>
                <div class="voice-drawing-params">
                    <label class="voice-field" for="tts-drawing-model">
                        <span class="voice-field-label">模型</span>
                        <select id="tts-drawing-model" name="model">
                            <option value="nai-diffusion-3" ${(params.model || 'nai-diffusion-3') === 'nai-diffusion-3' ? 'selected' : ''}>NAI Diffusion V3</option>
                            <option value="nai-diffusion-4-curated-preview" ${params.model === 'nai-diffusion-4-curated-preview' ? 'selected' : ''}>NAI Diffusion V4 Curated</option>
                            <option value="nai-diffusion-4-full" ${params.model === 'nai-diffusion-4-full' ? 'selected' : ''}>NAI Diffusion V4 Full</option>
                        </select>
                    </label>
                    <label class="voice-field" for="tts-drawing-size">
                        <span class="voice-field-label">尺寸</span>
                        <select id="tts-drawing-size" name="size">
                            ${sizeOptions.map(item => `<option value="${item.id}" ${item.id === selectedSize.id ? 'selected' : ''}>${item.label}</option>`).join('')}
                        </select>
                    </label>
                    <label class="voice-field" for="tts-drawing-sampler">
                        <span class="voice-field-label">Sampler</span>
                        <select id="tts-drawing-sampler" name="sampler">
                            <option value="k_euler" ${(params.sampler || 'k_euler') === 'k_euler' ? 'selected' : ''}>Euler</option>
                            <option value="k_euler_ancestral" ${params.sampler === 'k_euler_ancestral' ? 'selected' : ''}>Euler Ancestral</option>
                            <option value="k_dpmpp_2m" ${params.sampler === 'k_dpmpp_2m' ? 'selected' : ''}>DPM++ 2M</option>
                            <option value="k_dpmpp_2s_ancestral" ${params.sampler === 'k_dpmpp_2s_ancestral' ? 'selected' : ''}>DPM++ 2S Ancestral</option>
                        </select>
                    </label>
                    <label class="voice-field" for="tts-drawing-scheduler">
                        <span class="voice-field-label">Scheduler</span>
                        <select id="tts-drawing-scheduler" name="scheduler">
                            <option value="native" ${(params.scheduler || 'native') === 'native' ? 'selected' : ''}>Native</option>
                            <option value="karras" ${params.scheduler === 'karras' ? 'selected' : ''}>Karras</option>
                            <option value="exponential" ${params.scheduler === 'exponential' ? 'selected' : ''}>Exponential</option>
                            <option value="polyexponential" ${params.scheduler === 'polyexponential' ? 'selected' : ''}>Polyexponential</option>
                        </select>
                    </label>
                    <label class="voice-field" for="tts-drawing-steps">
                        <span class="voice-field-label">Steps（≤28）</span>
                        <input id="tts-drawing-steps" name="steps" type="number" min="1" max="28" value="${safe(Math.min(28, Number(params.steps) || 28))}" inputmode="numeric">
                    </label>
                    <label class="voice-field" for="tts-drawing-guidance">
                        <span class="voice-field-label">Prompt Guidance</span>
                        <input id="tts-drawing-guidance" name="guidance" type="number" min="1" max="20" step="0.1" value="${safe(params.guidance ?? 5)}" inputmode="decimal">
                    </label>
                    <label class="voice-field" for="tts-drawing-rescale">
                        <span class="voice-field-label">Guidance Rescale</span>
                        <input id="tts-drawing-rescale" name="rescale" type="number" min="0" max="1" step="0.05" value="${safe(params.rescale ?? 0)}" inputmode="decimal">
                    </label>
                    <label class="voice-field" for="tts-drawing-decrisper">
                        <span class="voice-field-label">Decrisper</span>
                        <input id="tts-drawing-decrisper" name="decrisper" type="number" min="0" max="20" step="0.1" value="${safe(params.decrisper ?? 0)}" inputmode="decimal">
                    </label>
                    <label class="voice-field" for="tts-drawing-seed">
                        <span class="voice-field-label">Seed</span>
                        <input id="tts-drawing-seed" name="seed" type="number" min="-1" max="9999999999" value="${safe(params.seed ?? -1)}" inputmode="numeric">
                        <small>-1 为随机。</small>
                    </label>
                </div>
                <button class="voice-button primary wide" type="submit" ${busy ? 'disabled' : ''}>${icon(busy ? 'activity' : 'image', 17)} ${busy ? '正在绘制…' : '开始绘制'}</button>
            </form>
            ${lastImage ? `
            <section class="voice-drawing-result" aria-label="最近绘制结果">
                <img src="${safe(lastImage)}" alt="最近生成的图片">
                <div><strong>绘制完成</strong><small>已存入 IndexedDB，QQ 消息只保存资源键。</small></div>
            </section>` : ''}
            <section class="voice-drawing-gallery" aria-label="最近生成的图片">
                <header>
                    <span><strong>最近生成</strong><small>${state.drawingRecentImages.length} 张 · 全部存于本地 IndexedDB</small></span>
                    ${state.drawingRecentImages.length ? `<button type="button" class="voice-button ghost danger" data-clear-drawing-gallery>${icon('trash', 14)} 清空全部</button>` : ''}
                </header>
                ${state.drawingRecentImages.length ? `<div class="voice-drawing-gallery-grid" data-preserve-scroll="drawing-gallery">
                    ${state.drawingRecentImages.map(item => `
                        <figure class="voice-drawing-gallery-item" data-image-key="${safe(item.key)}">
                            <img src="${safe(item.url)}" alt="${safe(item.description || '最近生成的图片')}" loading="lazy">
                            <figcaption>
                                <span>${safe(item.description || formatToolTime(item.createdAt))}</span>
                                <button type="button" data-delete-drawing-image="${safe(item.key)}" aria-label="删除这张图片">${icon('trash', 13)}</button>
                            </figcaption>
                        </figure>`).join('')}
                </div>` : '<p class="voice-qq-picker-empty">还没有生成的图片，绘制后会显示在这里。</p>'}
            </section>
        </section>`;
}

function renderSettings() {
    if (state.settingsTab === 'model') return renderSettingsModelPage();
    if (state.settingsTab === 'display') return renderSettingsDisplayPage();
    if (state.settingsTab === 'prompts') return renderSettingsPromptsPage();
    if (state.settingsTab === 'body') return renderSettingsBodyPage();
    if (state.settingsTab === 'qq') return renderSettingsQqPage();
    if (state.settingsTab === 'stickers') return renderSettingsStickersPage();
    if (state.settingsTab === 'cache') return renderSettingsCachePage();
    return renderSettingsHome();
}

function renderSettingsHome() {
    const snapshot = getSnapshot();
    const active = snapshot.providers.find(item => item.id === snapshot.activeProvider) || snapshot.providers[0];
    const cacheSummary = state.cacheStats.count === null
        ? '正在统计'
        : `${state.cacheStats.count} 段 · ${formatBytes(state.cacheStats.bytes)}`;
    const qq = TTS_ProviderRegistry.getQqState();
    const stickers = Array.isArray(qq.stickers) ? qq.stickers : [];
    const entries = [
        { tab: 'model', icon: 'cloud', name: '模型来源', note: '跟随酒馆主 API 或自定义 OpenAI 兼容预设' },
        { tab: 'display', icon: 'globe', name: '显示与语言', note: '主题、入口位置与台词生成语言' },
        { tab: 'prompts', icon: 'layers', name: '全部提示词', note: '正文、单人通话、多人通话、聊天与生图五类预设' },
        { tab: 'body', icon: 'quote', name: '正文TTS', note: '语音聊天、内置提示词与自动渲染' },
        { tab: 'qq', icon: 'messageCircle', name: 'QQ', note: '好友、群聊与最近会话' },
        { tab: 'stickers', icon: 'gift', name: '表情包', note: `${stickers.length} 个表情包 · 全局通用` },
        { tab: 'cache', icon: 'database', name: '语音缓存', note: cacheSummary },
    ];
    return `
        <section class="voice-secondary-view voice-settings-home" aria-labelledby="voice-settings-heading">
            <div class="voice-kicker">${icon('settings', 15)} TTS 设置</div>
            <h1 id="voice-settings-heading">设置</h1>
            <nav class="voice-settings-subsections" aria-label="设置子页">
                ${entries.map(item => `<button type="button" data-settings-tab="${item.tab}">
                    <span>${icon(item.icon, 18)}</span>
                    <span class="voice-settings-sub-copy"><strong>${item.name}</strong><small>${item.note}</small></span>
                    ${icon('chevronRight', 15)}
                </button>`).join('')}
            </nav>
            <article class="voice-cache-card">
                <div>${icon(active.icon, 20)}<span><strong>当前引擎</strong><small>${safe(active.name)} · ${safe(FrontendVoiceTools.plannerLabel())}</small></span></div>
                <button type="button" data-route="engines">${icon('chevronRight', 16)} 引擎</button>
            </article>
        </section>`;
}

function renderSettingsModelPage() {
    const planner = FrontendVoiceTools.getPlannerSettings();
    const apiPresets = FrontendVoiceTools.getPlannerApiPresets();
    const activeApiPreset = apiPresets.find(item => item.id === planner.activeApiPresetId);
    return `
        <section class="voice-secondary-view" aria-labelledby="voice-settings-heading">
            ${settingsPageHeader('设置 · 子页', '模型来源')}
            <form id="tts-planner-settings-form" class="voice-planner-card" data-planner-settings-form>
                <header>
                    <span class="voice-planner-icon">${icon('spark', 20)}</span>
                    <div><small>前端编排</small><strong>${safe(FrontendVoiceTools.plannerLabel())}</strong></div>
                </header>
                <label class="voice-field" for="tts-planner-mode">
                    <span class="voice-field-label">模型来源</span>
                    <select id="tts-planner-mode" name="mode">
                        <option value="sillytavern" ${planner.mode === 'sillytavern' ? 'selected' : ''}>跟随 SillyTavern 当前模型</option>
                        <option value="custom" ${planner.mode === 'custom' ? 'selected' : ''}>OpenAI 兼容 API 直连</option>
                    </select>
                </label>
                <div class="voice-planner-custom" data-planner-custom ${planner.mode === 'custom' ? '' : 'hidden'}>
                    <section class="voice-api-presets" aria-labelledby="tts-api-presets-title">
                        <strong id="tts-api-presets-title">OpenAI 兼容连接预设</strong>
                        <div>
                            <select id="tts-api-preset-select" aria-label="选择 OpenAI 连接预设">
                                <option value="">当前编辑</option>
                                ${apiPresets.map(item => `<option value="${safe(item.id)}" ${item.id === planner.activeApiPresetId ? 'selected' : ''}>${safe(item.name)}</option>`).join('')}
                            </select>
                            <button type="button" data-apply-api-preset>${icon('check', 16)} 应用</button>
                            <button type="button" data-delete-api-preset ${activeApiPreset ? '' : 'disabled'} aria-label="删除当前连接预设">${icon('trash', 16)}</button>
                        </div>
                    </section>
                    <label class="voice-field" for="tts-planner-api-url">
                        <span class="voice-field-label">API 地址</span>
                        <input id="tts-planner-api-url" name="apiUrl" type="url" value="${safe(planner.apiUrl)}" autocomplete="url">
                    </label>
                    <label class="voice-field" for="tts-planner-api-key">
                        <span class="voice-field-label">API Key</span>
                        <input id="tts-planner-api-key" name="apiKey" type="password" value="${safe(planner.apiKey)}" autocomplete="off">
                    </label>
                    <label class="voice-field" for="tts-planner-model">
                        <span class="voice-field-label">模型 ID</span>
                        <input id="tts-planner-model" name="model" type="text" list="tts-planner-model-options" value="${safe(planner.model)}" autocomplete="off">
                        <datalist id="tts-planner-model-options">${state.plannerModels.map(model => `<option value="${safe(model)}"></option>`).join('')}</datalist>
                    </label>
                    <button class="voice-api-model-fetch" type="button" data-fetch-planner-models ${state.plannerModelsBusy ? 'disabled' : ''}>${icon(state.plannerModelsBusy ? 'activity' : 'refresh', 16)} ${state.plannerModelsBusy ? '正在拉取模型' : '拉取模型列表'}</button>
                    <div class="voice-api-preset-save">
                        <input id="tts-api-preset-name" type="text" value="${safe(activeApiPreset?.name || '')}" autocomplete="off" aria-label="连接预设名称">
                        <button type="button" data-save-api-preset>${icon('plus', 16)} 保存连接预设</button>
                    </div>
                    <small class="voice-security-note">直连密钥保存在当前 SillyTavern 用户设置中，仅适合可信的自用扩展环境。</small>
                </div>
                <div class="voice-planner-parameters">
                    <label class="voice-field" for="tts-planner-temperature">
                        <span class="voice-field-label">温度（直连）</span>
                        <input id="tts-planner-temperature" name="temperature" type="number" min="0" max="1.5" step="0.05" value="${safe(planner.temperature)}" inputmode="decimal">
                    </label>
                    <label class="voice-field" for="tts-planner-max-tokens">
                        <span class="voice-field-label">最大 Token</span>
                        <input id="tts-planner-max-tokens" name="maxTokens" type="number" min="200" max="30000" step="512" value="${safe(planner.maxTokens)}" inputmode="numeric">
                    </label>
                    <label class="voice-field" for="tts-planner-context-limit">
                        <span class="voice-field-label">读取最近楼层</span>
                        <select id="tts-planner-context-limit" name="contextLimit">
                            ${[20, 50, 100, 200, 500].map(value => `<option value="${value}" ${planner.contextLimit === value ? 'selected' : ''}>${value} 层</option>`).join('')}
                            <option value="0" ${planner.contextLimit === 0 ? 'selected' : ''}>全部楼层</option>
                        </select>
                    </label>
                </div>
                <button id="tts-save-planner-settings" class="voice-button primary wide" type="submit">${icon('check', 17)} 保存模型来源</button>
            </form>
        </section>`;
}

function renderSettingsDisplayPage() {
    const planner = FrontendVoiceTools.getPlannerSettings();
    const outputLanguages = FrontendVoiceTools.listOutputLanguages();
    return `
        <section class="voice-secondary-view" aria-labelledby="voice-settings-heading">
            ${settingsPageHeader('设置 · 子页', '显示与语言')}
            <form id="tts-display-settings-form" class="voice-route-editor" data-display-settings-form>
                <label class="voice-field" for="tts-console-theme">
                    <span class="voice-field-label">外观主题</span>
                    <select id="tts-console-theme" name="theme">
                        <option value="system" ${state.theme === 'system' ? 'selected' : ''}>跟随酒馆主题</option>
                        <option value="dark" ${state.theme === 'dark' ? 'selected' : ''}>夜间主题</option>
                        <option value="light" ${state.theme === 'light' ? 'selected' : ''}>日间主题</option>
                    </select>
                </label>
                <label class="voice-field" for="tts-trigger-dock">
                    <span class="voice-field-label">悬浮球贴边</span>
                    <select id="tts-trigger-dock" name="triggerDock">
                        <option value="right" ${state.triggerDock === 'right' ? 'selected' : ''}>右侧</option>
                        <option value="left" ${state.triggerDock === 'left' ? 'selected' : ''}>左侧</option>
                    </select>
                    <small>悬浮球可拖动，松开后自动贴到这一侧。</small>
                </label>
                <label class="voice-field" for="tts-planner-output-language">
                    <span class="voice-field-label">台词生成语言</span>
                    <select id="tts-planner-output-language" name="outputLanguage">
                        ${outputLanguages.map(item => `<option value="${item.id}" ${planner.outputLanguage === item.id ? 'selected' : ''}>${safe(item.label)}</option>`).join('')}
                    </select>
                    <small>来电、私聊与正文共用。</small>
                </label>
                <label class="voice-field" for="tts-planner-custom-language" data-planner-custom-language ${planner.outputLanguage === 'custom' ? '' : 'hidden'}>
                    <span class="voice-field-label">语言或方言要求</span>
                    <input id="tts-planner-custom-language" name="customLanguage" type="text" value="${safe(planner.customLanguage)}" maxlength="200" autocomplete="off" ${planner.outputLanguage === 'custom' ? 'required' : ''}>
                    <small>例如：法语口语、四川话、粤语夹少量英文。</small>
                </label>
                <button class="voice-button primary wide" type="submit">${icon('check', 17)} 保存显示与语言</button>
            </form>
        </section>`;
}

function renderSettingsPromptsPage() {
    const order = ['body', 'single_call', 'group_call', 'chat', 'image'];
    const labels = Object.fromEntries(order.map(kind => {
        try {
            return [kind, FrontendVoiceTools.getPromptWorkflow(kind)?.label || kind];
        } catch {
            return [kind, kind];
        }
    }));
    return `
        <section class="voice-secondary-view" aria-labelledby="voice-settings-heading">
            ${settingsPageHeader('设置 · 子页', '全部提示词')}
            <div class="voice-settings-prompt-list">
                ${order.map(kind => `<button type="button" data-open-prompt-workflow="${kind}">
                    ${icon('layers', 18)}<span><strong>${safe(labels[kind] || kind)}</strong><small>预设条目、插入深度与排序</small></span>${icon('chevronRight', 16)}
                </button>`).join('')}
                <button type="button" data-route="prompt-lab">
                    ${icon('spark', 18)}<span><strong>提示词实验室</strong><small>测试输出契约与 JSON Schema</small></span>${icon('chevronRight', 16)}
                </button>
            </div>
        </section>`;
}

function renderSettingsBodyPage() {
    const snapshot = getSnapshot();
    const playback = snapshot.playback || { enabled: true, autoGenerate: true };
    const planner = FrontendVoiceTools.getPlannerSettings();
    const ui = TTS_ProviderRegistry.getUiSettings();
    const bodyAutoRender = ui.bodyAutoRender !== false;
    const tagSettings = snapshot.tags || TTS_ProviderRegistry.getTagSettings();
    const tagPresets = TTS_ProviderRegistry.getTagPresets();
    const activeTagPreset = tagPresets.find(item => item.id === tagSettings.preset);
    const tagTemplateEditable = tagSettings.preset === 'custom' || activeTagPreset?.id?.startsWith('tag-');
    const tagExampleSpeech = planner.outputLanguage === 'ja' ? '今日は会えてうれしい。'
        : planner.outputLanguage === 'en' ? 'I am glad to see you today.'
            : planner.outputLanguage === 'ko' ? '오늘 만나서 기뻐.'
                : planner.outputLanguage === 'yue' ? '今日见到你好开心。' : '今天见到你真好。';
    const tagExample = tagSettings.template
        .replaceAll('{角色}', '林晚')
        .replaceAll('{情绪}', planner.outputLanguage === 'ja' ? '穏やか' : '平静')
        .replaceAll('{译文}', '今天见到你真好。')
        .replaceAll('{文本}', tagExampleSpeech);
    return `
        <section class="voice-secondary-view" aria-labelledby="voice-settings-heading">
            ${settingsPageHeader('设置 · 子页', '正文TTS')}
            <form id="tts-runtime-settings-form" class="voice-route-editor runtime-settings-form" data-runtime-settings-form>
                <label class="voice-field switch-field" for="tts-playback-enabled">
                    <span><b>语音聊天总开关</b><small>关闭后不再为聊天回复生成语音。</small></span>
                    <input id="tts-playback-enabled" name="enabled" type="checkbox" ${playback.enabled ? 'checked' : ''}>
                    <i aria-hidden="true"></i>
                </label>
                <label class="voice-field switch-field" for="tts-playback-auto-generate">
                    <span><b>自动生成回复</b><small>角色回复后自动排队生成 TTS。</small></span>
                    <input id="tts-playback-auto-generate" name="autoGenerate" type="checkbox" ${playback.autoGenerate ? 'checked' : ''}>
                    <i aria-hidden="true"></i>
                </label>
                <label class="voice-field switch-field" for="tts-body-prompt-enabled">
                    <span><b>内置正文 TTS 提示词</b><small>关闭后不会向正文生成注入语音格式，仍可解析手工标签。</small></span>
                    <input id="tts-body-prompt-enabled" name="bodyPromptEnabled" type="checkbox" ${planner.bodyPromptEnabled ? 'checked' : ''}>
                    <i aria-hidden="true"></i>
                </label>
                <label class="voice-field switch-field" for="tts-body-auto-render">
                    <span><b>自动渲染正文 TTS</b><small>后台生成并缓存正文语音，不自动播放。</small></span>
                    <input id="tts-body-auto-render" name="bodyAutoRender" type="checkbox" ${bodyAutoRender ? 'checked' : ''}>
                    <i aria-hidden="true"></i>
                </label>
                <details class="voice-advanced-settings">
                    <summary>高级：聊天触发格式</summary>
                    <fieldset class="voice-tag-settings">
                        <legend>语音标签</legend>
                        <label class="voice-field" for="tts-tag-preset">
                            <span class="voice-field-label">格式方案</span>
                            <select id="tts-tag-preset" name="tagPreset">
                                ${tagPresets.map(item => `<option value="${item.id}" data-tag-template="${safe(item.template)}" ${tagSettings.preset === item.id ? 'selected' : ''}>${safe(item.name)}</option>`).join('')}
                            </select>
                        </label>
                        <label class="voice-field" for="tts-tag-template">
                            <span class="voice-field-label">格式模板</span>
                            <input id="tts-tag-template" name="tagTemplate" type="text" value="${safe(tagSettings.template)}" autocomplete="off" ${tagTemplateEditable ? '' : 'readonly'}>
                            <small>{译文} 显示中文，{文本} 用于朗读。</small>
                        </label>
                        <div class="voice-tag-preset-save">
                            <input id="tts-tag-preset-name" type="text" value="${safe(activeTagPreset?.id?.startsWith('tag-') ? activeTagPreset.name : '')}" autocomplete="off" aria-label="聊天触发格式预设名称">
                            <button type="button" data-save-tag-preset>${icon('plus', 16)} 保存格式预设</button>
                            <button type="button" data-delete-tag-preset ${activeTagPreset?.id?.startsWith('tag-') ? '' : 'disabled'} aria-label="删除当前格式预设">${icon('trash', 16)}</button>
                        </div>
                        <div id="tts-tag-format-example" class="voice-tag-example">
                            <span>示例</span>
                            <code>${safe(tagExample)}</code>
                        </div>
                        <details id="tts-engine-emotion-help" class="voice-info-popover">
                            <summary id="tts-engine-emotion-help-toggle">${icon('info', 14)} 引擎如何使用情绪</summary>
                            <p>GPT-SoVITS 选择情绪参考音频；IndexTTS2 与 VoxCPM2 使用情绪描述；MiniMax 依靠正文语境和声音标签。</p>
                        </details>
                    </fieldset>
                </details>
                <button id="tts-save-runtime-settings" class="voice-button primary wide" type="submit">${icon('check', 17)} 保存正文 TTS 设置</button>
            </form>
        </section>`;
}

function renderSettingsQqPage() {
    const qq = TTS_ProviderRegistry.getQqState();
    const proactiveCalls = qq.proactiveCalls && typeof qq.proactiveCalls === 'object' ? qq.proactiveCalls : {};
    return `
        <section class="voice-secondary-view" aria-labelledby="voice-settings-heading">
            ${settingsPageHeader('设置 · 子页', 'QQ')}
            <p class="voice-settings-note">QQ 消息只会按当前聊天持久化到 <code>chatMetadata.phonie_v2</code>；好友与群聊全局保存，新开酒馆聊天也不会丢失。</p>
            <form class="voice-qq-settings-form voice-route-editor" data-qq-settings-form>
                <label class="voice-field switch-field" for="tts-proactive-enabled">
                    <span><b>角色主动来电</b><small>单聊时角色可以按情境与动机主动打来电话。</small></span>
                    <input id="tts-proactive-enabled" name="proactiveEnabled" type="checkbox" ${proactiveCalls.enabled !== false ? 'checked' : ''}>
                    <i aria-hidden="true"></i>
                </label>
                <label class="voice-field" for="tts-proactive-cooldown">
                    <span class="voice-field-label">来电冷却（分钟，0–1440）</span>
                    <input id="tts-proactive-cooldown" name="proactiveCooldown" type="number" min="0" max="1440" step="1" value="${safe(proactiveCalls.cooldownMinutes ?? 30)}" inputmode="numeric">
                    <small>同一位角色两次来电之间的最小间隔。</small>
                </label>
                <button class="voice-button primary wide" type="submit">${icon('check', 16)} 保存主动来电设置</button>
            </form>
            <button type="button" class="voice-route-shortcut" data-route="qq">${icon('messageCircle', 18)}<span><strong>打开 QQ</strong><small>查看最近会话与好友</small></span>${icon('chevronRight', 16)}</button>
            <button type="button" class="voice-route-shortcut" data-route="chat">${icon('messageCircle', 18)}<span><strong>打开聊天</strong><small>手机私聊 + 内置提示词</small></span>${icon('chevronRight', 16)}</button>
            <button type="button" class="voice-route-shortcut" data-open-prompt-workflow="chat">${icon('layers', 18)}<span><strong>聊天提示词</strong><small>调整 system、user、assistant 条目</small></span>${icon('chevronRight', 16)}</button>
            <button type="button" class="voice-button danger wide" data-clear-phone-chat>${icon('trash', 16)} 清空当前角色的手机聊天记录</button>
        </section>`;
}

function parseStickerBatchText(batchText) {
    const parseItem = raw => {
        const text = String(raw || '').trim();
        if (!text) return null;
        const httpIndex = text.search(/https?:\/\//);
        if (httpIndex <= 0) return null;
        const name = text.slice(0, httpIndex).trim().slice(0, 40) || '表情包';
        const url = text.slice(httpIndex).trim();
        return /^https?:\/\//.test(url) ? { name, url } : null;
    };
    return String(batchText || '').split(/[,，\n]/).map(parseItem).filter(Boolean);
}

function renderSettingsStickersPage() {
    const qq = TTS_ProviderRegistry.getQqState();
    const stickers = Array.isArray(qq.stickers) ? qq.stickers : [];
    const selected = new Set(Array.isArray(state.stickerSelected) ? state.stickerSelected : []);
    const allSelected = stickers.length > 0 && stickers.every(sticker => selected.has(sticker.id));
    const editingId = state.stickerEditingId || '';
    const bulkText = stickers.map(sticker => `${sticker.name || '表情包'}${sticker.url || ''}`).join(',');
    return `
        <section class="voice-secondary-view" aria-labelledby="voice-settings-heading">
            ${settingsPageHeader('设置 · 子页', '表情包')}
            <section id="tts-settings-stickers" class="voice-route-editor" aria-label="表情包">
                <div class="voice-section-heading compact"><div><span>表情包</span><h2>手机消息表情</h2></div></div>
                <form class="voice-sticker-add-form" data-sticker-add-form>
                    <label class="voice-field" for="tts-sticker-batch">
                        <span class="voice-field-label">批量导入</span>
                        <textarea id="tts-sticker-batch" name="stickerBatch" rows="3" placeholder="名字URL,名字URL,名字URL"></textarea>
                        <small>每项按“名字URL”拆分，逗号分隔；名字与地址之间不放空格。</small>
                    </label>
                    <button class="voice-button primary" type="submit">${icon('plus', 16)} 批量导入表情包</button>
                </form>
                ${stickers.length ? `
                <div class="voice-sticker-toolbar">
                    <label><input type="checkbox" data-sticker-select-all ${allSelected ? 'checked' : ''}><span>全选</span></label>
                    <span class="voice-sticker-count">已选 ${selected.size}/${stickers.length}</span>
                    <button type="button" data-sticker-delete-selected ${selected.size ? '' : 'disabled'}>${icon('trash', 14)} 删除所选</button>
                    <button type="button" data-sticker-bulk-toggle class="${state.stickerBulkEditOpen ? 'is-active' : ''}">${icon('edit', 14)} 批量编辑</button>
                </div>` : ''}
                ${state.stickerBulkEditOpen ? `
                <form class="voice-sticker-bulk-form" data-sticker-bulk-form>
                    <label class="voice-field" for="tts-sticker-bulk-edit">
                        <span class="voice-field-label">批量编辑</span>
                        <textarea id="tts-sticker-bulk-edit" name="stickerBulk" rows="6">${safe(bulkText)}</textarea>
                        <small>按“名字URL,名字URL”改写，保存后整体替换表情包列表。</small>
                    </label>
                    <button class="voice-button primary" type="submit">${icon('check', 16)} 保存全部修改</button>
                </form>` : ''}
                <div class="voice-sticker-grid" data-preserve-scroll="sticker-grid">
                    ${stickers.length ? stickers.map(sticker => {
                        const isEditing = sticker.id === editingId;
                        return `<figure class="voice-sticker-item ${selected.has(sticker.id) ? 'is-selected' : ''}">
                            <label class="voice-sticker-selector" title="选择"><input type="checkbox" data-sticker-select="${safe(sticker.id)}" ${selected.has(sticker.id) ? 'checked' : ''}><i></i></label>
                            <img src="${safe(sticker.url)}" alt="${safe(sticker.name || '表情包')}" loading="lazy">
                            ${isEditing ? `
                            <figcaption class="is-editing">
                                <input data-sticker-edit-name type="text" maxlength="40" value="${safe(sticker.name)}" aria-label="表情包名字">
                                <input data-sticker-edit-url type="text" value="${safe(sticker.url)}" aria-label="表情包地址">
                                <div>
                                    <button type="button" data-sticker-save-edit>${icon('check', 13)} 保存</button>
                                    <button type="button" data-sticker-cancel-edit aria-label="取消编辑">${icon('close', 13)}</button>
                                </div>
                            </figcaption>` : `
                            <figcaption><span>${safe(sticker.name || '未命名')}</span>
                                <span class="voice-sticker-item-actions">
                                    <button type="button" data-sticker-edit="${safe(sticker.id)}" aria-label="编辑表情包">${icon('edit', 13)}</button>
                                    <button type="button" data-sticker-remove="${safe(sticker.id)}" aria-label="删除表情包">${icon('trash', 14)}</button>
                                </span>
                            </figcaption>`}
                        </figure>`;
                    }).join('') : `<p class="voice-qq-picker-empty">还没有表情包，用“名字URL,名字URL”批量导入。</p>`}
                </div>
                ${stickers.length ? `<button class="voice-button danger wide" type="button" data-sticker-clear>${icon('trash', 15)} 清空全部表情包</button>` : ''}
            </section>
        </section>`;
}

function renderSettingsCachePage() {
    const cacheSummary = state.cacheStats.count === null
        ? '正在统计'
        : `${state.cacheStats.count} 段 · ${formatBytes(state.cacheStats.bytes)}`;
    return `
        <section class="voice-secondary-view" aria-labelledby="voice-settings-heading">
            ${settingsPageHeader('设置 · 子页', '语音缓存')}
            <article id="tts-settings-cache" class="voice-cache-card">
                <div>${icon('database', 20)}<span><strong>语音缓存</strong><small id="tts-cache-summary">${safe(cacheSummary)}</small></span></div>
                <button id="tts-clear-audio-cache" type="button" data-clear-audio-cache>${icon('trash', 16)} 清空缓存</button>
            </article>
            <p class="voice-settings-note">缓存保存在浏览器 IndexedDB 的 phonie-v2-assets 库，超过上限自动清理最早的音频。</p>
        </section>`;
}

function formatToolTime(value) {
    const date = new Date(value || 0);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function formatCallDuration(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function renderCallerAvatar(context, className = '') {
    return context.avatarUrl
        ? `<img class="${className}" src="${safe(context.avatarUrl)}" alt="${safe(context.charName)}">`
        : `<span class="${className}" aria-hidden="true">${safe(context.charName?.slice(0, 1) || '声')}</span>`;
}

function virtualNumber(name) {
    let hash = 0;
    const value = String(name || '');
    for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    }
    const digits = String(Math.abs(hash)).padStart(10, '0').slice(0, 10);
    return `+00 ${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
}

async function runPhonePlan({ caller, brief, duration, direction = 'outgoing', participants = [] } = {}) {
    if (state.featureBusy) return;
    state.phoneBrief = brief;
    state.phoneLength = duration;
    state.phoneCaller = caller;
    state.phoneParticipants = [...participants];
    state.phoneDirection = 'outgoing';
    state.featureBusy = 'phone-plan';
    updateView();
    try {
        state.phonePlan = await FrontendVoiceTools.generatePhonePlan({
            brief,
            duration,
            caller,
            participants,
        });
        state.phoneStage = 'connecting';
        state.phoneError = '';
        const isGroup = (state.phonePlan.participants?.length || 1) > 1;
        announce(isGroup ? `${state.phonePlan.charName} 等多人通话准备就绪` : `${state.phonePlan.charName} 的通话准备就绪`);
        // 直接进入连接 / 接通流程，没有响铃也无需手动接听。
        await answerPhoneCall();
    } catch (error) {
        state.phoneStage = 'ended';
        state.phoneError = error.message || '通话规划失败';
        announce(state.phoneError);
    } finally {
        state.featureBusy = null;
        updateView();
    }
}

function renderPhoneSetup(tools, context, plan) {
    const busy = ['phone-plan', 'phone-regenerate'].includes(state.featureBusy);
    const voiceCharacters = FrontendVoiceTools.getAvailableVoiceCharacters();
    const contacts = FrontendVoiceTools.getVoiceContacts?.() || [];
    const sourceIsTopic = state.phoneContentSource === 'topic';
    const selectedParticipants = state.phoneParticipants.length
        ? state.phoneParticipants
        : (state.phoneCaller && state.phoneCaller !== 'auto' ? [state.phoneCaller] : [context.charName].filter(Boolean));
    const participantCount = selectedParticipants.length;
    const isGroup = participantCount > 1;
    return `
        <section class="voice-secondary-view voice-tool-view" aria-labelledby="voice-incoming-heading">
            <div class="voice-kicker">${icon('phone', 15)} 拨号通话</div>
            <h1 id="voice-incoming-heading">电话</h1>
            <div class="voice-context-chip ${context.available ? 'is-ready' : ''}">
                <span>${context.available ? renderCallerAvatar(context, 'voice-context-avatar') : icon('info', 18)}</span>
                <div><strong>${context.available ? safe(context.charName) : '未打开角色对话'}</strong><small>读取 ${context.includedFloorCount}/${context.floorCount} 层 · ${safe(FrontendVoiceTools.plannerLabel())}</small></div>
            </div>
            <section class="voice-dial-section" aria-label="拨号盘">
                <div class="voice-dial-display">
                    <input id="tts-dial-input" type="tel" inputmode="tel" value="${safe(state.dialInput)}" placeholder="输入或点击号码" aria-label="拨号号码" autocomplete="off">
                    <button type="button" data-dial-key="back" aria-label="退格删除">${icon('undo', 17)}</button>
                </div>
                <div class="voice-dial-pad">
                    ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map(key => `<button type="button" data-dial-key="${key}">${key}</button>`).join('')}
                </div>
                <button class="voice-dial-call-button" type="button" data-dial-call ${busy ? 'disabled' : ''}>${icon(busy ? 'activity' : 'phone', 18)}${busy ? '正在规划' : '拨出'}</button>
                ${contacts.length ? `<details class="voice-dial-contacts">
                    <summary>${icon('users', 15)} 通讯录号码 · ${contacts.length} 位</summary>
                    <div>${contacts.map(contact => `<button type="button" data-dial-fill="${safe(contact.name)}">
                        <span><strong>${safe(contact.name)}</strong><small>${contact.configured ? `${safe(contact.providerName)} · 已配声线` : '未配声线'}</small></span>
                        <em>${safe(virtualNumber(contact.name))}</em>
                    </button>`).join('')}</div>
                </details>` : ''}
            </section>
            <form id="tts-phone-plan-form" class="voice-tool-form" data-phone-plan-form>
                <fieldset class="voice-speaker-picker">
                    <legend>${isGroup ? `多人通话 · 已选 ${participantCount} 位` : '参与角色'}</legend>
                    ${voiceCharacters.length ? voiceCharacters.map(item => `
                        <label>
                            <input type="checkbox" name="participants" value="${safe(item.name)}" ${selectedParticipants.includes(item.name) ? 'checked' : ''}>
                            <span>${safe(item.name)}<small>${safe(item.providerName)}</small></span>
                        </label>`).join('') : '<small>还没有角色声线路由。</small>'}
                </fieldset>
                <label for="tts-phone-source">通话内容</label>
                <select id="tts-phone-source" name="source">
                    <option value="context" ${state.phoneContentSource === 'context' ? 'selected' : ''}>延续当前酒馆上下文</option>
                    <option value="topic" ${state.phoneContentSource === 'topic' ? 'selected' : ''}>自定义主题</option>
                </select>
                <label for="tts-phone-brief" data-phone-topic-label ${sourceIsTopic ? '' : 'hidden'}>这通电话想谈什么</label>
                <textarea id="tts-phone-brief" name="brief" rows="3" ${sourceIsTopic ? '' : 'hidden'}>${safe(state.phoneBrief)}</textarea>
                ${isGroup ? '' : `
                <label for="tts-phone-duration">长度</label>
                <select id="tts-phone-duration" name="duration">
                    <option value="short" ${state.phoneLength === 'short' ? 'selected' : ''}>短 · 4–6 句</option>
                    <option value="medium" ${state.phoneLength === 'medium' ? 'selected' : ''}>普通 · 7–10 句</option>
                    <option value="long" ${state.phoneLength === 'long' ? 'selected' : ''}>长 · 12–18 句</option>
                </select>`}
            </form>
        </section>`;
}

function renderPhoneRinging(context, plan) {
    const outgoing = state.phoneDirection === 'outgoing';
    return `
        <section class="voice-call-stage voice-call-ringing" aria-labelledby="tts-ringing-caller" aria-live="assertive">
            <div class="voice-call-topline"><span>语音通话</span><i></i><span>${outgoing ? '呼叫' : '来电'}</span></div>
            <div class="voice-call-caller">
                <div class="voice-call-avatar-ring">${renderCallerAvatar(context, 'voice-call-avatar')}</div>
                <small>${outgoing ? '正在呼叫角色' : '角色来电'}</small>
                <h1 id="tts-ringing-caller">${safe(context.charName)}</h1>
                <p>${safe(plan.reason || plan.title)}</p>
            </div>
            <div class="voice-call-actions" aria-label="${outgoing ? '呼叫操作' : '来电操作'}">
                ${outgoing ? `<button class="is-decline is-solo" type="button" data-decline-call aria-label="取消呼叫">${icon('close', 27)}<span>取消</span></button>`
        : `<button class="is-decline" type="button" data-decline-call aria-label="拒绝来电">${icon('close', 27)}<span>拒绝</span></button>
                <button class="is-answer" type="button" data-answer-call aria-label="接听来电">${icon('phone', 27)}<span>接听</span></button>`}
            </div>
        </section>`;
}

function renderPhoneConnecting(context) {
    return `
        <section class="voice-call-stage voice-call-connecting" aria-labelledby="tts-connecting-title" aria-live="polite">
            <div class="voice-call-caller">
                <div class="voice-call-avatar-ring">${renderCallerAvatar(context, 'voice-call-avatar')}</div>
                <small>正在接通角色声线</small>
                <h1 id="tts-connecting-title">${safe(context.charName)}</h1>
                <div class="voice-call-connect-wave" aria-hidden="true">${Array.from({ length: 9 }, (_, index) => `<i style="--bar:${index}"></i>`).join('')}</div>
            </div>
            <button class="voice-call-hangup" type="button" data-hangup-call aria-label="取消接听">${icon('close', 26)}</button>
        </section>`;
}

function renderPhoneActive(context, plan) {
    const segment = plan.segments[state.phoneSegmentIndex] || plan.segments[0];
    return `
        <section class="voice-call-stage voice-call-active" aria-labelledby="tts-active-caller">
            <div class="voice-call-active-head">
                <span class="voice-call-live-dot" aria-hidden="true"></span>
                <div><small>通话中</small><strong id="tts-call-duration">${formatCallDuration(state.phoneElapsed)}</strong></div>
            </div>
            <div class="voice-call-active-person">
                <div class="voice-call-avatar-wrap">${renderCallerAvatar(context, 'voice-call-avatar')}</div>
                <h1 id="tts-active-caller">${safe(context.charName)}</h1>
                <small>${safe(plan.tone)}</small>
            </div>
            <div class="voice-call-visualizer ${state.phoneNeedsResume ? 'is-paused' : ''}" aria-hidden="true">
                ${Array.from({ length: 15 }, (_, index) => `<i style="--bar:${index}"></i>`).join('')}
            </div>
            <div class="voice-call-subtitle" aria-live="polite">
                <small id="tts-call-emotion">${safe(`${segment?.speaker || plan.charName} · ${segment?.emotion || '自然'}`)}</small>
                <p id="tts-call-subtitle">${safe(segment?.text || '正在接通……')}</p>
                <span id="tts-call-translation" ${segment?.translation && segment.translation !== segment.text ? '' : 'hidden'}>${safe(segment?.translation || '')}</span>
            </div>
            <div class="voice-call-segments" aria-label="通话进度">
                ${plan.segments.map((_, index) => `<i class="${index === state.phoneSegmentIndex ? 'is-active' : index < state.phoneSegmentIndex ? 'is-done' : ''}"></i>`).join('')}
            </div>
            ${state.phoneNeedsResume ? `<button class="voice-call-resume" type="button" data-resume-call>${icon('play', 18)} 继续播放</button>` : ''}
            <button class="voice-call-hangup" type="button" data-hangup-call aria-label="挂断电话">${icon('phone', 28)}<span>挂断</span></button>
        </section>`;
}

function renderPhoneEnded(context, plan) {
    return `
        <section class="voice-call-stage voice-call-ended" aria-labelledby="tts-call-ended-title">
            <div class="voice-call-ended-mark">${icon(state.phoneError ? 'info' : 'phone', 30)}</div>
            <small>${state.phoneError ? '通话没有接通' : '通话结束'}</small>
            <h1 id="tts-call-ended-title">${safe(context.charName)}</h1>
            <p>${safe(state.phoneError || plan?.reason || '这通电话已经结束。')}</p>
            <div>
                ${plan ? `<button type="button" data-start-phone-call="${safe(plan.id)}">${icon('repeat', 17)} 再来一次</button>` : ''}
                <button type="button" data-close-call-result>${icon('arrowLeft', 17)} 返回来电</button>
            </div>
        </section>`;
}

function renderIncomingPanel() {
    const tools = FrontendVoiceTools.getSnapshot();
    const context = tools.context;
    const plan = state.phonePlan || null;
    const callContext = plan ? { ...context, charName: plan.charName || context.charName, avatarUrl: plan.avatarUrl || (plan.charName === context.charName ? context.avatarUrl : '') } : context;
    if (plan && state.phoneStage === 'ringing') return renderPhoneRinging(callContext, plan);
    if (plan && state.phoneStage === 'connecting') return renderPhoneConnecting(callContext);
    if (plan && state.phoneStage === 'active') return renderPhoneActive(callContext, plan);
    if (state.phoneStage === 'ended') return renderPhoneEnded(callContext, plan);
    return renderPhoneSetup(tools, context, plan);
}

function renderFavoriteCharacterOptions(characters, selectedName = '') {
    return `<option value="">暂不绑定</option>${characters.map(character => `
        <option value="${safe(character.name)}" ${character.name === selectedName ? 'selected' : ''}>${safe(character.name)}</option>`).join('')}`;
}

function getFavoriteRouteCharacters() {
    const routes = getSnapshot().characterRoutes || {};
    return Object.entries(routes)
        .map(([name, route]) => ({ name, route }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function favoriteProviderLabel(providerId) {
    return getSnapshot().providers.find(provider => provider.id === providerId)?.name
        || (providerId === 'minimax' ? 'MiniMax' : providerId);
}

function renderFavoriteCard(item, characters) {
    const manageKey = `${item.providerId}::${item.voiceId}`;
    const managing = state.favoriteManageKey === manageKey;
    const boundCharacter = characters.find(character => (
        character.route?.providerId === item.providerId
        && character.route?.voice === item.voiceId
    ))?.name || '';
    return `
        <article class="voice-favorite-card provider-${safe(item.providerId)}" data-favorite-voice-item data-favorite-voice-search="${safe(`${item.name} ${item.voiceId} ${favoriteProviderLabel(item.providerId)}`.toLowerCase())}">
            <span class="voice-favorite-emblem">${icon('waveform', 20)}</span>
            <div><small>${safe(favoriteProviderLabel(item.providerId).toLocaleUpperCase('zh-CN'))}</small><strong>${safe(item.name)}</strong><code>${safe(item.voiceId)}</code></div>
            <button class="voice-favorite-manage" type="button" data-manage-voice-favorite="${safe(manageKey)}" aria-expanded="${managing}" aria-label="管理收藏 ${safe(item.name)}">
                ${icon('edit', 16)}<span>编辑</span>
            </button>
            ${managing ? `
                <form class="voice-favorite-edit-form" data-edit-voice-favorite-form data-original-provider-id="${safe(item.providerId)}" data-original-voice-id="${safe(item.voiceId)}">
                    <label><span>收藏名称</span><input name="voiceName" type="text" maxlength="80" value="${safe(item.name)}" required></label>
                    <label><span>Voice ID</span><input name="voiceId" type="text" value="${safe(item.voiceId)}" required></label>
                    <label><span>语音模型</span><input name="voiceModel" type="text" value="${safe(item.model)}"></label>
                    <label><span>绑定角色路由</span><select name="characterName">${renderFavoriteCharacterOptions(characters, boundCharacter)}</select></label>
                    <button type="submit">${icon('check', 15)} 保存编辑</button>
                </form>` : ''}
            ${managing ? `
                <div class="voice-favorite-danger-zone">
                    <span><strong>移除收藏</strong></span>
                    <button type="button" data-cancel-voice-favorite-manage>取消</button>
                    <button class="is-danger" type="button" data-remove-voice-favorite data-provider-id="${safe(item.providerId)}" data-voice-id="${safe(item.voiceId)}" data-voice-name="${safe(item.name)}" data-voice-category="${safe(item.category)}">移除</button>
                </div>` : ''}
        </article>`;
}

function renderFavoritesPanel() {
    const tools = FrontendVoiceTools.getSnapshot();
    const characters = getFavoriteRouteCharacters();
    const providers = getSnapshot().providers.filter(provider => ['minimax', 'elevenlabs'].includes(provider.id));
    const miniMaxSettings = TTS_ProviderRegistry.getSettings('minimax');
    const elevenLabsSettings = TTS_ProviderRegistry.getSettings('elevenlabs');
    return `
        <section class="voice-secondary-view voice-tool-view" aria-labelledby="voice-favorites-heading">
            <div class="voice-kicker">${icon('bookmark', 15)} 声线收藏</div>
            <h1 id="voice-favorites-heading">声线收藏</h1>
            <div class="voice-favorite-actions">
                <button id="tts-browse-minimax-voices" type="button" data-open-provider="minimax">${icon('search', 17)} MiniMax 音色</button>
                <button id="tts-browse-elevenlabs-voices" type="button" data-open-provider="elevenlabs">${icon('search', 17)} ElevenLabs 音色</button>
                <button id="tts-open-role-routes" type="button" data-route="library">${icon('library', 17)} 角色路由</button>
            </div>
            <details class="voice-collapsible voice-custom-favorite">
                <summary>${icon('plus', 16)}<span><strong>手动收藏自定义音色</strong><small>支持 MiniMax 与 ElevenLabs Voice ID</small></span>${icon('chevronRight', 15)}</summary>
                <form data-custom-voice-favorite-form>
                    <label for="tts-custom-favorite-provider"><span>语音引擎</span><select id="tts-custom-favorite-provider" name="providerId">${providers.map(provider => `<option value="${safe(provider.id)}">${safe(provider.name)}</option>`).join('')}</select></label>
                    <label for="tts-custom-favorite-name"><span>收藏名称</span><input id="tts-custom-favorite-name" name="voiceName" type="text" maxlength="80" autocomplete="off" required></label>
                    <label for="tts-custom-favorite-id"><span>Voice ID</span><input id="tts-custom-favorite-id" name="voiceId" type="text" autocomplete="off" required></label>
                    <label for="tts-custom-favorite-model"><span>语音模型</span><input id="tts-custom-favorite-model" name="voiceModel" type="text" value="${safe(miniMaxSettings.model || 'speech-2.8-hd')}" data-minimax-model="${safe(miniMaxSettings.model || 'speech-2.8-hd')}" data-elevenlabs-model="${safe(elevenLabsSettings.model || 'eleven_multilingual_v2')}" autocomplete="off"></label>
                    <label for="tts-custom-favorite-character"><span>绑定角色路由</span><select id="tts-custom-favorite-character" name="characterName">${renderFavoriteCharacterOptions(characters)}</select></label>
                    <button type="submit">${icon('bookmark', 16)} 收藏音色</button>
                </form>
            </details>
            ${tools.favorites.length ? `
                <label class="voice-tool-search" for="tts-favorite-search">
                    ${icon('search', 17)}<span>搜索收藏</span>
                    <input id="tts-favorite-search" type="search" autocomplete="off" aria-label="搜索收藏声线">
                    <kbd id="tts-favorite-count">${tools.favorites.length}</kbd>
                </label>
                <div id="tts-favorite-list" class="voice-favorite-list" data-preserve-scroll="favorite-list">
                    ${tools.favorites.map(item => renderFavoriteCard(item, characters)).join('')}
                    <p id="tts-favorite-empty" hidden>没有符合条件的收藏。</p>
                </div>
            ` : `<div class="voice-tool-empty">${icon('bookmark', 24)}<strong>收藏夹还是空的</strong></div>`}
        </section>`;
}

function renderConversationResult(track, index = 0) {
    if (!track) {
        return `<div class="voice-tool-empty">${icon('headphones', 24)}<strong>还没有追踪记录</strong></div>`;
    }
    const segments = Array.isArray(track.segments) ? track.segments : [];
    const isPlaying = state.toolPlaybackKey === `track:${track.id}`;
    const activeSegment = isPlaying ? segments[state.toolPlaybackIndex] : null;
    return `
        <article class="voice-track-result ${index === 0 ? 'is-latest' : ''}">
            <header>
                <span>${safe((track.speakers || []).join(' × ') || track.mood)}</span>
                <time>${safe(formatToolTime(track.createdAt))}</time>
                <div class="voice-track-history-actions">
                    <button class="voice-history-regenerate" type="button" data-regenerate-tool-record="track" data-tool-record-id="${safe(track.id)}" aria-label="重新生成对话追踪 ${safe(track.scene)}" title="重新生成" ${state.featureBusy ? 'disabled' : ''}>${icon('refresh', 15)}</button>
                    <button class="voice-history-delete" type="button" data-delete-tool-record="track" data-tool-record-id="${safe(track.id)}" aria-label="删除对话追踪 ${safe(track.scene)}" ${state.featureBusy ? 'disabled' : ''}>${icon('trash', 15)}</button>
                </div>
            </header>
            <h2>${safe(track.scene)}</h2>
            <p>${safe(track.sceneDescription || track.summary)}</p>
            ${track.summary && track.summary !== track.sceneDescription ? `<p class="voice-track-summary">${safe(track.summary)}</p>` : ''}
            ${segments.length ? `
                <details class="voice-private-transcript" ${index === 0 ? 'open' : ''}>
                    <summary>${icon('headphones', 15)} 私聊全文 · ${segments.length} 段</summary>
                    <ol>${segments.map((segment, segmentIndex) => `
                        <li class="${isPlaying && segmentIndex === state.toolPlaybackIndex ? 'is-speaking' : ''}">
                            <span>${safe(segment.speaker)} · ${safe(segment.emotion)}</span>
                            <p>${safe(segment.text)}</p>
                            ${segment.translation && segment.translation !== segment.text ? `<small class="voice-segment-translation">${safe(segment.translation)}</small>` : ''}
                        </li>`).join('')}</ol>
                </details>
                <button class="voice-tool-play" type="button" data-play-tool-audio="track" data-tool-record-id="${safe(track.id)}" ${state.featureBusy ? 'disabled' : ''}>
                    ${icon(state.featureBusy === 'track-audio' ? 'activity' : isPlaying ? 'repeat' : 'play', 18)}
                    ${state.featureBusy === 'track-audio' ? '正在限速生成声线' : isPlaying ? `从头重播 · ${safe(activeSegment?.speaker || '')}` : state.toolAudioCache.has(`track:${track.id}`) ? '重复播放私聊' : '生成并播放私聊'}
                </button>
                ${isPlaying ? `<button class="voice-tool-stop" type="button" data-stop-tool-audio>${icon('close', 16)} 停止播放</button>` : ''}
            ` : '<small>这条旧记录没有私聊全文，请重新生成。</small>'}
        </article>`;
}

function renderTrackCallStage(track) {
    const segments = Array.isArray(track?.segments) ? track.segments : [];
    const activeIndex = Math.min(state.toolPlaybackIndex, Math.max(0, segments.length - 1));
    const activeSegment = segments[activeIndex] || {};
    const speakers = [...new Set((track.speakers?.length ? track.speakers : segments.map(item => item.speaker)).filter(Boolean))];
    const progress = segments.length ? ((activeIndex + 1) / segments.length) * 100 : 0;
    return `
        <section class="voice-call-stage voice-group-call" data-track-call-stage="${safe(track.id)}" aria-labelledby="tts-track-call-title">
            <div class="voice-call-topline"><span>多人语音</span><i></i><span id="tts-track-call-count">${activeIndex + 1} / ${segments.length}</span></div>
            <div class="voice-group-call-heading">
                <small>私聊播放中</small>
                <h1 id="tts-track-call-title">${safe(track.scene || '角色私聊')}</h1>
                <p>${safe(track.sceneDescription || track.summary || '')}</p>
            </div>
            <div class="voice-group-participants" aria-label="私聊参与角色">
                ${speakers.map(speaker => `<span data-track-speaker="${safe(speaker)}" class="${speaker === activeSegment.speaker ? 'is-speaking' : ''}"><i>${safe(speaker.slice(0, 1))}</i><b>${safe(speaker)}</b></span>`).join('')}
            </div>
            <div class="voice-call-visualizer" aria-hidden="true">
                ${Array.from({ length: 15 }, (_, index) => `<i style="--bar:${index}"></i>`).join('')}
            </div>
            <div class="voice-call-subtitle voice-group-subtitle" aria-live="polite">
                <small id="tts-track-call-speaker">${safe(`${activeSegment.speaker || ''} · ${activeSegment.emotion || '自然'}`)}</small>
                <p id="tts-track-call-subtitle">${safe(activeSegment.text || '正在准备角色声线……')}</p>
                <span id="tts-track-call-translation" ${activeSegment.translation && activeSegment.translation !== activeSegment.text ? '' : 'hidden'}>${safe(activeSegment.translation || '')}</span>
            </div>
            <div class="voice-group-progress" aria-label="私聊播放进度"><i id="tts-track-call-progress" style="transform:scaleX(${Math.max(0, Math.min(1, progress / 100))})"></i></div>
            <details class="voice-group-transcript">
                <summary>${icon('layers', 15)} 查看全部台词 · ${segments.length} 段</summary>
                <ol data-preserve-scroll="track-transcript:${safe(track.id)}">
                    ${segments.map((segment, segmentIndex) => `
                        <li data-track-segment="${segmentIndex}" class="${segmentIndex === activeIndex ? 'is-speaking' : ''}">
                            <span>${safe(segment.speaker)} · ${safe(segment.emotion || '自然')}</span>
                            <p>${safe(segment.text)}</p>
                            ${segment.translation && segment.translation !== segment.text ? `<small class="voice-segment-translation">${safe(segment.translation)}</small>` : ''}
                        </li>`).join('')}
                </ol>
            </details>
            <button class="voice-group-hangup" type="button" data-stop-tool-audio>${icon('phone', 24)}<span>结束播放</span></button>
        </section>`;
}

function renderCallRecord(call, index = 0) {
    if (!call) {
        return `<div class="voice-tool-empty">${icon('headphones', 24)}<strong>还没有通话记录</strong><small>到“电话”APP 拨出通话后，回这里重播或收藏。</small></div>`;
    }
    const isGroup = call.kind === 'group' || (Array.isArray(call.speakers) && call.speakers.length > 1);
    const segments = Array.isArray(call.segments) ? call.segments : [];
    const firstSegment = segments[0] || {};
    const speakers = Array.isArray(call.speakers) && call.speakers.length
        ? call.speakers
        : [call.charName || '通话角色'];
    const subtitle = isGroup
        ? `${speakers.join(' × ')} · ${segments.length || 0} 段`
        : `${call.charName || '通话角色'} · ${call.duration === 'long' ? '长' : call.duration === 'medium' ? '普通' : '短'}`;
    const title = call.title || (isGroup ? `${speakers[0]} 等多人通话` : `${call.charName} 的通话`);
    return `
        <article class="voice-call-record ${index === 0 ? 'is-latest' : ''} ${isGroup ? 'is-group' : ''}" data-call-record="${safe(call.id)}">
            <header>
                <span>${safe(subtitle)}</span>
                <time>${safe(formatToolTime(call.createdAt))}</time>
                <span class="voice-call-favorite-flag ${call.favorite ? 'is-active' : ''}" aria-hidden="true">${icon(call.favorite ? 'bookmark' : 'star', 14)}</span>
            </header>
            <h2>${safe(title)}</h2>
            <p>${safe(call.reason || firstSegment.text || '没有留下通话原因')}</p>
            ${isGroup ? `<small class="voice-call-speakers">${speakers.map(speaker => `<span><i>${safe(speaker.slice(0, 1))}</i>${safe(speaker)}</span>`).join('')}</small>` : ''}
            <footer>
                <button type="button" data-start-phone-call="${safe(call.id)}">${icon('play', 16)} 重听</button>
                <button class="voice-history-regenerate" type="button" data-regenerate-tool-record="phone" data-tool-record-id="${safe(call.id)}" aria-label="重新生成通话 ${safe(title)}" title="重新生成" ${state.featureBusy ? 'disabled' : ''}>${icon('refresh', 15)}</button>
                <button type="button" data-toggle-call-favorite="${safe(call.id)}" aria-pressed="${call.favorite ? 'true' : 'false'}">${icon(call.favorite ? 'bookmark' : 'star', 15)} ${call.favorite ? '已收藏' : '收藏'}</button>
                <button class="voice-history-delete" type="button" data-delete-tool-record="phone" data-tool-record-id="${safe(call.id)}" aria-label="删除通话 ${safe(title)}">${icon('trash', 15)}</button>
            </footer>
        </article>`;
}

function renderTracksPanel() {
    const tools = FrontendVoiceTools.getSnapshot();
    const calls = Array.isArray(tools.calls) ? tools.calls : [];
    const filtered = state.tracksFilter === 'favorites'
        ? calls.filter(call => call.favorite === true)
        : calls;
    return `
        <section class="voice-secondary-view voice-tool-view" aria-labelledby="voice-tracks-heading">
            <div class="voice-kicker">${icon('headphones', 15)} 通话记录库</div>
            <h1 id="voice-tracks-heading">追踪</h1>
            <nav class="voice-tracks-filter" aria-label="通话过滤">
                <button type="button" data-set-tracks-filter="all" class="${state.tracksFilter !== 'favorites' ? 'is-active' : ''}">全部 · ${calls.length}</button>
                <button type="button" data-set-tracks-filter="favorites" class="${state.tracksFilter === 'favorites' ? 'is-active' : ''}">收藏 · ${calls.filter(call => call.favorite).length}</button>
            </nav>
            ${filtered.length ? `<div class="voice-history-stack" data-preserve-scroll="tracks-list" aria-label="通话记录">
                ${filtered.map((call, index) => renderCallRecord(call, index)).join('')}
            </div>` : renderCallRecord(null)}
        </section>`;
}

function renderEavesdropPanel() {
    return renderTracksPanel();
}

function formatChatClock(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function chatMessagePreview(message) {
    if (!message) return '消息不存在';
    if (message.type === 'recalled') return '这条消息已撤回';
    const prefix = message.type === 'image' ? '[图片] '
        : message.type === 'transfer' ? `[转账] ${message.amount || ''} 元`
            : message.type === 'sticker' ? `[表情包] ${message.stickerName || ''}`
                : message.type === 'voice' ? '[语音] ' : '';
    const value = `${prefix}${String(message.translation || message.description || message.note || message.content || '').trim()}`;
    return value.length > 52 ? `${value.slice(0, 52)}…` : value;
}

function renderPhoneChatMessage(message, thread) {
    if (message.type === 'recalled') {
        return `<li class="voice-chat-recalled" data-chat-message-id="${safe(message.id)}"><span>${message.sender === 'user' ? '你' : safe(thread.charName)}撤回了一条消息</span></li>`;
    }
    const sent = message.sender === 'user';
    const quoted = message.replyToId ? thread.messages.find(item => item.id === message.replyToId) : null;
    const actionsOpen = state.chatActionId === message.id;
    const playing = state.chatAudioKey === message.id;
    const isVoice = message.type === 'voice';
    const voiceExpanded = isVoice && state.chatVoiceExpanded.has(message.id);
    const stickerImage = message.type === 'sticker' && message.stickerUrl
        ? `<img class="voice-chat-sticker-image" src="${safe(message.stickerUrl)}" alt="${safe(message.stickerName || '表情包')}">`
        : '';
    const richContent = message.type === 'image' ? `
        <div class="voice-chat-rich-card is-image">${icon('image', 20)}<span><strong>图片</strong><small>${safe(message.description || message.content || '未填写描述')}</small></span></div>`
        : message.type === 'transfer' ? `
            <div class="voice-chat-rich-card is-transfer">${icon('wallet', 20)}<span><small>转账</small><strong>${safe(message.amount || '0')} 元</strong>${message.note ? `<em>${safe(message.note)}</em>` : ''}</span></div>`
            : message.type === 'sticker' ? `
                <div class="voice-chat-rich-card is-sticker">
                    ${stickerImage || icon('gift', 22)}
                    <span><small>表情包</small><strong>${safe(message.stickerName || message.note || '未命名')}</strong></span>
                </div>`
                : '';
    return `
        <li class="voice-chat-message ${sent ? 'is-sent' : 'is-received'} ${isVoice ? 'is-voice' : ''} ${actionsOpen ? 'is-actions-open' : ''}" data-chat-message-id="${safe(message.id)}">
            ${sent ? '' : renderCallerAvatar({ charName: thread.charName, avatarUrl: thread.avatarUrl }, 'voice-chat-avatar')}
            <div class="voice-chat-message-stack">
                <div class="voice-chat-bubble">
                    ${quoted ? `<button class="voice-chat-quote-card" type="button" data-chat-jump-message="${safe(quoted.id)}"><small>${safe(quoted.sender === 'user' ? thread.userName : thread.charName)}</small><span>${safe(chatMessagePreview(quoted))}</span></button>` : ''}
                    ${richContent || (isVoice ? `
                        <button class="voice-chat-voice-note ${playing ? 'is-playing' : ''}" type="button" data-toggle-chat-voice="${safe(message.id)}" data-character-voice="${sent ? 'false' : 'true'}" aria-expanded="${voiceExpanded}" aria-label="${voiceExpanded ? (sent ? '语音文本已展开' : `${playing ? '停止' : '播放'} ${safe(thread.charName)} 的语音消息`) : '展开并播放语音消息'}">
                            ${icon(playing ? 'volume' : 'play', 18)}
                            <span aria-hidden="true">${Array.from({ length: 11 }, (_, index) => `<i style="--bar:${index}"></i>`).join('')}</span>
                            <strong>${playing ? '播放中' : `${safe(message.duration || '')}${message.duration ? ' 秒' : '语音'}`}</strong>
                        </button>
                        ${voiceExpanded ? `<div class="voice-chat-voice-transcript"><p>${safe(message.content)}</p>${message.translation && message.translation !== message.content ? `<small class="voice-chat-translation">${safe(message.translation)}</small>` : ''}</div>` : ''}
                    ` : `<p>${safe(message.content)}</p>`)}
                    ${!isVoice && message.translation && message.translation !== message.content ? `<small class="voice-chat-translation">${safe(message.translation)}</small>` : ''}
                    <time>${safe(formatChatClock(message.createdAt))}</time>
                </div>
                <button class="voice-chat-more" type="button" data-toggle-chat-actions="${safe(message.id)}" aria-expanded="${actionsOpen}" aria-label="消息操作">${icon('settings', 14)}</button>
                <div class="voice-chat-message-actions" aria-label="消息操作">
                    <button type="button" data-quote-chat-message="${safe(message.id)}">${icon('quote', 14)} 引用</button>
                    ${sent ? '' : `<button type="button" data-play-chat-voice="${safe(message.id)}">${icon('volume', 14)} 朗读</button>`}
                    <button type="button" data-recall-chat-message="${safe(message.id)}">${icon('undo', 14)} 撤回</button>
                </div>
            </div>
        </li>`;
}

function renderPhoneChat() {
    const tools = FrontendVoiceTools.getSnapshot();
    const chat = tools.phoneChat || { settings: {}, presets: [], thread: { messages: [] } };
    const context = tools.context;
    const thread = chat.thread || { messages: [] };
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    const qq = TTS_ProviderRegistry.getQqState();
    const stickers = Array.isArray(qq.stickers) ? qq.stickers : [];
    const quoted = state.chatQuoteId ? messages.find(item => item.id === state.chatQuoteId) : null;
    const proactiveBusy = state.featureBusy === 'phone-chat-proactive';
    const busy = state.featureBusy === 'phone-chat' || proactiveBusy;
    const chatCallBusy = state.featureBusy === 'chat-call';
    const pendingCount = Number(chat.pendingCount) || 0;
    const composerTool = state.chatComposerTool;
    const hasComposerTool = ['voice', 'image', 'transfer', 'sticker'].includes(composerTool);
    const replyMode = pendingCount > 0 && !hasComposerTool;
    return `
        <section class="voice-secondary-view voice-chat-app" aria-labelledby="voice-chat-heading">
            <h1 id="voice-chat-heading">角色聊天</h1>
            <header class="voice-chat-contact">
                <span>${renderCallerAvatar(context, 'voice-chat-contact-avatar')}</span>
                <div><strong>${safe(context.charName || '未选择角色')}</strong><small>${context.available ? '可聊天 · 使用当前角色卡与世界书' : '请先打开角色对话'}</small></div>
                <button class="voice-chat-call-button ${chatCallBusy ? 'is-busy' : ''}" type="button" data-start-chat-call aria-label="${chatCallBusy ? '正在生成语音通话' : `与 ${safe(context.charName || '角色')} 语音通话`}" ${!context.available || busy || chatCallBusy ? 'disabled' : ''}>
                    <span class="voice-chat-call-handset">${icon('phone', 18)}</span>
                    <span class="voice-chat-call-waves" aria-hidden="true"><i></i><i></i><i></i></span>
                </button>
                <button type="button" data-route="chat-settings" aria-label="聊天设置">${icon('settings', 18)}</button>
            </header>
            <ol class="voice-chat-thread" data-preserve-scroll="phone-chat:${safe(thread.id || 'current')}" aria-live="polite">
                ${messages.length
                    ? messages.map(message => renderPhoneChatMessage(message, thread)).join('')
                    : `<li class="voice-chat-empty"><span>${icon('messageCircle', 28)}</span><strong>开始手机私聊</strong><small>回复会读取当前角色卡、最近楼层与激活的世界书。</small></li>`}
                ${busy ? `<li class="voice-chat-typing"><span></span><span></span><span></span><small>${safe(context.charName)} 正在输入</small></li>` : ''}
            </ol>
            <form class="voice-chat-composer" data-phone-chat-form data-pending-count="${pendingCount}" data-chat-available="${context.available}">
                ${quoted ? `<div class="voice-chat-compose-quote"><span><small>回复 ${safe(quoted.sender === 'user' ? thread.userName : thread.charName)}</small><strong>${safe(chatMessagePreview(quoted))}</strong></span><button type="button" data-cancel-chat-quote aria-label="取消引用">${icon('close', 15)}</button></div>` : ''}
                <div class="voice-chat-tool-strip ${composerTool ? 'is-open' : ''}" aria-label="消息类型">
                    <button type="button" data-chat-composer-tool="image" class="${composerTool === 'image' ? 'is-active' : ''}">${icon('image', 15)}<span>图片</span></button>
                    <button type="button" data-chat-composer-tool="transfer" class="${composerTool === 'transfer' ? 'is-active' : ''}">${icon('wallet', 15)}<span>转账</span></button>
                    <button type="button" data-chat-composer-tool="sticker" class="${composerTool === 'sticker' ? 'is-active' : ''}">${icon('gift', 15)}<span>表情包</span></button>
                    <button type="button" data-chat-composer-tool="voice" class="${composerTool === 'voice' ? 'is-active' : ''}">${icon('microphone', 15)}<span>语音</span></button>
                </div>
                ${composerTool === 'transfer' ? `
                    <div class="voice-chat-money-fields">
                        <label><span>金额</span><input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal"></label>
                        <label><span>备注</span><input name="note" type="text" maxlength="300"></label>
                    </div>` : ''}
                ${composerTool === 'sticker' ? `
                    <div class="voice-chat-sticker-fields">
                        ${stickers.length
                            ? `<div class="voice-chat-sticker-grid">
                                ${stickers.map(sticker => `<label class="voice-chat-sticker-item">
                                    <input type="radio" name="stickerName" value="${safe(sticker.name)}" data-sticker-url="${safe(sticker.url)}">
                                    <img src="${safe(sticker.url)}" alt="${safe(sticker.name)}" loading="lazy">
                                    <span>${safe(sticker.name || '未命名')}</span>
                                </label>`).join('')}
                            </div>`
                            : '<p class="voice-chat-empty">还没有表情包，先到“设置 · 表情包”里批量导入。</p>'}
                        <label><span>或者输入名字</span><input name="stickerName" type="text" maxlength="80" placeholder="表情包名字"></label>
                    </div>` : ''}
                <label class="sr-only" for="tts-phone-chat-input">发送消息</label>
                <button class="voice-chat-plus ${composerTool ? 'is-active' : ''}" type="button" data-toggle-chat-tools aria-label="${composerTool ? '返回文字消息' : '更多消息类型'}" ${!context.available || busy ? 'disabled' : ''}>${icon(composerTool ? 'close' : 'plus', 18)}</button>
                <textarea id="tts-phone-chat-input" name="message" rows="1" maxlength="12000" aria-label="${composerTool === 'image' ? '描述图片内容' : composerTool === 'voice' ? '填写语音转写内容' : `发送给 ${safe(context.charName || '角色')} 的消息`}" ${!context.available || busy ? 'disabled' : ''}></textarea>
                <button class="voice-chat-send ${replyMode ? 'is-reply' : ''}" type="submit" data-chat-submit-mode="${replyMode ? 'reply' : 'send'}" aria-label="${replyMode ? `让 ${safe(context.charName || '角色')} 回复` : '发送消息'}" title="${replyMode ? '让角色回复' : '发送消息'}" ${!context.available || busy || !replyMode ? 'disabled' : ''}>${icon(busy ? 'activity' : 'send', 18)}</button>
            </form>
        </section>`;
}

function renderPhoneChatSettings() {
    const chat = FrontendVoiceTools.getPhoneChatSnapshot();
    const settings = chat.settings;
    return `
        <section class="voice-secondary-view voice-chat-settings" aria-labelledby="voice-chat-settings-heading">
            <h1 id="voice-chat-settings-heading">聊天设置</h1>
            <section class="voice-chat-settings-summary">
                ${icon('messageCircle', 20)}<span><strong>${safe(chat.context.charName || '当前角色')}</strong><small>沿用 ${safe(FrontendVoiceTools.plannerLabel())}，并读取角色卡和世界书</small></span>
            </section>
            <form class="voice-chat-settings-form" data-phone-chat-settings-form>
                <div class="voice-chat-setting-row">
                    <label for="tts-chat-history-limit"><span>手机消息上下文</span><small>按消息条数读取</small></label>
                    <input id="tts-chat-history-limit" name="maxHistory" type="number" min="8" max="240" step="1" value="${safe(settings.maxHistory)}">
                </div>
                <label class="voice-chat-switch" for="tts-chat-auto-voice"><span><strong>角色默认发语音</strong><small>每次回复都生成可播放的 TTS 语音消息</small></span><input id="tts-chat-auto-voice" name="autoVoice" type="checkbox" ${settings.autoVoice ? 'checked' : ''}><i></i></label>
                <button class="voice-button primary wide" type="submit">${icon('check', 17)} 保存聊天设置</button>
            </form>
            <button class="voice-prompt-manager-link" type="button" data-open-prompt-workflow="chat">${icon('layers', 18)}<span><strong>聊天预设管理</strong><small>调整 system、user、assistant 条目，排序、导入与导出</small></span>${icon('chevronRight', 17)}</button>
            <button class="voice-chat-clear" type="button" data-clear-phone-chat>${icon('trash', 16)} 清空当前角色的手机聊天记录</button>
        </section>`;
}

function renderPromptManager() {
    const workflow = FrontendVoiceTools.getPromptWorkflow(state.promptWorkflow);
    const entries = workflow.entries || [];
    const activePreset = workflow.presets.find(item => item.id === workflow.activePresetId);
    const variableHints = {
        body: '{{角色}}、{{用户}}、{{语言}}、{{格式}}',
        single_call: '{{角色}}、{{用户}}、{{长度}}、{{语言}}、{{可用声线}}、{{角色卡与世界书}}、{{任务上下文}}、{{输出格式}}',
        group_call: '{{角色}}、{{用户}}、{{长度}}、{{语言}}、{{可用声线}}、{{角色卡与世界书}}、{{任务上下文}}、{{输出格式}}',
        chat: '{{角色}}、{{用户}}、{{语言}}、{{角色卡与世界书}}、{{聊天记录}}、{{待回复消息}}、{{任务上下文}}、{{输出格式}}',
        image: '{{角色}}、{{用户}}、{{角色卡与世界书}}、{{任务上下文}}、{{输出格式}}',
    };
    const tabLabels = {
        body: '正文',
        single_call: '单人通话',
        group_call: '多人通话',
        chat: '聊天',
        image: '生图',
    };
    return `
        <section class="voice-secondary-view voice-prompt-manager" aria-labelledby="voice-prompt-manager-heading">
            <h1 id="voice-prompt-manager-heading">提示词预设</h1>
            <p class="voice-prompt-manager-intro">条目会从上到下按真实消息顺序发送给模型。每个条目都可以选择 system、user 或 assistant。</p>
            <nav class="voice-prompt-workflow-tabs" aria-label="提示词用途">
                ${Object.entries(tabLabels).map(([kind, label]) => `<button type="button" data-select-prompt-workflow="${kind}" class="${workflow.kind === kind ? 'is-active' : ''}">${label}</button>`).join('')}
            </nav>
            <section class="voice-prompt-preset-manager">
                <header><span><strong>${safe(workflow.label)}预设</strong><small>${workflow.presets.length} 个已保存预设</small></span><button type="button" data-reset-prompt-workflow>${icon('refresh', 15)} 默认</button></header>
                <div class="voice-prompt-depth-row">
                    <label for="tts-workflow-depth"><span>整体插入深度</span><input id="tts-workflow-depth" type="number" min="0" max="20" step="1" value="${safe(workflow.depth ?? 0)}" inputmode="numeric" data-prompt-workflow-depth><small>0 紧贴生成内容，20 插到更靠前的位置。</small></label>
                </div>
                <div class="voice-prompt-preset-row">
                    <select id="tts-workflow-preset-select" aria-label="选择${safe(workflow.label)}预设">
                        <option value="">当前编辑</option>
                        ${workflow.presets.map(item => `<option value="${safe(item.id)}" ${item.id === workflow.activePresetId ? 'selected' : ''}>${safe(item.name)}</option>`).join('')}
                    </select>
                    <button type="button" data-apply-workflow-preset ${workflow.presets.length ? '' : 'disabled'}>${icon('check', 15)} 应用</button>
                    <button type="button" data-delete-workflow-preset ${activePreset ? '' : 'disabled'} aria-label="删除当前预设">${icon('trash', 15)}</button>
                </div>
                <div class="voice-prompt-preset-row is-save">
                    <label class="sr-only" for="tts-workflow-preset-name">新预设名称</label><input id="tts-workflow-preset-name" type="text" maxlength="60" value="${safe(activePreset?.name || '')}" aria-label="新预设名称" autocomplete="off">
                    <button type="button" data-save-workflow-preset>${icon('plus', 15)} 另存为</button>
                </div>
                <div class="voice-prompt-file-actions">
                    <button type="button" data-export-prompt-workflow>${icon('download', 15)} 导出当前</button>
                    <button type="button" data-export-all-prompt-workflows>${icon('download', 15)} 导出全部</button>
                    <button type="button" data-import-prompt-workflows>${icon('upload', 15)} 导入</button>
                    <input id="tts-prompt-import-file" type="file" accept="application/json,.json" hidden>
                </div>
            </section>
            <div class="voice-prompt-variable-note">可用变量：${safe(variableHints[workflow.kind])}</div>
            <div class="voice-prompt-entry-list" data-prompt-entry-list data-workflow-kind="${safe(workflow.kind)}">
                ${entries.map((entry, index) => `
                    <article class="voice-prompt-entry" data-prompt-entry-id="${safe(entry.id)}">
                        <header>
                            <span class="voice-prompt-grip">${icon('grip', 17)}<small>${index + 1}</small></span>
                            <input data-prompt-entry-name type="text" maxlength="80" value="${safe(entry.name)}" aria-label="条目名称">
                            <label class="voice-prompt-entry-toggle" title="启用条目"><input data-prompt-entry-enabled type="checkbox" ${entry.enabled ? 'checked' : ''}><i></i></label>
                        </header>
                        <div class="voice-prompt-entry-meta">
                            <label><span>角色</span><select data-prompt-entry-role><option value="system" ${entry.role === 'system' ? 'selected' : ''}>system</option><option value="user" ${entry.role === 'user' ? 'selected' : ''}>user</option><option value="assistant" ${entry.role === 'assistant' ? 'selected' : ''}>assistant</option></select></label>
                            <div class="voice-prompt-entry-actions">
                                <button type="button" data-move-prompt-entry="up" ${index === 0 ? 'disabled' : ''} aria-label="上移">${icon('arrowUp', 15)}</button>
                                <button type="button" data-move-prompt-entry="down" ${index === entries.length - 1 ? 'disabled' : ''} aria-label="下移">${icon('arrowDown', 15)}</button>
                                <button type="button" data-insert-prompt-entry aria-label="在下方插入">${icon('plus', 15)}</button>
                                <button type="button" data-delete-prompt-entry aria-label="删除条目">${icon('trash', 15)}</button>
                            </div>
                        </div>
                        <textarea data-prompt-entry-content rows="${entry.content.length > 500 ? 9 : 5}" maxlength="50000" aria-label="${safe(entry.name)}内容">${safe(entry.content)}</textarea>
                    </article>`).join('')}
            </div>
            <button class="voice-button primary wide voice-prompt-save-current" type="button" data-save-prompt-workflow>${icon('check', 17)} 保存当前条目顺序</button>
        </section>`;
}

function renderPromptLab() {
    const kinds = { body: '正文', single_call: '单人通话', group_call: '多人通话', chat: '聊天', image: '生图' };
    const compiled = FrontendVoiceTools.compilePromptWorkflow(state.promptLabKind);
    const revisions = FrontendVoiceTools.getPromptWorkflowRevisions(state.promptLabKind);
    const busy = state.featureBusy === 'prompt-lab';
    const hasError = compiled.issues.some(issue => issue.severity === 'error');
    const result = state.promptLabResult?.kind === state.promptLabKind ? state.promptLabResult : null;
    const error = state.promptLabError;
    return `
        <section class="voice-secondary-view voice-prompt-lab" aria-labelledby="voice-prompt-lab-heading">
            <h1 id="voice-prompt-lab-heading">提示词实验室</h1>
            <nav class="voice-prompt-workflow-tabs" aria-label="提示词用途">
                ${Object.entries(kinds).map(([kind, label]) => `<button type="button" data-prompt-lab-kind="${kind}" class="${compiled.kind === kind ? 'is-active' : ''}">${label}</button>`).join('')}
            </nav>
            <section class="voice-prompt-lab-dashboard" aria-label="提示词统计">
                <article><strong>${compiled.stats.enabledEntries}/${compiled.stats.entries}</strong><small>启用条目</small></article>
                <article><strong>${compiled.stats.messages}</strong><small>实际消息</small></article>
                <article><strong>约 ${compiled.stats.estimatedTokens}</strong><small>Token</small></article>
            </section>
            <section class="voice-prompt-lab-checks ${hasError ? 'has-error' : ''}" aria-labelledby="voice-prompt-lab-checks-heading">
                <header><span>${icon(hasError ? 'info' : 'check', 18)}<strong id="voice-prompt-lab-checks-heading">结构检查</strong></span><small>${hasError ? '需要修正' : '可以试运行'}</small></header>
                <ul>
                    ${compiled.issues.map(issue => `<li class="is-${safe(issue.severity)}"><i></i><span>${safe(issue.message)}</span></li>`).join('')}
                </ul>
            </section>
            <div class="voice-prompt-lab-actions">
                <button type="button" data-prompt-lab-edit>${icon('edit', 17)} 编辑条目</button>
                <button class="is-primary" type="button" data-test-prompt-workflow ${busy || hasError ? 'disabled' : ''}>${icon(busy ? 'activity' : 'play', 17)} ${busy ? '正在试运行' : '调用当前模型'}</button>
            </div>
            ${error ? `<section class="voice-prompt-lab-result is-error" role="alert"><header><strong>试运行失败</strong></header><pre>${safe(error)}</pre></section>` : ''}
            ${result ? `<section class="voice-prompt-lab-result" aria-labelledby="voice-prompt-lab-result-heading"><header><strong id="voice-prompt-lab-result-heading">模型返回</strong><time>${safe(formatToolTime(result.createdAt))}</time></header><pre>${safe(result.output)}</pre></section>` : ''}
            <section class="voice-prompt-lab-messages" aria-labelledby="voice-prompt-lab-messages-heading">
                <header><strong id="voice-prompt-lab-messages-heading">实际发送消息</strong><small>从上到下</small></header>
                <div>
                    ${compiled.messages.map((message, index) => `<article>
                        <header><span><b>${index + 1}</b><strong>${safe(message.name)}</strong></span><code>${safe(message.role)}</code></header>
                        <pre>${safe(message.content)}</pre>
                    </article>`).join('') || '<p class="voice-prompt-lab-empty">没有可发送的消息</p>'}
                </div>
            </section>
            <details class="voice-prompt-lab-variables">
                <summary><span>${icon('database', 17)}<strong>变量预览</strong></span><small>${Object.keys(compiled.values).length} 项</small>${icon('chevronRight', 15)}</summary>
                <dl>
                    ${Object.entries(compiled.values).map(([key, value]) => `<div><dt>{{${safe(key)}}}</dt><dd>${safe(value)}</dd></div>`).join('')}
                </dl>
            </details>
            <section class="voice-prompt-lab-revisions" aria-labelledby="voice-prompt-lab-revisions-heading">
                <header><span><strong id="voice-prompt-lab-revisions-heading">版本记录</strong><small>${revisions.length} 个快照</small></span>${icon('repeat', 18)}</header>
                <div class="voice-prompt-lab-revision-save">
                    <label class="sr-only" for="tts-prompt-revision-name">版本名称</label>
                    <input id="tts-prompt-revision-name" type="text" maxlength="60" autocomplete="off" aria-label="版本名称">
                    <button type="button" data-save-prompt-revision>${icon('plus', 15)} 保存快照</button>
                </div>
                <div class="voice-prompt-lab-revision-list" data-preserve-scroll="prompt-lab-revisions">
                    ${revisions.map(revision => `<article>
                        <div><strong>${safe(revision.name)}</strong><time>${safe(formatToolTime(revision.createdAt))}</time></div>
                        <button type="button" data-restore-prompt-revision="${safe(revision.id)}" aria-label="恢复版本 ${safe(revision.name)}">${icon('undo', 15)} 恢复</button>
                        <button class="is-danger" type="button" data-delete-prompt-revision="${safe(revision.id)}" aria-label="删除版本 ${safe(revision.name)}">${icon('trash', 15)}</button>
                    </article>`).join('') || '<p class="voice-prompt-lab-empty">还没有保存版本</p>'}
                </div>
            </section>
        </section>`;
}

function renderNotificationCenter() {
    const counts = {
        all: state.notifications.length,
        unread: unreadVoiceNotificationCount(),
        error: state.notifications.filter(item => item.level === 'error').length,
    };
    const notifications = state.notifications.filter(item => (
        state.notificationFilter === 'unread' ? !item.read
            : state.notificationFilter === 'error' ? item.level === 'error'
                : true
    ));
    return `
        <section class="voice-secondary-view voice-notification-center" aria-labelledby="voice-notification-heading">
            <h1 id="voice-notification-heading">通知中心</h1>
            <section class="voice-notification-summary">
                <span>${icon('bell', 22)}</span>
                <div><strong>${counts.unread}</strong><small>未读通知</small></div>
                <div><strong>${counts.error}</strong><small>需要处理</small></div>
            </section>
            <nav class="voice-notification-filters" aria-label="通知筛选">
                ${Object.entries({ all: `全部 ${counts.all}`, unread: `未读 ${counts.unread}`, error: `异常 ${counts.error}` }).map(([filter, label]) => `<button type="button" data-notification-filter="${filter}" class="${state.notificationFilter === filter ? 'is-active' : ''}">${label}</button>`).join('')}
            </nav>
            <div class="voice-notification-actions">
                <button type="button" data-mark-all-notifications-read ${counts.unread ? '' : 'disabled'}>${icon('check', 15)} 全部已读</button>
                <button type="button" data-clear-notifications ${counts.all ? '' : 'disabled'}>${icon('trash', 15)} 清空记录</button>
            </div>
            <div class="voice-notification-list" data-preserve-scroll="notification-list">
                ${notifications.map(item => `<article class="is-${safe(item.level)} ${item.read ? 'is-read' : 'is-unread'}">
                    <button class="voice-notification-main" type="button" data-open-notification="${safe(item.id)}">
                        <span>${icon(item.level === 'success' ? 'check' : item.level === 'error' ? 'info' : item.level === 'warning' ? 'activity' : 'bell', 17)}</span>
                        <div><strong>${safe(item.title)}</strong>${item.body ? `<p>${safe(item.body)}</p>` : ''}<time>${safe(formatToolTime(item.createdAt))}</time></div>
                        ${item.route ? icon('chevronRight', 15) : ''}
                    </button>
                    <button class="voice-notification-delete" type="button" data-delete-notification="${safe(item.id)}" aria-label="删除通知 ${safe(item.title)}">${icon('close', 14)}</button>
                </article>`).join('') || '<p class="voice-notification-empty">这里还没有通知</p>'}
            </div>
        </section>`;
}

function renderBackupCenter() {
    const registry = getSnapshot();
    const tools = FrontendVoiceTools.getSnapshot();
    const routeCount = Object.keys(registry.characterRoutes || {}).length;
    const promptCount = Object.values(tools.promptWorkflows || {}).reduce((sum, workflow) => sum + (workflow.presets?.length || 0), 0);
    const historyCount = (tools.calls?.length || 0) + (tools.tracks?.length || 0) + (tools.phoneChat?.thread?.messages?.length || 0);
    return `
        <section class="voice-secondary-view voice-backup-center" aria-labelledby="voice-backup-heading">
            <h1 id="voice-backup-heading">数据备份</h1>
            <section class="voice-backup-overview" aria-label="备份内容概览">
                <article><span>${icon('radio', 18)}</span><strong>${registry.providers.length}</strong><small>语音引擎</small></article>
                <article><span>${icon('users', 18)}</span><strong>${routeCount}</strong><small>角色路由</small></article>
                <article><span>${icon('layers', 18)}</span><strong>${promptCount}</strong><small>提示词预设</small></article>
                <article><span>${icon('messageCircle', 18)}</span><strong>${historyCount}</strong><small>手机记录</small></article>
            </section>
            <section class="voice-backup-card is-export">
                <header><span>${icon('download', 20)}<div><strong>导出完整备份</strong><small>${state.lastBackupAt ? `上次导出 ${safe(formatToolTime(state.lastBackupAt))}` : '尚未导出'}</small></div></span></header>
                <button class="voice-button primary wide" type="button" data-export-voice-backup>${icon('download', 17)} 导出备份文件</button>
            </section>
            <section class="voice-backup-card">
                <header><span>${icon('upload', 20)}<div><strong>从文件恢复</strong><small>恢复引擎、角色、预设与手机记录</small></div></span></header>
                <button class="voice-button wide" type="button" data-import-voice-backup>${icon('upload', 17)} 选择备份文件</button>
                <input id="tts-voice-backup-file" type="file" accept="application/json,.json" hidden>
            </section>
            <aside class="voice-backup-security">${icon('key', 17)}<span><strong>密钥不会导出</strong><small>API Key 与酒馆密钥库内容保留在本机。</small></span></aside>
            ${state.restoreRollback ? `<section class="voice-backup-rollback"><span><strong>已保留恢复前状态</strong><small>本次打开手机期间可撤销。</small></span><button type="button" data-undo-backup-restore>${icon('undo', 16)} 撤销恢复</button></section>` : ''}
        </section>`;
}

function renderPanel() {
    if (state.route === 'incoming') return renderIncomingPanel();
    if (state.route === 'favorites') return renderFavoritesPanel();
    if (state.route === 'tracks' || state.route === 'eavesdrop') return renderTracksPanel();
    return renderHome();
}

function renderRoute() {
    if (state.route === 'home') return renderHome();
    if (state.route === 'qq') return renderQqApp();
    if (state.route === 'tasks') return renderTaskCenter();
    if (state.route === 'contacts') return renderContactsApp();
    if (state.route === 'chat') return renderPhoneChat();
    if (state.route === 'chat-settings') return renderPhoneChatSettings();
    if (state.route === 'prompt-manager') return renderPromptManager();
    if (state.route === 'prompt-lab') return renderPromptLab();
    if (state.route === 'notifications') return renderNotificationCenter();
    if (state.route === 'backup') return renderBackupCenter();
    if (state.route === 'engines') return renderEnginesApp();
    if (state.route === 'provider') return renderProviderConsole();
    if (state.route === 'library') return renderLibrary();
    if (state.route === 'tracks' || state.route === 'eavesdrop') return renderTracksPanel();
    if (state.route === 'drawing') return renderDrawingPanel();
    if (state.route === 'themes') return renderThemesPanel();
    if (state.route === 'settings') return renderSettings();
    return renderPanel();
}

function currentRenderKey() {
    if (state.route === 'incoming') return `incoming:${state.phoneStage}`;
    return state.route;
}

function captureScrollState(screen) {
    return {
        screen: screen.scrollTop,
        nested: [...screen.querySelectorAll('[data-preserve-scroll]')].map(element => ({
            key: element.dataset.preserveScroll,
            top: element.scrollTop,
        })),
    };
}

function restoreScrollState(screen, scrollState) {
    screen.scrollTop = scrollState.screen;
    scrollState.nested.forEach(item => {
        const element = [...screen.querySelectorAll('[data-preserve-scroll]')]
            .find(node => node.dataset.preserveScroll === item.key);
        if (element) element.scrollTop = item.top;
    });
}

function getPhoneHeaderMeta() {
    const context = FrontendVoiceTools.getContextSnapshot();
    if (state.route === 'qq') return { title: 'QQ', subtitle: '好友与群聊' };
    if (state.route === 'chat') return { title: context.charName || '聊天', subtitle: '手机私聊' };
    if (state.route === 'chat-settings') return { title: '聊天设置', subtitle: context.charName || '提示词与语音' };
    if (state.route === 'prompt-manager') return { title: '提示词预设', subtitle: FrontendVoiceTools.getPromptWorkflow(state.promptWorkflow).label };
    if (state.route === 'prompt-lab') return { title: '提示词实验室', subtitle: FrontendVoiceTools.getPromptWorkflow(state.promptLabKind).label };
    if (state.route === 'notifications') return { title: '通知中心', subtitle: `${unreadVoiceNotificationCount()} 条未读` };
    if (state.route === 'backup') return { title: '数据备份', subtitle: '导入与恢复' };
    if (state.route === 'engines') return { title: '引擎', subtitle: '语音服务' };
    if (state.route === 'drawing') return { title: '绘画', subtitle: 'NovelAI 文生图' };
    if (state.route === 'themes') return { title: '主题', subtitle: '日间 / 夜间 / 跟随酒馆 / 自定义' };
    if (state.route === 'tasks') return { title: '任务中心', subtitle: '生成队列' };
    if (state.route === 'contacts') return { title: '通讯录', subtitle: '角色与声线' };
    if (state.route === 'provider') return { title: currentProvider().name, subtitle: '语音引擎' };
    if (state.route === 'library') return { title: '角色路由', subtitle: context.charName || '声线管理' };
    if (state.route === 'incoming') return { title: '电话', subtitle: '外呼通话' };
    if (state.route === 'favorites') return { title: '声线', subtitle: '收藏与复刻' };
    if (state.route === 'tracks' || state.route === 'eavesdrop') return { title: '追踪', subtitle: '通话记录库' };
    if (state.route === 'settings') {
        const tabTitle = {
            model: '模型来源',
            display: '显示与语言',
            prompts: '全部提示词',
            body: '正文TTS',
            qq: 'QQ与主动来电',
            stickers: '表情包',
            cache: '语音缓存',
        }[state.settingsTab];
        return tabTitle
            ? { title: `设置 · ${tabTitle}`, subtitle: '点左上角返回设置首页' }
            : { title: '设置', subtitle: '语音与编排' };
    }
    return { title: '语音', subtitle: context.charName || '角色声线' };
}

function islandTargetRoute() {
    if (state.route === 'incoming' || ['ringing', 'connecting', 'active'].includes(state.phoneStage)) return 'incoming';
    const busy = state.featureBusy;
    if (busy === 'chat-call') return 'incoming';
    if (['phone-audio', 'chat-voice', 'phone-chat', 'phone-chat-proactive'].includes(busy)) return 'chat';
    if (['phone-plan', 'phone-regenerate'].includes(busy)) return 'incoming';
    if (busy === 'phone-chat') return 'chat';
    return '';
}

function syncIslandState() {
    const island = document.querySelector('.voice-device-island');
    if (!island) return;
    const busy = state.featureBusy;
    const snapshot = getGenerationTaskSnapshot();
    const queueActive = Number(snapshot.counts.generating || 0) + Number(snapshot.counts.queued || 0) > 0;
    let islandState = 'idle';
    let label = '';
    if (state.phoneStage === 'ringing') { islandState = 'ringing'; label = '来电'; }
    else if (state.phoneStage === 'connecting') { islandState = 'preparing_call'; label = '呼叫中'; }
    else if (state.phoneStage === 'active') { islandState = 'connected'; label = '通话中'; }
    else if (busy === 'chat-call') { islandState = 'preparing_call'; label = '准备通话'; }
    else if (['phone-audio', 'chat-voice', 'phone-chat', 'phone-chat-proactive', 'conversation-track', 'track-regenerate'].includes(busy)) {
        islandState = 'synthesizing'; label = '合成中';
    }
    else if (['phone-plan', 'phone-regenerate', 'prompt-lab'].includes(busy) || queueActive) {
        islandState = 'generating'; label = '生成中';
    }
    island.dataset.islandState = islandState;
    const labelEl = island.querySelector('[data-island-label]');
    if (labelEl) labelEl.textContent = label;
    island.setAttribute('aria-label', islandState === 'idle' ? '灵动岛' : `灵动岛：${label}，点击查看`);
    const motionMap = {
        idle: 'idle',
        generating: 'generating',
        synthesizing: 'playing',
        preparing_call: 'call',
        ringing: 'call',
        connected: 'call',
    };
    const root = island.closest('#tts-mobile-root');
    if (root) root.dataset.motionState = motionMap[islandState] || 'idle';
}

function syncPhoneHeader() {
    const meta = getPhoneHeaderMeta();
    const title = document.getElementById('tts-phone-header-title');
    const subtitle = document.getElementById('tts-phone-header-subtitle');
    const homeButton = document.getElementById('tts-mobile-logo');
    if (title) title.textContent = meta.title;
    if (subtitle) subtitle.textContent = meta.subtitle;
    if (homeButton) {
        homeButton.innerHTML = icon(state.route === 'home' ? 'orbit' : 'arrowLeft', 20);
        homeButton.setAttribute('aria-label', state.route === 'home' ? '语音主页' : '返回语音主页');
    }
}

function placeCharacterRouteEditor() {
    if (state.route !== 'library' || !state.routeCharacter) return;
    const editor = document.querySelector('[data-character-route-form]');
    const activeButton = [...document.querySelectorAll('[data-edit-route]')]
        .find(button => button.dataset.editRoute === state.routeCharacter);
    if (editor && activeButton) activeButton.insertAdjacentElement('afterend', editor);
}

function syncHomePageDom() {
    const viewport = document.querySelector('[data-home-pages]');
    if (!viewport) return;
    viewport.dataset.homePage = String(state.homePage);
    const track = viewport.querySelector('.voice-home-pages-track');
    if (track) {
        track.style.removeProperty('transition');
        track.style.removeProperty('transform');
    }
    viewport.querySelectorAll('[data-home-page-panel]').forEach(panel => {
        const active = Number(panel.dataset.homePagePanel) === state.homePage;
        panel.setAttribute('aria-hidden', String(!active));
        panel.toggleAttribute('inert', !active);
    });
    document.querySelectorAll('[data-set-home-page]').forEach(button => {
        const active = Number(button.dataset.setHomePage) === state.homePage;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-current', active ? 'page' : 'false');
    });
}

function setHomePage(page, { notify = true } = {}) {
    const next = Number(page) === 1 ? 1 : 0;
    const changed = state.homePage !== next;
    state.homePage = next;
    TTS_ProviderRegistry.updateUiSettings({ homePage: next });
    syncHomePageDom();
    if (changed && notify) announce(`已切换到桌面第 ${next + 1} 页`);
}

function bindHomePaging() {
    const viewport = document.querySelector('[data-home-pages]');
    const track = viewport?.querySelector('.voice-home-pages-track');
    if (!viewport || !track || viewport.dataset.pagingBound === 'true') return;
    viewport.dataset.pagingBound = 'true';
    let gesture = null;
    let frame = 0;
    let previewDelta = 0;

    const drawPreview = () => {
        frame = 0;
        track.style.transition = 'none';
        track.style.transform = `translate3d(calc(${-state.homePage * 100}% + ${previewDelta}px), 0, 0)`;
    };
    const queuePreview = delta => {
        previewDelta = delta;
        if (!frame) frame = window.requestAnimationFrame(drawPreview);
    };
    const finishGesture = event => {
        if (!gesture || (event.pointerId !== undefined && event.pointerId !== gesture.pointerId)) return;
        const completed = gesture;
        gesture = null;
        if (frame) window.cancelAnimationFrame?.(frame);
        frame = 0;
        track.classList.remove('is-dragging');
        track.style.removeProperty('transition');
        track.style.removeProperty('transform');
        if (completed.dragging) {
            const elapsed = Math.max(1, Date.now() - completed.startedAt);
            const velocity = completed.deltaX / elapsed;
            const threshold = Math.min(64, viewport.clientWidth * .17);
            const shouldTurn = Math.abs(completed.deltaX) >= threshold || Math.abs(velocity) > .48;
            const next = shouldTurn
                ? Math.max(0, Math.min(1, state.homePage + (completed.deltaX < 0 ? 1 : -1)))
                : state.homePage;
            state.suppressHomeClickUntil = Date.now() + 360;
            setHomePage(next);
        } else {
            syncHomePageDom();
        }
        try { viewport.releasePointerCapture?.(event.pointerId); } catch { }
    };

    viewport.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button > 0) return;
        gesture = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            deltaX: 0,
            dragging: false,
            startedAt: Date.now(),
        };
        // 不在 pointerdown 捕获指针：指针捕获会把后续 pointerup/click 重定向到
        // viewport 自身，导致委托点击处理器拿到的 event.target 不再是按钮，
        // 桌面上所有应用图标会“点了没反应”。捕获延迟到确认进入拖拽之后。
    });
    viewport.addEventListener('pointermove', event => {
        if (!gesture || event.pointerId !== gesture.pointerId) return;
        const deltaX = event.clientX - gesture.startX;
        const deltaY = event.clientY - gesture.startY;
        if (!gesture.dragging) {
            if (Math.abs(deltaX) < 8) return;
            if (Math.abs(deltaY) > Math.abs(deltaX)) {
                gesture = null;
                return;
            }
            gesture.dragging = true;
            try { viewport.setPointerCapture?.(event.pointerId); } catch { }
            track.classList.add('is-dragging');
        }
        gesture.deltaX = deltaX;
        const atBoundary = (state.homePage === 0 && deltaX > 0) || (state.homePage === 1 && deltaX < 0);
        queuePreview(atBoundary ? deltaX * .28 : deltaX);
        event.preventDefault();
    });
    viewport.addEventListener('pointerup', finishGesture);
    viewport.addEventListener('pointercancel', finishGesture);
    viewport.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        setHomePage(event.key === 'ArrowRight' ? 1 : 0);
    });
    syncHomePageDom();
}

function updateView() {
    const screen = document.getElementById('tts-mobile-screen');
    if (!screen) return;
    const root = document.getElementById('tts-mobile-root');
    const renderKey = currentRenderKey();
    const routeChanged = Boolean(state.renderKey && state.renderKey !== renderKey);
    const preserveScroll = state.renderKey === renderKey;
    const scrollState = preserveScroll ? captureScrollState(screen) : null;
    if (root) {
        root.dataset.voiceRoute = state.route;
        root.dataset.callStage = state.route === 'incoming'
            ? state.phoneStage
            : state.route === 'eavesdrop' && state.toolPlaybackKey.startsWith('track:')
                ? 'group-active'
                : '';
    }
    screen.innerHTML = renderRoute();
    state.renderKey = renderKey;
    syncPhoneMotion({ animateRoute: routeChanged });
    placeCharacterRouteEditor();
    updateClockDisplay();
    if (state.route === 'home') bindHomePaging();
    if (scrollState) window.requestAnimationFrame(() => restoreScrollState(screen, scrollState));
    if (state.route === 'chat' && state.chatScrollToBottom) {
        window.requestAnimationFrame(() => {
            const thread = document.querySelector('.voice-chat-thread');
            if (thread) thread.scrollTop = thread.scrollHeight;
            state.chatScrollToBottom = false;
        });
    }
    syncPhoneHeader();
    syncIslandState();
    const activeDock = state.route === 'incoming'
        ? 'incoming'
        : ['qq', 'chat', 'chat-settings'].includes(state.route)
            ? 'qq'
            : state.route === 'drawing'
                ? 'drawing'
                : ['settings', 'prompt-manager', 'prompt-lab'].includes(state.route)
                    ? 'settings'
                    : 'home';
    document.querySelectorAll('[data-dock-route]').forEach(button => {
        const active = button.dataset.dockRoute === activeDock;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    if (state.route === 'settings') refreshCacheStats();
    revealScrollableArea();
}

function announce(message) {
    const region = document.getElementById('tts-mobile-live-region');
    if (region) region.textContent = message;
    const toast = document.getElementById('tts-mobile-toast');
    if (!toast || !message) return;
    toast.querySelector('p').textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

async function refreshCacheStats() {
    try {
        state.cacheStats = await TTS_AudioCache.stats();
        const summary = document.getElementById('tts-cache-summary');
        if (summary) summary.textContent = `${state.cacheStats.count} 段 · ${formatBytes(state.cacheStats.bytes)}`;
    } catch {
        const summary = document.getElementById('tts-cache-summary');
        if (summary) summary.textContent = '缓存统计暂不可用';
    }
}

function readTriggerPosition() {
    const savedUiPosition = TTS_ProviderRegistry.getUiSettings().triggerPosition;
    if (savedUiPosition) return savedUiPosition;
    try {
        const saved = JSON.parse(localStorage.getItem('tts_voice_hub_trigger_position') || 'null');
        if (Number.isFinite(saved?.xRatio) && Number.isFinite(saved?.yRatio)) {
            TTS_ProviderRegistry.updateUiSettings({ triggerPosition: saved });
            return saved;
        }
    } catch {
        // Ignore invalid data left by an older build.
    }
    return null;
}

function applyTriggerPosition() {
    const trigger = document.getElementById('tts-mobile-trigger');
    const saved = state.triggerPosition || readTriggerPosition();
    if (!trigger) return;

    const maxX = Math.max(8, window.innerWidth - trigger.offsetWidth - 8);
    const maxY = Math.max(8, window.innerHeight - trigger.offsetHeight - 8);
    const ui = TTS_ProviderRegistry.getUiSettings();
    state.triggerDock = ui.triggerDock || state.triggerDock || 'right';
    const x = state.triggerDock === 'left' ? 8 : maxX;
    const yRatio = saved?.yRatio ?? .78;
    const y = Math.min(maxY, Math.max(8, yRatio * maxY));
    trigger.style.setProperty('left', `${x}px`, 'important');
    trigger.style.setProperty('top', `${y}px`, 'important');
    trigger.style.setProperty('right', 'auto', 'important');
    trigger.style.setProperty('bottom', 'auto', 'important');
    trigger.classList.toggle('is-docked-left', state.triggerDock === 'left');
    trigger.classList.toggle('is-docked-right', state.triggerDock === 'right');
}

function persistTriggerPosition(trigger) {
    const rect = trigger.getBoundingClientRect();
    const maxX = Math.max(1, window.innerWidth - rect.width - 8);
    const maxY = Math.max(1, window.innerHeight - rect.height - 8);
    state.triggerPosition = {
        xRatio: Math.min(1, Math.max(0, (rect.x - 8) / maxX)),
        yRatio: Math.min(1, Math.max(0, (rect.y - 8) / maxY)),
    };
    localStorage.setItem('tts_voice_hub_trigger_position', JSON.stringify(state.triggerPosition));
    TTS_ProviderRegistry.updateUiSettings({
        triggerPosition: state.triggerPosition,
        triggerDock: state.triggerDock,
    });
}

function revealTrigger(trigger = document.getElementById('tts-mobile-trigger')) {
    if (!trigger) return;
    window.clearTimeout(state.triggerShelfTimer);
    trigger.classList.remove('is-shelved');
}

function scheduleTriggerShelf(delay = 1700) {
    const trigger = document.getElementById('tts-mobile-trigger');
    if (!trigger || state.open) return;
    window.clearTimeout(state.triggerShelfTimer);
    state.triggerShelfTimer = window.setTimeout(() => {
        if (!state.open && !trigger.matches(':hover, :focus-visible') && !trigger.classList.contains('is-dragging')) {
            trigger.classList.add('is-shelved');
        }
    }, delay);
}

function snapTriggerToEdge(trigger) {
    const rect = trigger.getBoundingClientRect();
    state.triggerDock = rect.left + rect.width / 2 < window.innerWidth / 2 ? 'left' : 'right';
    const x = state.triggerDock === 'left'
        ? 8
        : Math.max(8, window.innerWidth - trigger.offsetWidth - 8);
    trigger.style.setProperty('left', `${x}px`, 'important');
    trigger.classList.toggle('is-docked-left', state.triggerDock === 'left');
    trigger.classList.toggle('is-docked-right', state.triggerDock === 'right');
}

function bindTriggerDrag(trigger) {
    let drag = null;

    const moveDrag = event => {
        if (!drag) return;
        if (event.pointerId !== undefined && drag.pointerId !== null && event.pointerId !== drag.pointerId) return;
        if (event.type === 'mousemove' && event.buttons !== 1) return;
        const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (distance < 5 && !drag.moved) return;
        drag.moved = true;
        trigger.classList.add('is-dragging');
        const maxX = Math.max(8, window.innerWidth - trigger.offsetWidth - 8);
        const maxY = Math.max(8, window.innerHeight - trigger.offsetHeight - 8);
        const x = Math.min(maxX, Math.max(8, event.clientX - drag.offsetX));
        const y = Math.min(maxY, Math.max(8, event.clientY - drag.offsetY));
        trigger.style.setProperty('left', `${x}px`, 'important');
        trigger.style.setProperty('top', `${y}px`, 'important');
        trigger.style.setProperty('right', 'auto', 'important');
        trigger.style.setProperty('bottom', 'auto', 'important');
        event.preventDefault();
    };

    const finishDrag = event => {
        if (!drag) return;
        if (event.pointerId !== undefined && drag.pointerId !== null && event.pointerId !== drag.pointerId) return;
        const completedDrag = drag;
        drag = null;
        window.removeEventListener('pointermove', moveDrag, true);
        window.removeEventListener('pointerup', finishDrag, true);
        window.removeEventListener('pointercancel', finishDrag, true);
        window.removeEventListener('mousemove', moveDrag, true);
        window.removeEventListener('mouseup', finishDrag, true);
        if (completedDrag.moved) {
            snapTriggerToEdge(trigger);
            persistTriggerPosition(trigger);
            state.suppressTriggerClick = true;
            window.setTimeout(() => { state.suppressTriggerClick = false; }, 0);
        }
        trigger.classList.remove('is-dragging');
        try {
            if (event.pointerId !== undefined) trigger.releasePointerCapture?.(event.pointerId);
        } catch { }
        scheduleTriggerShelf(900);
    };

    const beginDrag = (event, pointerId = null) => {
        if (drag) return;
        if (event.button !== undefined && event.button > 0 && event.buttons !== 1) return;
        const rect = trigger.getBoundingClientRect();
        revealTrigger(trigger);
        drag = {
            pointerId,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            moved: false,
        };
        window.addEventListener('pointermove', moveDrag, true);
        window.addEventListener('pointerup', finishDrag, true);
        window.addEventListener('pointercancel', finishDrag, true);
        window.addEventListener('mousemove', moveDrag, true);
        window.addEventListener('mouseup', finishDrag, true);
        try {
            if (pointerId !== null) trigger.setPointerCapture?.(pointerId);
        } catch { }
        event.preventDefault();
    };

    trigger.addEventListener('pointerdown', event => beginDrag(event, event.pointerId));
    trigger.addEventListener('mousedown', event => beginDrag(event, null));
    trigger.addEventListener('pointerenter', () => revealTrigger(trigger));
    trigger.addEventListener('pointerleave', () => scheduleTriggerShelf(900));
    trigger.addEventListener('focus', () => revealTrigger(trigger));
    trigger.addEventListener('blur', () => scheduleTriggerShelf(900));
}

function applyTheme(theme, persist = true) {
    state.theme = ['dark', 'light', 'system', 'custom'].includes(theme) ? theme : 'system';
    const root = document.getElementById('tts-mobile-root');
    const trigger = document.getElementById('tts-mobile-trigger');
    root?.setAttribute('data-voice-theme', state.theme);
    trigger?.setAttribute('data-voice-theme', state.theme);
    document.body?.setAttribute('data-tts-voice-theme', state.theme);
    const custom = TTS_ProviderRegistry.getUiSettings().customTheme || {};
    const variableMap = {
        bg: '--voice-bg',
        surface: '--voice-panel',
        accent: '--voice-copper',
        glow: '--voice-cyan',
    };
    Object.entries(variableMap).forEach(([key, variable]) => {
        if (state.theme === 'custom' && custom[key]) {
            root?.style.setProperty(variable, custom[key]);
            trigger?.style.setProperty(variable, custom[key]);
        } else {
            root?.style.removeProperty(variable);
            trigger?.style.removeProperty(variable);
        }
    });
    if (persist) {
        localStorage.setItem('tts_voice_hub_theme', state.theme);
        TTS_ProviderRegistry.updateUiSettings({ theme: state.theme });
    }
    const button = document.getElementById('tts-theme-toggle');
    if (button) {
        const labels = { system: '跟随酒馆主题', dark: '夜间主题', light: '日间主题', custom: '自定义主题' };
        const cycle = ['system', 'dark', 'light', 'custom'];
        const next = cycle[(cycle.indexOf(state.theme) + 1) % cycle.length];
        button.innerHTML = icon(state.theme === 'system' ? 'spark' : state.theme === 'dark' ? 'moon' : state.theme === 'light' ? 'sun' : 'edit', 19);
        button.setAttribute('aria-label', `当前${labels[state.theme]}，点击切换到${labels[next]}`);
    }
    syncPhoneMotion();
}

function revealScrollableArea() {
    const screen = document.getElementById('tts-mobile-screen');
    if (!screen) return;
    window.clearTimeout(state.scrollHintTimer);
    window.requestAnimationFrame(() => {
        const scrollable = screen.scrollHeight > screen.clientHeight + 2;
        screen.classList.toggle('is-scrollable', scrollable);
        if (!scrollable) return;
        screen.classList.add('is-scrollbar-visible');
        state.scrollHintTimer = window.setTimeout(() => screen.classList.remove('is-scrollbar-visible'), 1500);
    });
}

function bindScrollVisibility(screen) {
    screen.addEventListener('scroll', () => {
        screen.classList.add('is-scrollbar-visible');
        window.clearTimeout(state.scrollIdleTimer);
        state.scrollIdleTimer = window.setTimeout(() => screen.classList.remove('is-scrollbar-visible'), 650);
    }, { passive: true });
}

function buildShell() {
    if (!document.getElementById('tts-voice-console-style')) {
        const stylesheet = document.createElement('link');
        stylesheet.id = 'tts-voice-console-style';
        stylesheet.rel = 'stylesheet';
        stylesheet.href = CONSOLE_STYLE_URL;
        document.head.appendChild(stylesheet);
    }
    motionRuntime?.destroy();
    motionRuntime = null;
    document.getElementById('tts-mobile-root')?.remove();
    document.getElementById('tts-mobile-trigger')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
        <button id="tts-mobile-trigger" class="${state.open ? 'is-hidden' : ''} is-docked-${state.triggerDock}" data-voice-theme="${state.theme}" type="button" aria-label="打开多引擎 TTS 控制台，可拖动并自动贴边收纳" aria-controls="tts-mobile-root">
            <span class="voice-trigger-wave" aria-hidden="true">
                ${Array.from({ length: 5 }, (_, index) => `<b style="--wave-index:${index}"></b>`).join('')}
            </span>
            <i class="voice-trigger-pulse" aria-hidden="true"></i>
        </button>
        <aside id="tts-mobile-root" class="${state.open ? '' : 'minimized'}" data-voice-theme="${state.theme}" data-voice-route="${safe(state.route || 'home')}" role="dialog" aria-modal="false" aria-label="多引擎 TTS 控制台">
            <span class="voice-device-side-key is-mute" aria-hidden="true"></span>
            <span class="voice-device-side-key is-volume-up" aria-hidden="true"></span>
            <span class="voice-device-side-key is-volume-down" aria-hidden="true"></span>
            <div class="voice-device-screen">
                <div class="voice-shell-noise" aria-hidden="true"></div>
                <button type="button" class="voice-device-island" data-island-state="idle" aria-label="灵动岛"><em data-island-label></em><span class="voice-island-wave"><b></b><b></b><b></b><b></b></span><i></i></button>
                <div class="voice-system-bar">
                    <time id="tts-mobile-clock"></time>
                    <span class="voice-system-signals">
                        <small id="tts-network-label">网络</small>
                        <b id="tts-network-icon" aria-hidden="true">${icon('wifi', 14)}</b>
                        <span class="voice-system-battery" id="tts-system-battery" aria-label="电量信息不可用">
                            <em id="tts-battery-level">--</em>
                            <i aria-hidden="true"><b></b></i>
                        </span>
                    </span>
                </div>
                <header class="voice-phone-header">
                    <button id="tts-mobile-logo" type="button" data-route="home" aria-label="语音主页">${icon('orbit', 20)}</button>
                    <div><strong id="tts-phone-header-title">语音</strong><small id="tts-phone-header-subtitle">角色声线</small></div>
                    <button id="tts-theme-toggle" type="button" data-theme-toggle aria-label="切换插件主题">${icon(state.theme === 'system' ? 'spark' : state.theme === 'dark' ? 'moon' : 'sun', 19)}</button>
                    <button id="tts-mobile-close" type="button" aria-label="关闭语音控制台">${icon('close', 20)}</button>
                </header>
                <main id="tts-mobile-screen" class="voice-screen"></main>
                <div id="tts-mobile-toast" class="voice-toast" role="status" aria-live="polite">
                    ${icon('info', 17)}<p></p>
                </div>
                <nav class="voice-dock" aria-label="常用应用">
                    <button id="tts-dock-home" type="button" data-dock-route="home">${icon('home', 19)}<span>主页</span></button>
                    <button id="tts-dock-qq" type="button" data-dock-route="qq">${icon('messageCircle', 19)}<span>QQ</span></button>
                    <button id="tts-dock-incoming" type="button" data-dock-route="incoming">${icon('phone', 19)}<span>电话</span></button>
                    <button id="tts-dock-drawing" type="button" data-dock-route="drawing">${icon('edit', 19)}<span>绘画</span></button>
                    <button id="tts-dock-settings" type="button" data-dock-route="settings">${icon('sliders', 19)}<span>设置</span></button>
                </nav>
                <div class="voice-device-home-indicator" aria-hidden="true"></div>
                <div id="tts-mobile-live-region" class="sr-only" aria-live="polite"></div>
            </div>
        </aside>`);
    const shell = document.getElementById('tts-mobile-root');
    const trigger = document.getElementById('tts-mobile-trigger');
    motionRuntime = createPhoneMotionRuntime({
        root: shell,
        screen: document.getElementById('tts-mobile-screen'),
    });
    trigger.addEventListener('click', event => {
        event.preventDefault();
        if (state.suppressTriggerClick) return;
        TTS_Mobile.toggle();
    });
    bindTriggerDrag(trigger);
    bindScrollVisibility(document.getElementById('tts-mobile-screen'));
    if (state.eventRoot !== shell) {
        bindEvents(shell);
        state.eventRoot = shell;
    }
    applyTriggerPosition();
    applyTheme(state.theme, false);
    updateView();
    scheduleTriggerShelf();
}

function collectForm(providerId) {
    const provider = getSnapshot().providers.find(item => item.id === providerId);
    const form = document.querySelector(`[data-provider-form="${providerId}"]`);
    const values = {};
    provider.fields.filter(field => field.type !== 'secret').forEach(field => {
        const input = form?.elements.namedItem(field.key);
        if (!input) return;
        if (field.type === 'switch') values[field.key] = input.checked;
        else if (field.type === 'range') values[field.key] = Number(input.value);
        else values[field.key] = input.value.trim();
    });
    return values;
}

function commitProviderForm(providerId) {
    const form = document.querySelector(`[data-provider-form="${providerId}"]`);
    if (!form) return TTS_ProviderRegistry.getSettings(providerId);
    const settings = TTS_ProviderRegistry.updateSettings(providerId, collectForm(providerId));
    if (providerId === 'gpt_sovits') {
        window.TTS_API?.init(settings.managerEndpoint);
        if (window.TTS_State?.CACHE) window.TTS_State.CACHE.API_URL = settings.managerEndpoint;
    }
    return settings;
}

async function syncGptServiceSettings(settings) {
    if (!window.TTS_API?.updateSettings) return;
    const languageDirectory = {
        zh: 'Chinese',
        ja: 'Japanese',
        en: 'English',
    };
    await window.TTS_API.updateSettings({
        sovits_host: settings.engineEndpoint,
        default_lang: languageDirectory[settings.promptLang] || 'Chinese',
    });
}

async function checkProvider(providerId) {
    announce('正在检测引擎连接');
    try {
        const settings = commitProviderForm(providerId);
        if (providerId === 'gpt_sovits') await syncGptServiceSettings(settings);
        const runtime = await TTS_ProviderRegistry.checkProvider(providerId);
        if (['ready', 'reachable'].includes(runtime.status)) announce(runtime.message || '引擎连接正常');
        else announce(runtime.message || '引擎当前未启动');
    } catch (error) {
        announce(error.message || '连接检测失败');
    }
}

async function previewProvider(providerId) {
    if (state.previewController) {
        state.previewController.abort();
        return;
    }
    const text = document.getElementById(`tts-preview-text-${providerId}`)?.value.trim();
    const settings = commitProviderForm(providerId);
    const button = document.querySelector(`[data-preview-provider="${providerId}"]`);
    if (!text) return;
    const controller = new AbortController();
    state.previewController = controller;
    state.previewProviderId = providerId;
    document.querySelector('.voice-inline-error')?.remove();
    button.innerHTML = `${icon('close', 18)} 取消生成`;
    button.classList.add('is-cancelling');
    try {
        if (providerId === 'gpt_sovits') await syncGptServiceSettings(settings);
        const blob = await TTS_ProviderRegistry.synthesize(providerId, {
            text,
            signal: controller.signal,
        });
        if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
        state.previewUrl = URL.createObjectURL(blob);
        state.previewResultProviderId = providerId;
        const slot = document.getElementById(`tts-preview-audio-slot-${providerId}`);
        slot.innerHTML = `<audio id="tts-preview-audio-${providerId}" controls autoplay src="${state.previewUrl}"></audio>`;
        announce('试听音频已经生成');
    } catch (error) {
        if (error?.name === 'AbortError') {
            announce('已取消试听生成');
            return;
        }
        announce(error.message || '试听生成失败');
        document.querySelector(`[data-preview-provider="${providerId}"]`)
            ?.insertAdjacentHTML('afterend', `<p class="voice-inline-error">${safe(error.message || '试听生成失败')}</p>`);
    } finally {
        state.previewController = null;
        state.previewProviderId = null;
        const currentButton = document.querySelector(`[data-preview-provider="${providerId}"]`);
        if (currentButton) {
            currentButton.classList.remove('is-cancelling');
            currentButton.innerHTML = `${icon('play', 18)} 生成并试听`;
        }
    }
}

function filterMiniMaxVoices() {
    const search = document.getElementById('tts-minimax-voice-search');
    const results = document.getElementById('tts-minimax-voice-results');
    if (!search || !results) return;
    const query = search.value.trim().toLocaleLowerCase('zh-CN');
    const activeFilter = document.querySelector('[data-minimax-voice-filter].is-active')
        ?.dataset.minimaxVoiceFilter || 'all';
    let visibleCount = 0;
    results.querySelectorAll('[data-minimax-voice-item]').forEach(card => {
        const matchesCategory = activeFilter === 'all'
            || card.dataset.minimaxVoiceCategory === activeFilter;
        const matchesQuery = !query || card.dataset.minimaxVoiceSearch.includes(query);
        card.hidden = !(matchesCategory && matchesQuery);
        if (!card.hidden) visibleCount += 1;
    });
    const count = document.getElementById('tts-minimax-voice-visible-count');
    if (count) count.textContent = String(visibleCount);
    const empty = document.getElementById('tts-minimax-voice-empty');
    if (empty) empty.hidden = visibleCount !== 0;
}

function filterElevenLabsVoices() {
    const search = document.getElementById('tts-elevenlabs-voice-search');
    const results = document.getElementById('tts-elevenlabs-voice-results');
    if (!search || !results) return;
    const query = search.value.trim().toLocaleLowerCase('zh-CN');
    let visibleCount = 0;
    results.querySelectorAll('[data-elevenlabs-voice-item]').forEach(card => {
        card.hidden = Boolean(query && !card.dataset.elevenlabsVoiceSearch.includes(query));
        if (!card.hidden) visibleCount += 1;
    });
    const count = document.getElementById('tts-elevenlabs-voice-visible-count');
    if (count) count.textContent = String(visibleCount);
    const empty = document.getElementById('tts-elevenlabs-voice-empty');
    if (empty) empty.hidden = visibleCount !== 0;
}

function selectMiniMaxResource(button) {
    const kind = button.dataset.minimaxResource;
    const resourceId = button.dataset.minimaxResourceId;
    const input = document.getElementById(`tts-field-minimax-${kind}`);
    if (!input || !resourceId) return;
    input.value = resourceId;
    document.querySelectorAll(`[data-minimax-resource="${kind}"]`).forEach(card => {
        card.classList.toggle('is-selected', card === button);
    });
    announce(kind === 'model' ? `已选择模型 ${resourceId}` : '音色已写入当前配置，保存后即可使用');
}

function selectElevenLabsResource(button) {
    const kind = button.dataset.elevenlabsResource;
    const resourceId = button.dataset.elevenlabsResourceId;
    const input = document.getElementById(`tts-field-elevenlabs-${kind}`);
    if (!input || !resourceId) return;
    input.value = resourceId;
    document.querySelectorAll(`[data-elevenlabs-resource="${kind}"]`).forEach(card => {
        card.classList.toggle('is-selected', card === button);
    });
    announce(kind === 'model' ? `已选择 ElevenLabs 模型 ${resourceId}` : 'ElevenLabs 音色已写入当前配置，保存后即可使用');
}

async function syncMiniMaxResources() {
    const button = document.getElementById('tts-minimax-sync-resources');
    if (button) {
        button.disabled = true;
        button.classList.add('is-syncing');
        button.innerHTML = `${icon('refresh', 16)}<span>正在同步</span>`;
    }
    try {
        commitProviderForm('minimax');
        const catalog = await TTS_ProviderRegistry.syncMiniMaxCatalog();
        announce(`已同步 ${catalog.models.length} 个模型与 ${catalog.voices.length} 个音色`);
    } catch (error) {
        announce(error.message || 'MiniMax 资源同步失败');
    } finally {
        const currentButton = document.getElementById('tts-minimax-sync-resources');
        if (currentButton) {
            currentButton.disabled = false;
            currentButton.classList.remove('is-syncing');
            currentButton.innerHTML = `${icon('refresh', 16)}<span>同步官方资源</span>`;
        }
    }
}

async function syncElevenLabsResources() {
    const button = document.getElementById('tts-elevenlabs-sync-resources');
    if (button) {
        button.disabled = true;
        button.classList.add('is-syncing');
        button.innerHTML = `${icon('refresh', 16)}<span>正在同步</span>`;
    }
    try {
        commitProviderForm('elevenlabs');
        const catalog = await TTS_ProviderRegistry.syncElevenLabsCatalog();
        announce(`已同步 ${catalog.voices.length} 个 ElevenLabs 账号音色`);
    } catch (error) {
        announce(error.message || 'ElevenLabs 音色同步失败');
    } finally {
        const currentButton = document.getElementById('tts-elevenlabs-sync-resources');
        if (currentButton) {
            currentButton.disabled = false;
            currentButton.classList.remove('is-syncing');
            currentButton.innerHTML = `${icon('refresh', 16)}<span>同步账户音色</span>`;
        }
    }
}

function toggleVoiceFavorite(button) {
    const providerId = button.dataset.providerId;
    const voiceId = button.dataset.voiceId;
    const voiceName = button.dataset.voiceName || voiceId;
    const wasFavorite = FrontendVoiceTools.isVoiceFavorite(providerId, voiceId);
    if (wasFavorite && !window.confirm(`确定取消收藏“${voiceName}”吗？\n取消后，它不会再出现在收藏列表中。`)) return;
    const active = FrontendVoiceTools.toggleVoiceFavorite({
        providerId,
        voiceId,
        name: voiceName,
        category: button.dataset.voiceCategory,
        description: button.dataset.voiceDescription,
        model: button.dataset.voiceModel,
    });
    announce(active ? '声线已收藏' : '已取消声线收藏');
}

function removeVoiceFavorite(button) {
    const providerId = button.dataset.providerId;
    const voiceId = button.dataset.voiceId;
    const voiceName = button.dataset.voiceName || voiceId;
    const isClonedVoice = button.dataset.voiceCategory === 'cloning';
    const warning = isClonedVoice
        ? '这是手动录入的复刻音色。移除后若要恢复，需要重新填写 Voice ID。'
        : '移除后，它不会再出现在收藏列表中。';
    if (!window.confirm(`确定移除收藏“${voiceName}”吗？\n${warning}`)) return;
    state.favoriteManageKey = '';
    const removed = FrontendVoiceTools.removeVoiceFavorite(providerId, voiceId);
    announce(removed ? '已移除声线收藏' : '这个收藏已经不存在');
}

function applyVoiceFavoriteToCharacter({ providerId, voiceId, model, characterName }) {
    const name = String(characterName || '').trim();
    if (!name) throw new Error('请先从下拉框选择一个已有角色。');
    const providerSettings = TTS_ProviderRegistry.getSettings(providerId);
    const updates = { voice: voiceId };
    if (model && Object.prototype.hasOwnProperty.call(providerSettings, 'model')) updates.model = model;
    TTS_ProviderRegistry.updateSettings(providerId, updates);
    const currentRoute = TTS_ProviderRegistry.resolveRoute(name);
    TTS_ProviderRegistry.setCharacterRoute(name, {
        ...currentRoute,
        providerId,
        voice: voiceId,
        model: model || currentRoute.model || providerSettings.model || '',
    });
    return name;
}

function filterFavoriteVoices() {
    const input = document.getElementById('tts-favorite-search');
    const list = document.getElementById('tts-favorite-list');
    if (!input || !list) return;
    const query = input.value.trim().toLocaleLowerCase('zh-CN');
    let visible = 0;
    list.querySelectorAll('[data-favorite-voice-item]').forEach(item => {
        item.hidden = Boolean(query && !item.dataset.favoriteVoiceSearch.includes(query));
        if (!item.hidden) visible += 1;
    });
    const count = document.getElementById('tts-favorite-count');
    if (count) count.textContent = String(visible);
    const empty = document.getElementById('tts-favorite-empty');
    if (empty) empty.hidden = visible !== 0;
}

function filterVoiceContacts() {
    const input = document.getElementById('tts-contact-search');
    const list = document.querySelector('.voice-contact-list');
    if (!input || !list) return;
    const query = input.value.trim().toLocaleLowerCase('zh-CN');
    let visible = 0;
    list.querySelectorAll('[data-contact-item]').forEach(item => {
        item.hidden = Boolean(query && !item.dataset.contactSearch.includes(query));
        if (!item.hidden) visible += 1;
    });
    const count = document.getElementById('tts-contact-count');
    if (count) count.textContent = String(visible);
    const empty = document.getElementById('tts-contact-empty');
    if (empty) empty.hidden = visible !== 0;
}

async function loadDrawingGallery() {
    try {
        const records = await TTS_ImageCache.list();
        state.drawingRecentImages.forEach(item => URL.revokeObjectURL(item.url));
        state.drawingRecentImages = records
            .filter(record => record.blob)
            .slice(0, 24)
            .map(record => ({
                key: record.key,
                description: record.description,
                createdAt: record.createdAt,
                url: URL.createObjectURL(record.blob),
            }));
    } catch (error) {
        console.warn('[TTS Drawing] 加载最近图片失败', error);
        state.drawingRecentImages = [];
    }
    if (state.route === 'drawing') updateView();
}

async function deleteDrawingImage(key) {
    try {
        await TTS_ImageCache.remove(key);
    } catch (error) {
        console.warn('[TTS Drawing] 删除图片失败', error);
    }
    state.drawingRecentImages = state.drawingRecentImages.filter(item => item.key !== key);
    if (state.drawingLastImage?.startsWith('blob:')) URL.revokeObjectURL(state.drawingLastImage);
    if (state.route === 'drawing') updateView();
}

async function clearDrawingGallery() {
    const entries = state.drawingRecentImages;
    if (!entries.length) return;
    if (!window.confirm(`确认清空 ${entries.length} 张图片？此操作不可恢复。`)) return;
    try {
        await Promise.all(entries.map(item => TTS_ImageCache.remove(item.key)));
    } catch (error) {
        console.warn('[TTS Drawing] 清空失败', error);
    }
    state.drawingRecentImages = [];
    state.drawingLastImage = null;
    if (state.route === 'drawing') updateView();
}

function getToolRecord(kind, recordId) {
    const tools = FrontendVoiceTools.getSnapshot();
    if (kind === 'phone') return tools.calls.find(item => item.id === recordId);
    const tracks = Array.isArray(tools.tracks) ? tools.tracks : [];
    return tracks.find(item => item.id === recordId) || null;
}

function clearToolRecordAudio(kind, recordId) {
    const cacheKey = `${kind}:${recordId}`;
    if (state.toolPlaybackKey === cacheKey) stopToolPlayback();
    const queue = state.toolAudioCache.get(cacheKey) || [];
    queue.forEach(item => {
        if (item.url?.startsWith('blob:')) URL.revokeObjectURL(item.url);
    });
    state.toolAudioCache.delete(cacheKey);
}

function inferPhoneLength(record) {
    if (['short', 'medium', 'long'].includes(record?.duration)) return record.duration;
    const segmentCount = Array.isArray(record?.segments) ? record.segments.length : 0;
    if (segmentCount >= 12) return 'long';
    if (segmentCount >= 7) return 'medium';
    return 'short';
}

async function regenerateToolRecord(kind, recordId) {
    if (state.featureBusy) return;
    const record = getToolRecord(kind, recordId);
    if (!record) return announce('找不到这条记录');
    clearToolRecordAudio(kind, recordId);

    if (kind === 'phone') {
        state.phoneBrief = String(record.brief || record.reason || '').trim();
        state.phoneLength = inferPhoneLength(record);
        state.phoneCaller = String(record.participants?.[0] || record.requestedCaller || record.charName || 'auto').trim() || 'auto';
        const participants = Array.isArray(record.participants) && record.participants.length
            ? record.participants
            : (record.charName ? [record.charName] : []);
        state.phoneParticipants = [...participants];
        state.featureBusy = 'phone-regenerate';
        updateView();
        const isGroup = record.kind === 'group' || participants.length > 1;
        announce(isGroup ? '正在重新生成多人通话' : `正在重新生成 ${record.charName || '角色'} 的通话`);
        try {
            await FrontendVoiceTools.regeneratePhoneCall(recordId);
            announce(isGroup ? '多人通话已重新生成' : `${record.charName || '角色'} 的通话已重新生成`);
        } catch (error) {
            announce(error.message || '通话重新生成失败');
        } finally {
            state.featureBusy = null;
            updateView();
        }
        return;
    }
    announce('仅电话通话支持重新生成');
}

async function deleteCharacterWithBindings(characterName) {
    if (window.TTS_State?.CACHE?.mappings?.[characterName]) {
        try {
            await window.TTS_API?.unbindCharacter(characterName);
        } catch (error) {
            console.warn('[TTS] 管理后端未完成角色解绑，本地角色仍会删除。', error);
        }
        delete window.TTS_State.CACHE.mappings[characterName];
    }
    TTS_ProviderRegistry.deleteCharacter(characterName);
    if (state.routeCharacter === characterName) state.routeCharacter = null;
}

async function synthesizeToolSegment(segment, fallbackCharacterName, signal) {
    const characterName = String(segment?.speaker || fallbackCharacterName || '').trim();
    const text = String(segment?.text || '').trim();
    if (!characterName || !text) throw new Error('语音片段缺少说话人或台词。');
    const route = TTS_ProviderRegistry.resolveRoute(characterName);
    const settings = TTS_ProviderRegistry.getSettings(route.providerId);
    if (route.providerId === 'minimax') {
        const waitMs = Math.max(0, miniMaxToolNextRequestAt - Date.now());
        if (waitMs) await waitForToolPacing(waitMs, signal);
        miniMaxToolNextRequestAt = Date.now() + MINIMAX_TOOL_REQUEST_INTERVAL_MS;
    }
    return TTS_ProviderRegistry.synthesize(route.providerId, {
        text,
        emotion: String(segment?.emotion || ''),
        characterName,
        voice: route.voice || settings.voice,
        model: route.model || settings.model,
        referenceAudio: route.referenceAudio || settings.referenceAudio || settings.speakerAudio,
        promptText: route.promptText || settings.promptText,
        signal,
    });
}

function stopPhoneChatAudio() {
    if (state.chatAudioElement) {
        state.chatAudioElement.pause();
        state.chatAudioElement.removeAttribute('src');
        state.chatAudioElement.load?.();
        state.chatAudioElement = null;
    }
    state.chatAudioKey = '';
}

async function playPhoneChatVoice(messageId) {
    state.chatVoiceExpanded.add(messageId);
    if (state.chatAudioKey === messageId) {
        stopPhoneChatAudio();
        updateView();
        return;
    }
    const chat = FrontendVoiceTools.getPhoneChatSnapshot();
    const message = chat.thread.messages.find(item => item.id === messageId);
    if (!message || message.type === 'recalled' || message.sender !== 'character') {
        announce('这条消息没有可播放的角色语音');
        return;
    }
    stopPhoneChatAudio();
    stopToolPlayback();
    const controller = new AbortController();
    state.featureAudioController?.abort();
    state.featureAudioController = controller;
    state.featureBusy = 'chat-voice';
    updateView();
    try {
        const record = {
            id: `${chat.thread.id}-${message.id}`,
            charName: chat.thread.charName,
            segments: [{
                speaker: chat.thread.charName,
                emotion: message.emotion || '自然',
                text: message.content,
                translation: message.translation,
            }],
        };
        const queue = await prepareToolAudio('chat', record, controller.signal);
        if (controller.signal.aborted || !queue[0]) return;
        const audio = new Audio(queue[0].url);
        state.chatAudioElement = audio;
        state.chatAudioKey = message.id;
        audio.addEventListener('ended', () => {
            state.chatAudioElement = null;
            state.chatAudioKey = '';
            updateView();
        });
        audio.addEventListener('error', () => {
            stopPhoneChatAudio();
            updateView();
            announce('语音消息播放失败，请检查角色声线路由');
        });
        state.featureBusy = null;
        state.featureAudioController = null;
        updateView();
        await audio.play();
    } catch (error) {
        if (error?.name !== 'AbortError') announce(error.message || '语音消息生成失败');
    } finally {
        if (state.featureAudioController === controller) state.featureAudioController = null;
        if (state.featureBusy === 'chat-voice') state.featureBusy = null;
    }
}

async function startPhoneChatCall() {
    if (state.featureBusy) return;
    const chat = FrontendVoiceTools.getPhoneChatSnapshot();
    if (!chat.context.available) {
        announce('请先打开一个角色对话');
        return;
    }
    const recent = chat.thread.messages
        .filter(message => message.type !== 'recalled')
        .slice(-8)
        .map(message => `${message.sender === 'user' ? chat.thread.userName : chat.thread.charName}：${message.translation || message.content}`)
        .join('\n');
    state.featureBusy = 'chat-call';
    updateView();
    announce(`正在生成与 ${chat.context.charName} 的语音通话`);
    try {
        const plan = await FrontendVoiceTools.generatePhonePlan({
            caller: chat.context.charName,
            duration: 'medium',
            brief: `这是 ${chat.context.userName} 从手机聊天 App 主动拨给 ${chat.context.charName} 的语音通话。自然承接最近的手机私聊，不要复述记录。\n${recent || '两人刚刚打开聊天。'}`,
        });
        state.phonePlan = plan;
        state.phoneDirection = 'outgoing';
        state.phoneStage = 'ringing';
        state.phoneError = '';
        state.route = 'incoming';
        announce(`正在呼叫 ${chat.context.charName}`);
    } catch (error) {
        announce(error.message || '语音通话规划失败');
    } finally {
        state.featureBusy = null;
        updateView();
    }
}

function waitForToolPacing(ms, signal) {
    if (signal?.aborted) {
        const error = new Error('已取消生成');
        error.name = 'AbortError';
        return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            signal?.removeEventListener?.('abort', onAbort);
            const error = new Error('已取消生成');
            error.name = 'AbortError';
            reject(error);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener?.('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener?.('abort', onAbort, { once: true });
    });
}

function getRecordSegments(kind, record) {
    if (Array.isArray(record?.segments) && record.segments.length) return record.segments;
    if (kind === 'track' && record?.suggestedReply?.text) return [record.suggestedReply];
    return [];
}

async function prepareToolAudio(_kind, record, signal, { fromIndex = 0, limit } = {}) {
    // 通话记录的音频逐段准备流程：复用单人与多人的 segments。
    const segments = getRecordSegments('phone', record);
    if (!segments.length) throw new Error('这条通话没有可播放的台词。');
    const start = Math.min(Math.max(0, Math.round(Number(fromIndex) || 0)), segments.length);
    const end = Number.isFinite(limit)
        ? Math.min(segments.length, start + Math.max(0, Math.round(limit)))
        : segments.length;
    const prepared = [];
    for (let index = start; index < end; index += 1) {
        signal?.throwIfAborted?.();
        const segment = segments[index];
        const blob = await synthesizeToolSegment(segment, record.charName, signal);
        prepared.push({
            index,
            speaker: String(segment.speaker || record.charName || '').trim(),
            emotion: String(segment.emotion || '自然').trim(),
            text: String(segment.text || '').trim(),
            url: URL.createObjectURL(blob),
        });
    }
    return prepared;
}

function syncPhoneCallVisuals() {
    const audio = state.phoneAudioElement;
    const plan = state.phonePlan;
    if (!audio || !plan?.segments?.length) return;
    state.phoneElapsed = state.phoneCompletedDuration + (audio.currentTime || 0);
    const activeIndex = state.phoneSegmentIndex;
    const segment = plan.segments[activeIndex];
    const durationNode = document.getElementById('tts-call-duration');
    const subtitleNode = document.getElementById('tts-call-subtitle');
    const emotionNode = document.getElementById('tts-call-emotion');
    const translationNode = document.getElementById('tts-call-translation');
    if (durationNode) durationNode.textContent = formatCallDuration(state.phoneElapsed);
    if (subtitleNode) subtitleNode.textContent = segment?.text || '';
    if (emotionNode) emotionNode.textContent = `${segment?.speaker || plan.charName} · ${segment?.emotion || '自然'}`;
    if (translationNode) {
        const translation = String(segment?.translation || '').trim();
        translationNode.textContent = translation;
        translationNode.hidden = !translation || translation === segment?.text;
    }
    document.querySelectorAll('.voice-call-segments i').forEach((node, index) => {
        node.classList.toggle('is-active', index === activeIndex);
        node.classList.toggle('is-done', index < activeIndex);
    });
}

function stopPhoneAudio() {
    state.featureAudioController?.abort();
    state.featureAudioController = null;
    if (state.phoneAudioElement) {
        state.phoneAudioElement.pause();
        state.phoneAudioElement.removeAttribute('src');
        state.phoneAudioElement.load?.();
        state.phoneAudioElement = null;
    }
    state.phoneNeedsResume = false;
}

function finishPhoneCall(errorMessage = '') {
    state.featureAudioController?.abort();
    stopPhoneAudio();
    window.clearTimeout(state.phoneRingTimer);
    state.phoneRingTimer = null;
    state.featureBusy = null;
    state.phoneError = String(errorMessage || '');
    state.phoneStage = 'ended';
    updateView();
}

function resetPhoneCall() {
    stopPhoneAudio();
    window.clearTimeout(state.phoneRingTimer);
    state.phoneRingTimer = null;
    state.featureBusy = null;
    state.phoneStage = 'setup';
    state.phoneElapsed = 0;
    state.phoneDuration = 0;
    state.phoneSegmentIndex = 0;
    state.phoneAudioQueue = [];
    state.phoneCompletedDuration = 0;
    state.phoneError = '';
    state.phoneDirection = 'outgoing';
    updateView();
}

function startPhoneRinging(recordId) {
    const plan = getToolRecord('phone', recordId) || state.phonePlan;
    if (!plan) {
        announce('找不到这通电话');
        return;
    }
    state.route = 'incoming';
    state.providerId = null;
    stopPhoneAudio();
    state.phonePlan = plan;
    state.phoneDirection = 'outgoing';
    state.phoneStage = 'connecting';
    state.phoneError = '';
    state.phoneElapsed = 0;
    state.phoneSegmentIndex = 0;
    state.phoneAudioQueue = [];
    state.phoneCompletedDuration = 0;
    answerPhoneCall();
}

async function playPhoneSegment(index = 0) {
    const item = state.phoneAudioQueue[index];
    if (!item) {
        finishPhoneCall();
        return;
    }
    state.phoneSegmentIndex = index;
    const audio = new Audio(item.url);
    state.phoneAudioElement = audio;
    audio.addEventListener('loadedmetadata', syncPhoneCallVisuals);
    audio.addEventListener('timeupdate', syncPhoneCallVisuals);
    audio.addEventListener('ended', () => {
        state.phoneCompletedDuration += Number.isFinite(audio.duration) ? audio.duration : audio.currentTime || 0;
        state.phoneAudioElement = null;
        playPhoneSegment(index + 1);
    });
    audio.addEventListener('error', () => finishPhoneCall('音频播放失败，请检查当前角色声线路由。'));
    state.phoneStage = 'active';
    state.phoneNeedsResume = false;
    updateView();
    try {
        await audio.play();
    } catch (error) {
        if (error?.name !== 'NotAllowedError') throw error;
        state.phoneNeedsResume = true;
        updateView();
    }
}

async function answerPhoneCall() {
    const plan = state.phonePlan;
    if (!plan || state.featureBusy) return;
    window.clearTimeout(state.phoneRingTimer);
    state.phoneRingTimer = null;
    stopPhoneAudio();
    state.phoneStage = 'connecting';
    state.phoneError = '';
    state.featureBusy = 'phone-audio';
    const controller = new AbortController();
    state.featureAudioController = controller;
    stopToolPlayback();
    updateView();
    try {
        // 主动来电已在响铃前准备好头两段，接听时直接从剩余段继续。
        const preparedHead = Array.isArray(state.phoneAudioQueue) && state.phoneAudioQueue.length
            ? state.phoneAudioQueue
            : [];
        const remaining = await prepareToolAudio('phone', plan, controller.signal, { fromIndex: preparedHead.length });
        if (controller.signal.aborted) return;
        const queue = [...preparedHead, ...remaining];
        state.phoneAudioQueue = queue;
        state.phoneCompletedDuration = 0;
        state.featureBusy = null;
        state.featureAudioController = null;
        await playPhoneSegment(0);
    } catch (error) {
        if (error?.name === 'AbortError') return;
        finishPhoneCall(error?.message || '角色声线生成失败');
    } finally {
        if (state.featureAudioController === controller) state.featureAudioController = null;
    }
}

async function resumePhoneCall() {
    if (!state.phoneAudioElement) return;
    try {
        await state.phoneAudioElement.play();
        state.phoneNeedsResume = false;
        updateView();
    } catch (error) {
        finishPhoneCall(error?.message || '浏览器阻止了音频播放');
    }
}

function stopToolPlayback() {
    if (state.toolAudioElement) {
        state.toolAudioElement.pause();
        state.toolAudioElement.removeAttribute('src');
        state.toolAudioElement.load?.();
        state.toolAudioElement = null;
    }
    state.toolAudioQueue = [];
    state.toolPlaybackKey = '';
    state.toolPlaybackIndex = 0;
}

function syncTrackPlaybackView() {
    if (!state.toolPlaybackKey.startsWith('track:')) return false;
    const recordId = state.toolPlaybackKey.slice('track:'.length);
    const track = getToolRecord('track', recordId);
    const stage = document.querySelector('[data-track-call-stage]');
    if (!track || !stage || stage.dataset.trackCallStage !== recordId) return false;
    const segments = Array.isArray(track.segments) ? track.segments : [];
    const activeIndex = Math.min(state.toolPlaybackIndex, Math.max(0, segments.length - 1));
    const segment = segments[activeIndex] || {};
    const speaker = document.getElementById('tts-track-call-speaker');
    const subtitle = document.getElementById('tts-track-call-subtitle');
    const translation = document.getElementById('tts-track-call-translation');
    const count = document.getElementById('tts-track-call-count');
    const progress = document.getElementById('tts-track-call-progress');
    if (speaker) speaker.textContent = `${segment.speaker || ''} · ${segment.emotion || '自然'}`;
    if (subtitle) subtitle.textContent = segment.text || '';
    if (translation) {
        translation.textContent = segment.translation || '';
        translation.hidden = !segment.translation || segment.translation === segment.text;
    }
    if (count) count.textContent = `${activeIndex + 1} / ${segments.length}`;
    if (progress) progress.style.transform = `scaleX(${segments.length ? (activeIndex + 1) / segments.length : 0})`;
    stage.querySelectorAll('[data-track-speaker]').forEach(node => {
        node.classList.toggle('is-speaking', node.dataset.trackSpeaker === segment.speaker);
    });
    stage.querySelectorAll('[data-track-segment]').forEach(node => {
        const active = Number(node.dataset.trackSegment) === activeIndex;
        node.classList.toggle('is-speaking', active);
        node.setAttribute('aria-current', active ? 'true' : 'false');
    });
    return true;
}

async function playNextToolSegment(index = 0) {
    const item = state.toolAudioQueue[index];
    if (!item) {
        stopToolPlayback();
        updateView();
        return;
    }
    state.toolPlaybackIndex = index;
    const audio = new Audio(item.url);
    state.toolAudioElement = audio;
    audio.addEventListener('ended', () => {
        state.toolAudioElement = null;
        playNextToolSegment(index + 1);
    });
    audio.addEventListener('error', () => {
        stopToolPlayback();
        updateView();
        announce('私聊音频播放失败');
    });
    if (!syncTrackPlaybackView()) updateView();
    await audio.play();
}

async function playToolAudio(kind, recordId) {
    // 兼容旧入口：所有回放都交给“电话”APP 的接听/外呼流程处理。
    if (kind !== 'phone') {
        announce('请到“电话”APP 重听这通通话');
        return;
    }
    startPhoneRinging(recordId);
}

function collectPlannerForm(form) {
    const planner = FrontendVoiceTools.getPlannerSettings();
    const values = {
        mode: form.elements.mode?.value ?? planner.mode,
        apiUrl: form.elements.apiUrl?.value ?? planner.apiUrl,
        apiKey: form.elements.apiKey?.value ?? planner.apiKey,
        model: form.elements.model?.value ?? planner.model,
        temperature: form.elements.temperature?.value ?? planner.temperature,
        maxTokens: form.elements.maxTokens?.value ?? planner.maxTokens,
        contextLimit: form.elements.contextLimit?.value ?? planner.contextLimit,
        outputLanguage: form.elements.outputLanguage?.value ?? planner.outputLanguage,
        customLanguage: form.elements.customLanguage?.value ?? planner.customLanguage,
        bodyPromptEnabled: form.elements.bodyPromptEnabled?.checked ?? planner.bodyPromptEnabled,
    };
    if (form.elements.bodyPrompt) values.bodyPrompt = form.elements.bodyPrompt.value;
    if (form.elements.phonePrompt) values.phonePrompt = form.elements.phonePrompt.value;
    if (form.elements.trackPrompt) values.trackPrompt = form.elements.trackPrompt.value;
    return values;
}

function collectPromptWorkflowDraft() {
    const list = document.querySelector('[data-prompt-entry-list]');
    if (!list) return null;
    return {
        kind: list.dataset.workflowKind,
        entries: [...list.querySelectorAll('[data-prompt-entry-id]')].map(card => ({
            id: card.dataset.promptEntryId,
            name: card.querySelector('[data-prompt-entry-name]')?.value || '未命名条目',
            role: card.querySelector('[data-prompt-entry-role]')?.value || 'system',
            enabled: card.querySelector('[data-prompt-entry-enabled]')?.checked !== false,
            content: card.querySelector('[data-prompt-entry-content]')?.value || '',
        })),
    };
}

function commitPromptWorkflowDraft() {
    const draft = collectPromptWorkflowDraft();
    if (!draft) return null;
    return FrontendVoiceTools.updatePromptWorkflowEntries(draft.kind, draft.entries);
}

function downloadPromptPresetFile(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function syncPlannerOutputLanguage(language) {
    const textLang = ['zh', 'yue', 'ja', 'en', 'auto'].includes(language) ? language : 'auto';
    TTS_ProviderRegistry.updateSettings('gpt_sovits', { textLang });
}

function savePlannerForm(form) {
    const values = collectPlannerForm(form);
    const planner = FrontendVoiceTools.updatePlannerSettings(values);
    syncPlannerOutputLanguage(planner.outputLanguage);
    return planner;
}

function getPhoneChatComposerState(form) {
    const text = form?.elements?.message?.value?.trim() || '';
    const type = ['voice', 'image', 'transfer', 'sticker'].includes(state.chatComposerTool)
        ? state.chatComposerTool
        : 'text';
    const amount = form?.elements?.amount?.value?.trim() || '';
    const hasComposerTool = type !== 'text';
    const composing = Boolean(text || hasComposerTool);
    const stickerName = form?.elements?.stickerName?.value?.trim() || '';
    const stickerUrl = form?.querySelector('input[name="stickerName"]:checked')?.dataset?.stickerUrl || '';
    const sendable = (() => {
        if (text) return true;
        if (type === 'transfer') return Number(amount) > 0;
        if (type === 'sticker') return Boolean(stickerName);
        return false;
    })();
    const pendingCount = Math.max(0, Number(form?.dataset?.pendingCount) || 0);
    return {
        text,
        type,
        amount,
        note: form?.elements?.note?.value?.trim() || '',
        stickerName,
        stickerUrl,
        pendingCount,
        replyMode: !composing && pendingCount > 0,
        sendable,
    };
}

function syncPhoneChatSubmitButton(form = document.querySelector('[data-phone-chat-form]')) {
    const button = form?.querySelector('[data-chat-submit-mode]');
    if (!button) return;
    const composer = getPhoneChatComposerState(form);
    const available = form.dataset.chatAvailable === 'true';
    button.dataset.chatSubmitMode = composer.replyMode ? 'reply' : 'send';
    button.classList.toggle('is-reply', composer.replyMode);
    button.setAttribute('aria-label', composer.replyMode ? '让角色回复' : '发送消息');
    button.title = composer.replyMode ? '让角色回复' : '发送消息';
    button.disabled = !available || Boolean(state.featureBusy) || (!composer.replyMode && !composer.sendable);
}

async function generatePendingPhoneChatReply() {
    if (state.featureBusy) return;
    state.featureBusy = 'phone-chat';
    state.chatActionId = '';
    updateView();
    let proactiveCall = null;
    try {
        const result = await FrontendVoiceTools.generatePhoneChatReply();
        state.chatScrollToBottom = true;
        const voiceCount = result.assistantMessages.filter(message => message.type === 'voice').length;
        announce(`${result.assistantMessages.length} 条角色消息已送达${voiceCount ? `，其中 ${voiceCount} 条语音` : ''}`);
        proactiveCall = result.proactiveCall || null;
    } catch (error) {
        announce(error.message || '手机聊天回复生成失败');
    } finally {
        state.featureBusy = null;
        updateView();
    }
    // 必须先清掉 busy 再触发主动来电，否则 maybeStartProactiveCall 的忙碌守卫会直接返回。
    if (proactiveCall) maybeStartProactiveCall(proactiveCall);
}

function maybeStartProactiveCall(proactiveCall) {
    if (!proactiveCall || proactiveCall.shouldCall !== true) return;
    if (state.featureBusy) return;
    if (['ringing', 'connecting', 'active'].includes(state.phoneStage)) return;
    const qq = TTS_ProviderRegistry.getQqState();
    const config = qq.proactiveCalls && typeof qq.proactiveCalls === 'object' ? qq.proactiveCalls : {};
    if (config.enabled === false) return;
    const caller = String(proactiveCall.caller || FrontendVoiceTools.getContextSnapshot().charName || '').trim();
    if (!caller) return;
    const cooldownByContact = config.cooldownByContact && typeof config.cooldownByContact === 'object'
        ? config.cooldownByContact
        : {};
    const lastCall = Number(cooldownByContact[caller]) || 0;
    const cooldownMinutes = Math.min(1440, Math.max(0, Number(config.cooldownMinutes) || 30));
    if (lastCall && Date.now() - lastCall < cooldownMinutes * 60000) return;
    TTS_ProviderRegistry.updateQqState({
        proactiveCalls: { cooldownByContact: { ...cooldownByContact, [caller]: Date.now() } },
    });
    startProactiveIncomingCall({
        caller,
        reason: String(proactiveCall.reason || '').slice(0, 600),
        tone: String(proactiveCall.tone || '').slice(0, 80),
    });
}

async function startProactiveIncomingCall({ caller, reason, tone }) {
    if (state.featureBusy) return;
    state.route = 'incoming';
    state.providerId = null;
    stopPhoneAudio();
    state.phoneDirection = 'incoming';
    state.phoneCaller = caller;
    state.phoneParticipants = [];
    state.phoneStage = 'connecting'; // 准备来电：先生成完整剧本并准备头两段语音，再进入响铃。
    state.phoneError = '';
    state.phoneElapsed = 0;
    state.phoneSegmentIndex = 0;
    state.phoneAudioQueue = [];
    state.phonePlan = {
        id: 'proactive-pending',
        kind: 'single',
        charName: caller,
        title: `${caller} 的来电`,
        reason: reason || `${caller} 想给你打个电话。`,
        tone,
        segments: [],
        createdAt: new Date().toISOString(),
        favorite: false,
    };
    updateView();
    state.featureBusy = 'phone-plan';
    const controller = new AbortController();
    state.featureAudioController = controller;
    try {
        const plan = await FrontendVoiceTools.generatePhonePlan({
            caller,
            brief: reason || `${caller} 主动打来的电话`,
            duration: 'medium',
            participants: [],
        });
        if (controller.signal.aborted || state.phoneStage !== 'connecting') return;
        state.phonePlan = plan;
        state.featureBusy = 'phone-audio';
        updateView();
        const head = await prepareToolAudio('phone', plan, controller.signal, { limit: 2 });
        if (controller.signal.aborted || state.phoneStage !== 'connecting') return;
        state.phoneAudioQueue = head;
        state.phoneStage = 'ringing';
        state.featureBusy = null;
        state.featureAudioController = null;
        updateView();
        window.clearTimeout(state.phoneRingTimer);
        state.phoneRingTimer = window.setTimeout(() => {
            if (state.phoneStage === 'ringing') finishPhoneCall('来电超时未接');
        }, 30000);
    } catch (error) {
        if (error?.name === 'AbortError') return;
        if (state.phoneStage === 'connecting') finishPhoneCall(error?.message || '来电准备失败');
    } finally {
        state.featureBusy = null;
        if (state.featureAudioController === controller) state.featureAudioController = null;
        if (['connecting', 'ringing'].includes(state.phoneStage)) updateView();
    }
}

async function generateProactivePhoneChat() {
    // 兼容旧调用：主动消息已由聊天回复统一生成，主动来电由回复里的 proactiveCall 触发。
    announce('主动来电会根据聊天情境由角色自己发起。');
}

function bindEvents(eventRoot) {
    eventRoot.addEventListener('click', async event => {
        if (Date.now() < state.suppressHomeClickUntil && event.target.closest('[data-home-pages]')) {
            event.preventDefault();
            return;
        }
        const trigger = event.target.closest('#tts-mobile-trigger');
        if (trigger) return TTS_Mobile.toggle();
        if (event.target.closest('#tts-mobile-close')) return TTS_Mobile.close();
        if (event.target.closest('.voice-device-island')) {
            const target = islandTargetRoute();
            if (target && state.route !== target) {
                state.route = target;
                state.providerId = null;
                updateView();
            }
            return;
        }
        if (event.target.closest('[data-theme-toggle]')) {
            const nextTheme = state.theme === 'system' ? 'dark' : state.theme === 'dark' ? 'light' : 'system';
            applyTheme(nextTheme);
            announce(nextTheme === 'system' ? '插件与语音气泡已跟随酒馆主题' : nextTheme === 'dark' ? '已切换到夜间主题' : '已切换到日间主题');
            return;
        }
        const homePageButton = event.target.closest('[data-set-home-page]');
        if (homePageButton) {
            setHomePage(homePageButton.dataset.setHomePage);
            return;
        }
        const taskAction = event.target.closest('[data-task-action]')?.dataset.taskAction;
        if (taskAction) {
            const scheduler = window.TTS_Scheduler;
            if (!scheduler) return announce('语音任务调度器尚未就绪');
            if (taskAction === 'pause') {
                scheduler.pause?.();
                announce(scheduler.isRunning ? '当前任务完成后暂停队列' : '任务队列已暂停');
            }
            if (taskAction === 'resume') {
                scheduler.resume?.();
                announce('任务队列已继续');
            }
            if (taskAction === 'cancel-pending') {
                scheduler.cancelPending?.();
                announce('等待中的任务已取消');
            }
            if (taskAction === 'clear-finished') {
                scheduler.clearFinished?.();
                announce('已清理完成和取消的任务记录');
            }
            return;
        }
        const taskCancel = event.target.closest('[data-task-cancel]')?.dataset.taskCancel;
        if (taskCancel) {
            window.TTS_Scheduler?.cancel?.(taskCancel);
            announce('任务已取消');
            return;
        }
        const taskRetry = event.target.closest('[data-task-retry]')?.dataset.taskRetry;
        if (taskRetry) {
            const retried = window.TTS_Scheduler?.retry?.(taskRetry);
            announce(retried ? '任务已重新加入队列' : '这条任务暂时不能重试');
            return;
        }
        const openPromptWorkflow = event.target.closest('[data-open-prompt-workflow]');
        if (openPromptWorkflow) {
            state.promptWorkflow = openPromptWorkflow.dataset.openPromptWorkflow || 'chat';
            state.route = 'prompt-manager';
            updateView();
            return;
        }
        const selectPromptWorkflow = event.target.closest('[data-select-prompt-workflow]');
        if (selectPromptWorkflow) {
            commitPromptWorkflowDraft();
            state.promptWorkflow = selectPromptWorkflow.dataset.selectPromptWorkflow;
            updateView();
            return;
        }
        if (event.target.closest('[data-save-prompt-workflow]')) {
            commitPromptWorkflowDraft();
            updateView();
            announce(`${FrontendVoiceTools.getPromptWorkflow(state.promptWorkflow).label}条目已保存`);
            return;
        }
        const movePromptEntry = event.target.closest('[data-move-prompt-entry]');
        if (movePromptEntry) {
            const id = movePromptEntry.closest('[data-prompt-entry-id]')?.dataset.promptEntryId;
            commitPromptWorkflowDraft();
            FrontendVoiceTools.movePromptWorkflowEntry(state.promptWorkflow, id, movePromptEntry.dataset.movePromptEntry);
            updateView();
            return;
        }
        const insertPromptEntry = event.target.closest('[data-insert-prompt-entry]');
        if (insertPromptEntry) {
            const id = insertPromptEntry.closest('[data-prompt-entry-id]')?.dataset.promptEntryId;
            commitPromptWorkflowDraft();
            FrontendVoiceTools.insertPromptWorkflowEntry(state.promptWorkflow, id, { role: 'system', name: '新条目' });
            updateView();
            return;
        }
        const deletePromptEntry = event.target.closest('[data-delete-prompt-entry]');
        if (deletePromptEntry) {
            const card = deletePromptEntry.closest('[data-prompt-entry-id]');
            const name = card?.querySelector('[data-prompt-entry-name]')?.value || '这个条目';
            if (!card || !window.confirm(`确定删除提示词条目“${name}”吗？`)) return;
            commitPromptWorkflowDraft();
            FrontendVoiceTools.deletePromptWorkflowEntry(state.promptWorkflow, card.dataset.promptEntryId);
            updateView();
            return;
        }
        if (event.target.closest('[data-reset-prompt-workflow]')) {
            const label = FrontendVoiceTools.getPromptWorkflow(state.promptWorkflow).label;
            if (!window.confirm(`确定把${label}恢复为内置默认条目吗？`)) return;
            FrontendVoiceTools.resetPromptWorkflow(state.promptWorkflow);
            updateView();
            announce(`${label}已恢复默认`);
            return;
        }
        if (event.target.closest('[data-save-workflow-preset]')) {
            const name = document.getElementById('tts-workflow-preset-name')?.value?.trim();
            try {
                commitPromptWorkflowDraft();
                const preset = FrontendVoiceTools.savePromptWorkflowPreset(state.promptWorkflow, name);
                updateView();
                announce(`预设“${preset.name}”已另存`);
            } catch (error) {
                announce(error.message || '预设保存失败');
            }
            return;
        }
        if (event.target.closest('[data-apply-workflow-preset]')) {
            const id = document.getElementById('tts-workflow-preset-select')?.value;
            if (!id) return announce('请先选择一个预设');
            try {
                const preset = FrontendVoiceTools.applyPromptWorkflowPreset(state.promptWorkflow, id);
                updateView();
                announce(`已应用预设“${preset.name}”`);
            } catch (error) {
                announce(error.message || '预设应用失败');
            }
            return;
        }
        if (event.target.closest('[data-delete-workflow-preset]')) {
            const select = document.getElementById('tts-workflow-preset-select');
            const id = select?.value;
            const name = select?.selectedOptions?.[0]?.textContent || '这个预设';
            if (!id || !window.confirm(`确定删除预设“${name}”吗？`)) return;
            FrontendVoiceTools.deletePromptWorkflowPreset(state.promptWorkflow, id);
            updateView();
            announce('预设已删除');
            return;
        }
        if (event.target.closest('[data-export-prompt-workflow]')) {
            commitPromptWorkflowDraft();
            downloadPromptPresetFile(FrontendVoiceTools.exportPromptPresetData(state.promptWorkflow), `TTS-${state.promptWorkflow}-presets.json`);
            announce('当前预设已导出');
            return;
        }
        if (event.target.closest('[data-export-all-prompt-workflows]')) {
            commitPromptWorkflowDraft();
            downloadPromptPresetFile(FrontendVoiceTools.exportPromptPresetData('all'), 'TTS-all-prompt-presets.json');
            announce('全部预设已导出');
            return;
        }
        if (event.target.closest('[data-import-prompt-workflows]')) {
            document.getElementById('tts-prompt-import-file')?.click();
            return;
        }
        if (event.target.closest('[data-toggle-chat-tools]')) {
            state.chatComposerTool = state.chatComposerTool ? '' : 'menu';
            updateView();
            document.getElementById('tts-phone-chat-input')?.focus();
            return;
        }
        const chatComposerTool = event.target.closest('[data-chat-composer-tool]');
        if (chatComposerTool) {
            const tool = chatComposerTool.dataset.chatComposerTool;
            state.chatComposerTool = state.chatComposerTool === tool ? 'menu' : tool;
            updateView();
            document.getElementById('tts-phone-chat-input')?.focus();
            return;
        }
        const chatActions = event.target.closest('[data-toggle-chat-actions]');
        if (chatActions) {
            const messageId = chatActions.dataset.toggleChatActions;
            state.chatActionId = state.chatActionId === messageId ? '' : messageId;
            updateView();
            return;
        }
        const chatQuote = event.target.closest('[data-quote-chat-message]');
        if (chatQuote) {
            state.chatQuoteId = chatQuote.dataset.quoteChatMessage;
            state.chatActionId = '';
            updateView();
            document.getElementById('tts-phone-chat-input')?.focus();
            return;
        }
        if (event.target.closest('[data-cancel-chat-quote]')) {
            state.chatQuoteId = '';
            updateView();
            return;
        }
        const chatVoiceToggle = event.target.closest('[data-toggle-chat-voice]');
        if (chatVoiceToggle) {
            const messageId = chatVoiceToggle.dataset.toggleChatVoice;
            state.chatVoiceExpanded.add(messageId);
            if (chatVoiceToggle.dataset.characterVoice === 'true') await playPhoneChatVoice(messageId);
            else updateView();
            return;
        }
        const chatVoice = event.target.closest('[data-play-chat-voice]');
        if (chatVoice) {
            await playPhoneChatVoice(chatVoice.dataset.playChatVoice);
            return;
        }
        const recalledChat = event.target.closest('[data-recall-chat-message]');
        if (recalledChat) {
            const messageId = recalledChat.dataset.recallChatMessage;
            if (!window.confirm('确定撤回这条手机消息吗？\n撤回后聊天中只保留撤回提示。')) return;
            if (state.chatAudioKey === messageId) stopPhoneChatAudio();
            FrontendVoiceTools.recallPhoneChatMessage(messageId);
            state.chatActionId = '';
            announce('消息已撤回');
            return;
        }
        const jumpChat = event.target.closest('[data-chat-jump-message]');
        if (jumpChat) {
            const target = [...document.querySelectorAll('[data-chat-message-id]')]
                .find(item => item.dataset.chatMessageId === jumpChat.dataset.chatJumpMessage);
            target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
            target?.classList.add('is-highlighted');
            window.setTimeout(() => target?.classList.remove('is-highlighted'), 1200);
            return;
        }
        if (event.target.closest('[data-start-chat-call]')) {
            await startPhoneChatCall();
            return;
        }
        if (event.target.closest('[data-toggle-call-favorite]')) {
            const button = event.target.closest('[data-toggle-call-favorite]');
            const id = button.dataset.toggleCallFavorite;
            try {
                const nextFavorite = FrontendVoiceTools.setCallFavorite(id, !(button.getAttribute('aria-pressed') === 'true'));
                announce(nextFavorite ? '已收藏到追踪 APP' : '已取消收藏');
            } catch (error) {
                announce(error.message || '收藏切换失败');
            }
            updateView();
            return;
        }
        if (event.target.closest('[data-set-tracks-filter]')) {
            const button = event.target.closest('[data-set-tracks-filter]');
            state.tracksFilter = button.dataset.setTracksFilter === 'favorites' ? 'favorites' : 'all';
            updateView();
            return;
        }
        if (event.target.closest('[data-clear-phone-chat]')) {
            if (!window.confirm('确定清空当前角色的全部手机聊天记录吗？\n这个操作无法恢复。')) return;
            stopPhoneChatAudio();
            FrontendVoiceTools.clearPhoneChatThread();
            state.chatQuoteId = '';
            state.chatActionId = '';
            state.chatVoiceExpanded.clear();
            announce('当前手机聊天记录已清空');
            return;
        }
        if (event.target.closest('[data-fetch-planner-models]')) {
            const form = event.target.closest('[data-planner-settings-form]');
            if (!form || state.plannerModelsBusy) return;
            const values = collectPlannerForm(form);
            FrontendVoiceTools.updatePlannerSettings(values);
            state.plannerModelsBusy = true;
            updateView();
            try {
                state.plannerModels = await FrontendVoiceTools.fetchPlannerModels(values);
                if (!values.model && state.plannerModels[0]) {
                    FrontendVoiceTools.updatePlannerSettings({ model: state.plannerModels[0] });
                }
                announce(`已拉取 ${state.plannerModels.length} 个模型`);
            } catch (error) {
                announce(error.message || '模型列表拉取失败');
            } finally {
                state.plannerModelsBusy = false;
                updateView();
            }
            return;
        }
        if (event.target.closest('[data-save-api-preset]')) {
            const form = event.target.closest('[data-planner-settings-form]');
            const name = form?.querySelector('#tts-api-preset-name')?.value?.trim();
            if (!form) return;
            try {
                savePlannerForm(form);
                const preset = FrontendVoiceTools.savePlannerApiPreset(name);
                updateView();
                announce(`连接预设“${preset.name}”已保存`);
            } catch (error) {
                announce(error.message || '连接预设保存失败');
            }
            return;
        }
        if (event.target.closest('[data-apply-api-preset]')) {
            const form = event.target.closest('[data-planner-settings-form]');
            const id = form?.querySelector('#tts-api-preset-select')?.value;
            if (!id) return announce('请先选择一个连接预设');
            try {
                const preset = FrontendVoiceTools.applyPlannerApiPreset(id);
                state.plannerModels = preset.model ? [preset.model] : [];
                updateView();
                announce(`已应用连接预设“${preset.name}”`);
            } catch (error) {
                announce(error.message || '连接预设应用失败');
            }
            return;
        }
        if (event.target.closest('[data-delete-api-preset]')) {
            const form = event.target.closest('[data-planner-settings-form]');
            const id = form?.querySelector('#tts-api-preset-select')?.value;
            const preset = FrontendVoiceTools.getPlannerApiPresets().find(item => item.id === id);
            if (!preset || !window.confirm(`确定删除连接预设“${preset.name}”吗？`)) return;
            FrontendVoiceTools.deletePlannerApiPreset(id);
            updateView();
            announce(`已删除连接预设“${preset.name}”`);
            return;
        }
        if (event.target.closest('[data-save-tag-preset]')) {
            const form = event.target.closest('[data-runtime-settings-form]');
            const name = form?.querySelector('#tts-tag-preset-name')?.value?.trim();
            const template = form?.elements.tagTemplate?.value;
            try {
                const preset = TTS_ProviderRegistry.saveTagPreset(name, template);
                updateView();
                announce(`聊天触发格式“${preset.name}”已保存`);
            } catch (error) {
                announce(error.message || '格式预设保存失败');
            }
            return;
        }
        if (event.target.closest('[data-delete-tag-preset]')) {
            const id = document.querySelector('#tts-tag-preset')?.value;
            const preset = TTS_ProviderRegistry.getTagPresets().find(item => item.id === id);
            if (!preset || !id?.startsWith('tag-') || !window.confirm(`确定删除格式预设“${preset.name}”吗？`)) return;
            TTS_ProviderRegistry.deleteTagPreset(id);
            updateView();
            announce(`已删除格式预设“${preset.name}”`);
            return;
        }
        const startCall = event.target.closest('[data-start-phone-call]');
        if (startCall) {
            startPhoneRinging(startCall.dataset.startPhoneCall);
            return;
        }
        if (event.target.closest('[data-answer-call]')) {
            await answerPhoneCall();
            return;
        }
        if (event.target.closest('[data-decline-call], [data-hangup-call]')) {
            finishPhoneCall();
            return;
        }
        if (event.target.closest('[data-resume-call]')) {
            await resumePhoneCall();
            return;
        }
        if (event.target.closest('[data-close-call-result]')) {
            resetPhoneCall();
            return;
        }
        const favoriteManage = event.target.closest('[data-manage-voice-favorite]');
        if (favoriteManage) {
            const nextKey = favoriteManage.dataset.manageVoiceFavorite;
            state.favoriteManageKey = state.favoriteManageKey === nextKey ? '' : nextKey;
            updateView();
            return;
        }
        if (event.target.closest('[data-cancel-voice-favorite-manage]')) {
            state.favoriteManageKey = '';
            updateView();
            return;
        }
        const favoriteRemove = event.target.closest('[data-remove-voice-favorite]');
        if (favoriteRemove) {
            removeVoiceFavorite(favoriteRemove);
            return;
        }
        const favoriteToggle = event.target.closest('[data-toggle-voice-favorite]');
        if (favoriteToggle) {
            toggleVoiceFavorite(favoriteToggle);
            return;
        }
        const audioButton = event.target.closest('[data-play-tool-audio]');
        if (audioButton) {
            return playToolAudio(audioButton.dataset.playToolAudio, audioButton.dataset.toolRecordId);
        }
        if (event.target.closest('[data-stop-tool-audio]')) {
            state.featureAudioController?.abort();
            state.featureAudioController = null;
            state.featureBusy = null;
            stopToolPlayback();
            updateView();
            return;
        }
        const regenerateToolRecordButton = event.target.closest('[data-regenerate-tool-record]');
        if (regenerateToolRecordButton) {
            await regenerateToolRecord(
                regenerateToolRecordButton.dataset.regenerateToolRecord,
                regenerateToolRecordButton.dataset.toolRecordId,
            );
            return;
        }
        const deleteToolRecord = event.target.closest('[data-delete-tool-record]');
        if (deleteToolRecord) {
            const kind = deleteToolRecord.dataset.deleteToolRecord;
            const recordId = deleteToolRecord.dataset.toolRecordId;
            const record = getToolRecord(kind, recordId);
            if (!record) return announce('找不到这条记录');
            const label = kind === 'phone' ? record.title || '这通来电' : record.scene || '这次对话追踪';
            if (!window.confirm(`确定删除“${label}”吗？删除后无法恢复。`)) return;
            clearToolRecordAudio(kind, recordId);
            if (kind === 'phone') {
                FrontendVoiceTools.deletePhoneCall(recordId);
                if (state.phonePlan?.id === recordId) state.phonePlan = null;
            } else {
                announce('这条记录类型已不支持删除');
                return;
            }
            updateView();
            announce(kind === 'phone' ? '来电记录已删除' : '对话追踪已删除');
            return;
        }
        if (event.target.closest('[data-minimax-sync]')) {
            return syncMiniMaxResources();
        }
        if (event.target.closest('[data-elevenlabs-sync]')) {
            return syncElevenLabsResources();
        }
        const miniMaxResource = event.target.closest('[data-minimax-resource]');
        if (miniMaxResource) {
            selectMiniMaxResource(miniMaxResource);
            return;
        }
        const elevenLabsResource = event.target.closest('[data-elevenlabs-resource]');
        if (elevenLabsResource) {
            selectElevenLabsResource(elevenLabsResource);
            return;
        }
        const miniMaxFilter = event.target.closest('[data-minimax-voice-filter]');
        if (miniMaxFilter) {
            document.querySelectorAll('[data-minimax-voice-filter]').forEach(button => {
                button.classList.toggle('is-active', button === miniMaxFilter);
            });
            filterMiniMaxVoices();
            return;
        }

        const contactToggle = event.target.closest('[data-contact-toggle]')?.dataset.contactToggle;
        if (contactToggle) {
            state.contactName = state.contactName === contactToggle ? '' : contactToggle;
            updateView();
            return;
        }
        const contactRoute = event.target.closest('[data-contact-open-route]')?.dataset.contactOpenRoute;
        if (contactRoute) {
            state.routeCharacter = contactRoute;
            state.route = 'library';
            state.providerId = null;
            updateView();
            return;
        }
        const contactChat = event.target.closest('[data-contact-open-chat]')?.dataset.contactOpenChat;
        if (contactChat) {
            state.route = 'chat';
            updateView();
            return;
        }
        const settingsJump = event.target.closest('[data-settings-jump]')?.dataset.settingsJump;
        if (settingsJump) {
            document.getElementById(settingsJump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
        const stickerRemove = event.target.closest('[data-sticker-remove]')?.dataset.stickerRemove;
        if (stickerRemove) {
            const currentQq = TTS_ProviderRegistry.getQqState();
            const stickers = (Array.isArray(currentQq.stickers) ? currentQq.stickers : [])
                .filter(sticker => sticker.id !== stickerRemove);
            TTS_ProviderRegistry.updateQqState({ stickers });
            state.stickerSelected = (state.stickerSelected || []).filter(id => id !== stickerRemove);
            if (state.stickerEditingId === stickerRemove) state.stickerEditingId = '';
            updateView();
            announce('表情包已删除');
            return;
        }
        const stickerSelect = event.target.closest('input[data-sticker-select]');
        if (stickerSelect) {
            const id = stickerSelect.dataset.stickerSelect;
            const selected = new Set(Array.isArray(state.stickerSelected) ? state.stickerSelected : []);
            if (stickerSelect.checked) selected.add(id);
            else selected.delete(id);
            state.stickerSelected = [...selected];
            updateView();
            return;
        }
        const stickerSelectAll = event.target.closest('input[data-sticker-select-all]');
        if (stickerSelectAll) {
            const currentQq = TTS_ProviderRegistry.getQqState();
            const stickers = Array.isArray(currentQq.stickers) ? currentQq.stickers : [];
            state.stickerSelected = stickerSelectAll.checked ? stickers.map(sticker => sticker.id) : [];
            updateView();
            return;
        }
        const stickerDeleteSelected = event.target.closest('[data-sticker-delete-selected]');
        if (stickerDeleteSelected) {
            const selected = new Set(Array.isArray(state.stickerSelected) ? state.stickerSelected : []);
            if (!selected.size) return;
            if (!window.confirm(`确定删除选中的 ${selected.size} 个表情包吗？`)) return;
            const currentQq = TTS_ProviderRegistry.getQqState();
            const stickers = (Array.isArray(currentQq.stickers) ? currentQq.stickers : [])
                .filter(sticker => !selected.has(sticker.id));
            TTS_ProviderRegistry.updateQqState({ stickers });
            state.stickerSelected = [];
            state.stickerEditingId = '';
            updateView();
            announce(`已删除 ${selected.size} 个表情包`);
            return;
        }
        const stickerBulkToggle = event.target.closest('[data-sticker-bulk-toggle]');
        if (stickerBulkToggle) {
            state.stickerBulkEditOpen = !state.stickerBulkEditOpen;
            updateView();
            return;
        }
        const stickerEdit = event.target.closest('[data-sticker-edit]')?.dataset.stickerEdit;
        if (stickerEdit) {
            state.stickerEditingId = stickerEdit;
            updateView();
            return;
        }
        if (event.target.closest('[data-sticker-cancel-edit]')) {
            state.stickerEditingId = '';
            updateView();
            return;
        }
        const stickerSaveEdit = event.target.closest('[data-sticker-save-edit]');
        if (stickerSaveEdit) {
            const id = state.stickerEditingId;
            const figure = stickerSaveEdit.closest('.voice-sticker-item');
            const name = String(figure?.querySelector('[data-sticker-edit-name]')?.value || '').trim().slice(0, 40) || '表情包';
            const url = String(figure?.querySelector('[data-sticker-edit-url]')?.value || '').trim();
            if (!/^https?:\/\//.test(url)) {
                announce('表情包地址必须是 http(s) 链接');
                return;
            }
            const currentQq = TTS_ProviderRegistry.getQqState();
            const stickers = (Array.isArray(currentQq.stickers) ? currentQq.stickers : [])
                .map(sticker => (sticker.id === id ? { ...sticker, name, url } : sticker));
            TTS_ProviderRegistry.updateQqState({ stickers });
            state.stickerEditingId = '';
            updateView();
            announce('表情包已更新');
            return;
        }
        const qqPickFriend = event.target.closest('[data-qq-pick-friend]')?.dataset.qqPickFriend;
        if (qqPickFriend) {
            const currentQq = TTS_ProviderRegistry.getQqState();
            const currentFriends = Array.isArray(currentQq.friends) ? currentQq.friends : [];
            TTS_ProviderRegistry.updateQqState({
                friends: [...currentFriends, { name: qqPickFriend, addedAt: Date.now() }],
            });
            state.qqAddFriendOpen = false;
            announce(`已添加好友 ${qqPickFriend}`);
            updateView();
            return;
        }
        if (event.target.closest('[data-qq-add-friend]')) {
            state.qqAddFriendOpen = !state.qqAddFriendOpen;
            state.qqGroupFormOpen = false;
            updateView();
            return;
        }
        if (event.target.closest('[data-qq-hide-current]')) {
            const currentName = FrontendVoiceTools.getContextSnapshot().charName || '当前角色';
            TTS_ProviderRegistry.updateUiSettings({ hiddenCurrentCharName: currentName });
            updateView();
            announce(`已删除好友 ${currentName}，切换角色卡或新开聊天后恢复`);
            return;
        }
        if (event.target.closest('[data-qq-restore-current]')) {
            TTS_ProviderRegistry.updateUiSettings({ hiddenCurrentCharName: '' });
            updateView();
            announce('已恢复当前角色好友');
            return;
        }
        if (event.target.closest('[data-qq-create-group]')) {
            state.qqGroupFormOpen = !state.qqGroupFormOpen;
            state.qqAddFriendOpen = false;
            if (!state.qqGroupDraft) state.qqGroupDraft = { name: '', members: [] };
            updateView();
            return;
        }
        if (event.target.closest('[data-qq-close-picker]')) {
            state.qqAddFriendOpen = false;
            state.qqGroupFormOpen = false;
            state.qqGroupDraft = null;
            updateView();
            return;
        }
        const qqOpenGroup = event.target.closest('[data-qq-open-group]')?.dataset.qqOpenGroup;
        if (qqOpenGroup) {
            state.qqOpenGroup = qqOpenGroup;
            updateView();
            return;
        }
        if (event.target.closest('[data-qq-close-group]')) {
            state.qqOpenGroup = null;
            updateView();
            return;
        }
        const qqOpenFriend = event.target.closest('[data-qq-open-friend]')?.dataset.qqOpenFriend;
        if (qqOpenFriend) {
            state.route = 'chat';
            updateView();
            return;
        }
        if (event.target.closest('[data-contact-open-favorites]')) {
            state.route = 'favorites';
            updateView();
            return;
        }

        const promptLabKind = event.target.closest('[data-prompt-lab-kind]')?.dataset.promptLabKind;
        if (promptLabKind) {
            state.promptLabKind = promptLabKind;
            state.promptLabResult = null;
            state.promptLabError = '';
            updateView();
            return;
        }
        if (event.target.closest('[data-prompt-lab-edit]')) {
            state.promptWorkflow = state.promptLabKind;
            state.route = 'prompt-manager';
            updateView();
            return;
        }
        if (event.target.closest('[data-save-prompt-revision]')) {
            const name = document.getElementById('tts-prompt-revision-name')?.value?.trim();
            try {
                const revision = FrontendVoiceTools.savePromptWorkflowRevision(state.promptLabKind, name);
                updateView();
                announce(`版本“${revision.name}”已保存`);
            } catch (error) {
                announce(error.message || '版本保存失败');
            }
            return;
        }
        if (event.target.closest('[data-test-prompt-workflow]')) {
            if (state.featureBusy) return;
            state.featureBusy = 'prompt-lab';
            state.promptLabResult = null;
            state.promptLabError = '';
            updateView();
            try {
                state.promptLabResult = await FrontendVoiceTools.testPromptWorkflow(state.promptLabKind);
                announce('提示词试运行完成');
            } catch (error) {
                state.promptLabError = error.message || '提示词试运行失败';
                announce(state.promptLabError);
            } finally {
                state.featureBusy = null;
                updateView();
            }
            return;
        }
        const restorePromptRevision = event.target.closest('[data-restore-prompt-revision]');
        if (restorePromptRevision) {
            const revisions = FrontendVoiceTools.getPromptWorkflowRevisions(state.promptLabKind);
            const revision = revisions.find(item => item.id === restorePromptRevision.dataset.restorePromptRevision);
            if (!revision || !window.confirm(`确定恢复提示词版本“${revision.name}”吗？当前版本会自动备份。`)) return;
            try {
                FrontendVoiceTools.restorePromptWorkflowRevision(state.promptLabKind, revision.id);
                state.promptLabResult = null;
                state.promptLabError = '';
                updateView();
                announce(`已恢复“${revision.name}”`);
            } catch (error) {
                announce(error.message || '版本恢复失败');
            }
            return;
        }
        const deletePromptRevision = event.target.closest('[data-delete-prompt-revision]');
        if (deletePromptRevision) {
            const revisions = FrontendVoiceTools.getPromptWorkflowRevisions(state.promptLabKind);
            const revision = revisions.find(item => item.id === deletePromptRevision.dataset.deletePromptRevision);
            if (!revision || !window.confirm(`确定删除提示词版本“${revision.name}”吗？`)) return;
            FrontendVoiceTools.deletePromptWorkflowRevision(state.promptLabKind, revision.id);
            updateView();
            announce('提示词版本已删除');
            return;
        }
        const notificationFilter = event.target.closest('[data-notification-filter]')?.dataset.notificationFilter;
        if (notificationFilter) {
            state.notificationFilter = notificationFilter;
            updateView();
            return;
        }
        if (event.target.closest('[data-mark-all-notifications-read]')) {
            state.notifications.forEach(item => { item.read = true; });
            persistVoiceNotifications();
            updateView();
            announce('全部通知已标为已读');
            return;
        }
        if (event.target.closest('[data-clear-notifications]')) {
            if (!window.confirm('确定清空全部通知记录吗？')) return;
            state.notifications = [];
            persistVoiceNotifications();
            updateView();
            announce('通知记录已清空');
            return;
        }
        const openNotification = event.target.closest('[data-open-notification]');
        if (openNotification) {
            const item = markVoiceNotificationRead(openNotification.dataset.openNotification);
            if (item?.route) {
                state.route = item.route;
                state.providerId = null;
            }
            updateView();
            return;
        }
        const deleteNotification = event.target.closest('[data-delete-notification]');
        if (deleteNotification) {
            state.notifications = state.notifications.filter(item => item.id !== deleteNotification.dataset.deleteNotification);
            persistVoiceNotifications();
            updateView();
            return;
        }
        if (event.target.closest('[data-export-voice-backup]')) {
            const backup = createVoiceBackupBundle();
            downloadPromptPresetFile(backup, `TTS-phone-backup-${new Date().toISOString().slice(0, 10)}.json`);
            state.lastBackupAt = backup.exportedAt;
            localStorage.setItem('tts_voice_hub_last_backup_at', state.lastBackupAt);
            updateView();
            announce('完整备份已导出');
            return;
        }
        if (event.target.closest('[data-import-voice-backup]')) {
            document.getElementById('tts-voice-backup-file')?.click();
            return;
        }
        if (event.target.closest('[data-undo-backup-restore]')) {
            if (!state.restoreRollback || !window.confirm('确定撤销刚才的数据恢复吗？')) return;
            const rollback = state.restoreRollback;
            restoreVoiceBackupBundle(rollback, { keepRollback: false });
            state.restoreRollback = null;
            updateView();
            announce('已撤销上次恢复');
            return;
        }

        const dialKey = event.target.closest('[data-dial-key]')?.dataset.dialKey;
        if (dialKey) {
            const input = document.getElementById('tts-dial-input');
            if (input) {
                if (dialKey === 'back') input.value = input.value.slice(0, -1);
                else input.value = (input.value + dialKey).replace(/\s/g, '').slice(0, 20);
                state.dialInput = input.value;
            }
            return;
        }
        const dialFill = event.target.closest('[data-dial-fill]')?.dataset.dialFill;
        if (dialFill) {
            const input = document.getElementById('tts-dial-input');
            if (input) {
                input.value = virtualNumber(dialFill);
                state.dialInput = input.value;
            }
            return;
        }
        if (event.target.closest('[data-dial-call]')) {
            if (state.featureBusy) return;
            const input = document.getElementById('tts-dial-input');
            const normalizeNumber = value => String(value || '').replace(/[\s+\-]/g, '');
            const number = normalizeNumber(input?.value);
            const contacts = FrontendVoiceTools.getVoiceContacts?.() || [];
            const match = contacts.find(contact => normalizeNumber(virtualNumber(contact.name)) === number);
            if (!match) {
                announce('该号码不存在，请从通讯录号码选择');
                return;
            }
            const form = document.getElementById('tts-phone-plan-form');
            const source = String(form?.elements?.source?.value || state.phoneContentSource || 'context');
            const brief = source === 'topic' ? String(form?.elements?.brief?.value || '').trim() : '';
            if (source === 'topic' && !brief) {
                announce('请填写通话主题');
                return;
            }
            let participants = [...(form?.querySelectorAll('input[name="participants"]:checked') || [])]
                .map(element => String(element.value)).filter(Boolean);
            if (!participants.includes(match.name)) participants = [match.name, ...participants];
            if (!participants.length) participants = [match.name];
            state.dialInput = input?.value || '';
            state.phoneCaller = match.name;
            state.phoneContentSource = source;
            state.phoneStage = 'setup';
            await runPhonePlan({
                caller: match.name,
                brief,
                duration: String(form?.elements?.duration?.value || 'medium'),
                direction: 'outgoing',
                participants,
            });
            return;
        }
        const route = event.target.closest('[data-route]')?.dataset.route;
        if (route) {
            if (state.route === 'prompt-manager') commitPromptWorkflowDraft();
            if (route === 'home' && state.route === 'settings' && state.settingsTab) {
                state.settingsTab = '';
                updateView();
                return;
            }
            if (route === 'library') state.routeCharacter = null;
            state.route = route;
            state.providerId = null;
            if (route === 'drawing') loadDrawingGallery();
            updateView();
            return;
        }
        const settingsTab = event.target.closest('[data-settings-tab]')?.dataset.settingsTab;
        if (settingsTab) {
            state.settingsTab = settingsTab;
            updateView();
            return;
        }
        if (event.target.closest('[data-settings-back]')) {
            state.settingsTab = '';
            updateView();
            return;
        }
        const setTheme = event.target.closest('[data-set-theme]')?.dataset.setTheme;
        if (setTheme) {
            applyTheme(setTheme);
            updateView();
            return;
        }
        if (event.target.closest('[data-reset-custom-theme]')) {
            TTS_ProviderRegistry.updateUiSettings({
                customTheme: { bg: '', surface: '', accent: '', glow: '', wallpaper: '' },
            });
            applyTheme('custom', false);
            updateView();
            announce('自定义主题已恢复默认');
            return;
        }
        const selectDrawingPreset = event.target.closest('[data-select-drawing-preset]')?.dataset.selectDrawingPreset;
        if (selectDrawingPreset) {
            TTS_ProviderRegistry.updateDrawingSettings({ activePresetId: selectDrawingPreset });
            state.drawingDynamic = '';
            updateView();
            return;
        }
        const deleteDrawingPreset = event.target.closest('[data-delete-drawing-preset]')?.dataset.deleteDrawingPreset;
        if (deleteDrawingPreset) {
            const drawing = TTS_ProviderRegistry.getDrawingSettings();
            TTS_ProviderRegistry.updateDrawingSettings({
                presets: drawing.presets.filter(preset => preset.id !== deleteDrawingPreset),
                activePresetId: drawing.activePresetId === deleteDrawingPreset ? '' : drawing.activePresetId,
            });
            state.drawingDynamic = '';
            updateView();
            announce('绘图预设已删除');
            return;
        }
        const deleteDrawingImageKey = event.target.closest('[data-delete-drawing-image]')?.dataset.deleteDrawingImage;
        if (deleteDrawingImageKey) {
            await deleteDrawingImage(deleteDrawingImageKey);
            return;
        }
        if (event.target.closest('[data-clear-drawing-gallery]')) {
            await clearDrawingGallery();
            return;
        }
        if (event.target.closest('[data-save-drawing-preset]')) {
            const name = document.getElementById('tts-drawing-preset-name')?.value.trim();
            const form = document.querySelector('[data-drawing-form]');
            if (!name) {
                announce('请先填写预设名称');
                return;
            }
            const drawing = TTS_ProviderRegistry.getDrawingSettings();
            const preset = {
                id: `draw-${Date.now().toString(36)}`,
                name: name.slice(0, 40),
                prefix: form?.elements.prefix?.value?.trim() || '',
                suffix: form?.elements.suffix?.value?.trim() || '',
                negative: form?.elements.negative?.value?.trim() || '',
                updatedAt: Date.now(),
            };
            TTS_ProviderRegistry.updateDrawingSettings({
                presets: [...drawing.presets, preset],
                activePresetId: preset.id,
            });
            updateView();
            announce(`绘图预设「${preset.name}」已保存`);
            return;
        }
        if (event.target.closest('[data-generate-drawing-tags]')) {
            if (state.featureBusy) return;
            state.featureBusy = 'drawing-tags';
            updateView();
            try {
                const context = FrontendVoiceTools.getContextSnapshot();
                const tags = await generateQuietPrompt(`你是 NovelAI 绘画提示词专家。根据当前角色「${context.charName || '未命名角色'}」与聊天场景，生成动态正面 Tag。只输出逗号分隔的英文 tags，不要解释、不要引号。`);
                state.drawingDynamic = String(tags || '').replace(/^["'\s]+|["'\s]+$/g, '');
                announce('动态 Tag 已生成');
            } catch (error) {
                announce(error.message || '动态 Tag 生成失败');
            } finally {
                state.featureBusy = null;
                updateView();
            }
            return;
        }
        const stickerClear = event.target.closest('[data-sticker-clear]');
        if (stickerClear) {
            TTS_ProviderRegistry.updateQqState({ stickers: [] });
            updateView();
            announce('表情包已全部清空');
            return;
        }
        const dockRoute = event.target.closest('[data-dock-route]')?.dataset.dockRoute;
        if (dockRoute) {
            state.route = dockRoute;
            state.providerId = null;
            if (dockRoute === 'drawing') loadDrawingGallery();
            updateView();
            return;
        }
        const providerId = event.target.closest('[data-open-provider]')?.dataset.openProvider;
        if (providerId) {
            state.providerId = providerId;
            state.route = 'provider';
            updateView();
            return;
        }
        const panel = event.target.closest('[data-open-panel]')?.dataset.openPanel;
        if (panel) {
            state.route = panel;
            if (panel === 'drawing') loadDrawingGallery();
            updateView();
            return;
        }
        const routeCharacter = event.target.closest('[data-edit-route]')?.dataset.editRoute;
        if (routeCharacter) {
            const opening = state.routeCharacter !== routeCharacter;
            state.routeCharacter = opening ? routeCharacter : null;
            updateView();
            if (opening) window.requestAnimationFrame(() => {
                document.querySelector('[data-character-route-form]')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
            });
            return;
        }
        const removeRoute = event.target.closest('[data-remove-route]')?.dataset.removeRoute;
        if (removeRoute) {
            TTS_ProviderRegistry.removeCharacterRoute(removeRoute);
            announce(`已恢复 ${removeRoute} 的默认语音路由`);
            return;
        }
        const deleteCharacter = event.target.closest('[data-delete-character]')?.dataset.deleteCharacter;
        if (deleteCharacter) {
            if (!window.confirm(`确定删除角色“${deleteCharacter}”及其语音路由吗？`)) return;
            await deleteCharacterWithBindings(deleteCharacter);
            updateView();
            announce(`已删除角色 ${deleteCharacter}`);
            return;
        }
        const deleteQuickCharacter = event.target.closest('[data-delete-quick-character]')?.dataset.deleteQuickCharacter;
        if (deleteQuickCharacter) {
            if (!window.confirm(`确定删除角色“${deleteQuickCharacter}”及其语音路由吗？删除后它会从快速编辑列表隐藏。`)) return;
            await deleteCharacterWithBindings(deleteQuickCharacter);
            updateView();
            announce(`已删除角色 ${deleteQuickCharacter}`);
            return;
        }
        if (event.target.closest('[data-clear-audio-cache]')) {
            const button = event.target.closest('[data-clear-audio-cache]');
            button.disabled = true;
            try {
                await TTS_AudioCache.clear();
                const memory = window.TTS_State?.CACHE?.audioMemory || {};
                Object.values(memory).forEach(url => {
                    if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
                });
                window.TTS_State.CACHE.audioMemory = {};
                for (const queue of state.toolAudioCache.values()) {
                    queue.forEach(item => {
                        if (item.url?.startsWith('blob:')) URL.revokeObjectURL(item.url);
                    });
                }
                state.toolAudioCache.clear();
                window.TTS_Scheduler?.invalidateVisibleBubbles(false);
                state.cacheStats = { count: 0, bytes: 0 };
                await refreshCacheStats();
                announce('本地语音缓存已清空');
            } catch (error) {
                announce(error.message || '清空缓存失败');
            } finally {
                button.disabled = false;
            }
            return;
        }
        const checkId = event.target.closest('[data-check-provider]')?.dataset.checkProvider;
        if (checkId) return checkProvider(checkId);
        const activateId = event.target.closest('[data-activate-provider]')?.dataset.activateProvider;
        if (activateId) {
            const settings = commitProviderForm(activateId);
            if (activateId === 'gpt_sovits') {
                try {
                    await syncGptServiceSettings(settings);
                } catch (error) {
                    announce(`${error.message}；地址已保存在插件中`);
                }
            }
            TTS_ProviderRegistry.setActive(activateId);
            announce(`${currentProvider().name} 已设为当前引擎`);
            return;
        }
        const previewId = event.target.closest('[data-preview-provider]')?.dataset.previewProvider;
        if (previewId) return previewProvider(previewId);
        if (event.target.closest('[data-check-all]')) {
            const ids = getSnapshot().providers.map(item => item.id);
            await Promise.allSettled(ids.map(id => TTS_ProviderRegistry.checkProvider(id)));
            announce('全部引擎检测完成');
        }
    });

    eventRoot.addEventListener('submit', async event => {
        if (event.target.hasAttribute('data-qq-settings-form')) {
            event.preventDefault();
            const form = event.target;
            TTS_ProviderRegistry.updateQqState({
                proactiveCalls: {
                    enabled: form.elements.proactiveEnabled?.checked !== false,
                    cooldownMinutes: Math.min(1440, Math.max(0, Number(form.elements.proactiveCooldown?.value) || 30)),
                },
            });
            updateView();
            announce('主动来电设置已保存');
            return;
        }
        if (event.target.hasAttribute('data-sticker-add-form')) {
            event.preventDefault();
            const batchText = String(event.target.elements.stickerBatch?.value || '').trim();
            const incoming = batchText
                ? parseStickerBatchText(batchText)
                : (() => {
                    const url = String(event.target.elements.stickerUrl?.value || '').trim();
                    return url ? [{ name: (url.split('/').pop() || '').split('?')[0].slice(0, 40) || '表情包', url }] : [];
                })();
            if (!incoming.length) {
                announce('请按“名字URL,名字URL”格式填写');
                return;
            }
            const currentQq = TTS_ProviderRegistry.getQqState();
            const stickers = Array.isArray(currentQq.stickers) ? currentQq.stickers : [];
            const added = incoming.map(item => ({ id: `sticker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, ...item }));
            TTS_ProviderRegistry.updateQqState({ stickers: [...stickers, ...added] });
            updateView();
            announce(`已导入 ${added.length} 个表情包`);
            return;
        }
        if (event.target.hasAttribute('data-sticker-bulk-form')) {
            event.preventDefault();
            const incoming = parseStickerBatchText(event.target.elements.stickerBulk?.value || '');
            if (!incoming.length) {
                announce('没有可保存的表情包，请按“名字URL”格式填写');
                return;
            }
            const stickers = incoming.map(item => ({ id: `sticker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, ...item }));
            TTS_ProviderRegistry.updateQqState({ stickers });
            state.stickerBulkEditOpen = false;
            state.stickerSelected = [];
            updateView();
            announce(`已保存 ${stickers.length} 个表情包`);
            return;
        }
        if (event.target.hasAttribute('data-qq-group-form')) {
            event.preventDefault();
            const form = event.target;
            const groupName = String(form.elements.groupName?.value || '').trim();
            const members = [...form.querySelectorAll('input[name="member"]:checked')].map(input => input.value);
            if (!groupName) {
                announce('请先填写群名称');
                return;
            }
            if (members.length < 2) {
                announce('群聊需要至少选择两位好友');
                return;
            }
            const currentQq = TTS_ProviderRegistry.getQqState();
            const groups = Array.isArray(currentQq.groups) ? currentQq.groups : [];
            const group = {
                id: `qq-group-${Date.now().toString(36)}`,
                name: groupName,
                members,
                createdAt: Date.now(),
            };
            TTS_ProviderRegistry.updateQqState({ groups: [...groups, group] });
            state.qqGroupFormOpen = false;
            state.qqGroupDraft = null;
            state.qqOpenGroup = group.id;
            updateView();
            announce(`群聊「${groupName}」已创建`);
            return;
        }
        if (event.target.hasAttribute('data-phone-chat-form')) {
            event.preventDefault();
            if (state.featureBusy) return;
            const composer = getPhoneChatComposerState(event.target);
            if (composer.replyMode) {
                await generatePendingPhoneChatReply();
                return;
            }
            if (!composer.sendable) {
                if (composer.type === 'sticker') announce('请选择一个表情包');
                else if (composer.type === 'transfer') announce('请填写金额');
                else announce('请先输入要发送的消息');
                return;
            }
            const replyToId = state.chatQuoteId;
            try {
                const result = FrontendVoiceTools.appendPhoneChatMessage({
                    text: composer.text,
                    type: composer.type,
                    replyToId,
                    description: composer.type === 'image' ? composer.text : '',
                    amount: composer.amount,
                    note: composer.note,
                    stickerName: composer.stickerName,
                    stickerUrl: composer.stickerUrl,
                });
                event.target.reset();
                state.chatQuoteId = '';
                state.chatComposerTool = '';
                state.chatActionId = '';
                state.chatScrollToBottom = true;
                updateView();
                announce(`消息已发送，当前有 ${result.pendingCount} 条等待角色回复`);
            } catch (error) {
                announce(error.message || '消息发送失败');
            }
            return;
        }
        if (event.target.hasAttribute('data-phone-chat-settings-form')) {
            event.preventDefault();
            FrontendVoiceTools.updatePhoneChatSettings({
                maxHistory: event.target.elements.maxHistory.value,
                autoVoice: event.target.elements.autoVoice.checked,
            });
            announce('聊天设置已保存');
            return;
        }
        if (event.target.hasAttribute('data-edit-voice-favorite-form')) {
            event.preventDefault();
            const form = event.target;
            try {
                const previousProviderId = form.dataset.originalProviderId;
                const previousVoiceId = form.dataset.originalVoiceId;
                const favorite = FrontendVoiceTools.updateVoiceFavorite(
                    previousProviderId,
                    previousVoiceId,
                    {
                        voiceId: form.elements.voiceId.value,
                        name: form.elements.voiceName.value,
                        model: form.elements.voiceModel.value,
                    },
                );
                const assignedRoutes = TTS_ProviderRegistry.getSnapshot().characterRoutes || {};
                Object.entries(assignedRoutes).forEach(([characterName, route]) => {
                    if (route.providerId !== previousProviderId || route.voice !== previousVoiceId) return;
                    TTS_ProviderRegistry.setCharacterRoute(characterName, {
                        ...route,
                        providerId: favorite.providerId,
                        voice: favorite.voiceId,
                        model: favorite.model || route.model,
                    });
                });
                if (form.elements.characterName.value) {
                    applyVoiceFavoriteToCharacter({
                        providerId: favorite.providerId,
                        voiceId: favorite.voiceId,
                        model: favorite.model,
                        characterName: form.elements.characterName.value,
                    });
                }
                state.favoriteManageKey = `${favorite.providerId}::${favorite.voiceId}`;
                updateView();
                announce(`已保存 ${favorite.name}`);
            } catch (error) {
                announce(error.message || '复刻音色编辑失败');
            }
            return;
        }
        if (event.target.hasAttribute('data-custom-voice-favorite-form')) {
            event.preventDefault();
            const form = event.target;
            try {
                const favorite = FrontendVoiceTools.saveVoiceFavorite({
                    providerId: form.elements.providerId.value,
                    voiceId: form.elements.voiceId.value,
                    name: form.elements.voiceName.value,
                    model: form.elements.voiceModel.value,
                    category: 'cloning',
                });
                if (form.elements.characterName.value) {
                    applyVoiceFavoriteToCharacter({
                        providerId: favorite.providerId,
                        voiceId: favorite.voiceId,
                        model: favorite.model,
                        characterName: form.elements.characterName.value,
                    });
                }
                updateView();
                announce(`已收藏复刻音色 ${favorite.name}`);
            } catch (error) {
                announce(error.message || '收藏复刻音色失败');
            }
            return;
        }
        if (event.target.hasAttribute('data-planner-settings-form')) {
            event.preventDefault();
            savePlannerForm(event.target);
            updateView();
            announce('前端编排设置已保存');
            return;
        }
        if (event.target.hasAttribute('data-phone-plan-form')) {
            event.preventDefault();
            if (state.featureBusy) return;
            const source = event.target.elements.source.value;
            const brief = source === 'topic' ? event.target.elements.brief.value.trim() : '';
            if (source === 'topic' && !brief) {
                announce('请填写通话主题');
                return;
            }
            const participants = [...event.target.querySelectorAll('input[name="participants"]:checked')]
                .map(input => String(input.value)).filter(Boolean);
            if (!participants.length) {
                announce('请至少选择一个参与角色');
                return;
            }
            state.phoneContentSource = source;
            await runPhonePlan({
                caller: participants[0],
                brief,
                duration: event.target.elements.duration ? event.target.elements.duration.value : 'medium',
                direction: 'outgoing',
                participants,
            });
            return;
        }
        if (event.target.hasAttribute('data-conversation-track-form')) {
            event.preventDefault();
            // 旧版对话追踪表单保留以兼容可能的浏览器恢复，但不再做任何后端调用。
            announce('通话记录请到“追踪”APP 查看。');
            return;
        }
        if (event.target.hasAttribute('data-runtime-settings-form')) {
            event.preventDefault();
            const form = event.target;
            const playback = TTS_ProviderRegistry.updatePlaybackSettings({
                enabled: form.elements.enabled.checked,
                autoGenerate: form.elements.autoGenerate.checked,
            });
            TTS_ProviderRegistry.updateUiSettings({
                bodyAutoRender: form.elements.bodyAutoRender.checked,
            });
            TTS_ProviderRegistry.updateTagSettings({
                preset: form.elements.tagPreset.value,
                template: form.elements.tagTemplate.value,
            });
            FrontendVoiceTools.updatePlannerSettings({
                bodyPromptEnabled: form.elements.bodyPromptEnabled.checked,
            });
            window.TTS_Parser?.scan?.();
            announce('正文 TTS 设置已保存');
            return;
        }
        if (event.target.hasAttribute('data-display-settings-form')) {
            event.preventDefault();
            const form = event.target;
            const planner = FrontendVoiceTools.updatePlannerSettings({
                outputLanguage: form.elements.outputLanguage.value,
                customLanguage: form.elements.customLanguage.value,
            });
            syncPlannerOutputLanguage(planner.outputLanguage);
            applyTheme(form.elements.theme.value);
            TTS_ProviderRegistry.updateUiSettings({ triggerDock: form.elements.triggerDock.value });
            state.triggerDock = form.elements.triggerDock.value;
            updateView();
            announce('显示与语言设置已保存');
            return;
        }
        if (event.target.hasAttribute('data-custom-theme-form')) {
            event.preventDefault();
            const form = event.target;
            TTS_ProviderRegistry.updateUiSettings({
                customTheme: {
                    bg: form.elements.bg.value,
                    surface: form.elements.surface.value,
                    accent: form.elements.accent.value,
                    glow: form.elements.glow.value,
                    wallpaper: form.elements.wallpaper.value.trim(),
                },
            });
            applyTheme('custom', false);
            updateView();
            announce('自定义主题已保存');
            return;
        }
        if (event.target.hasAttribute('data-drawing-form')) {
            event.preventDefault();
            if (state.featureBusy) return;
            const form = event.target;
            const sizeMap = {
                portrait: [832, 1216],
                landscape: [1216, 832],
                square: [1024, 1024],
            };
            const [width, height] = sizeMap[form.elements.size.value] || sizeMap.portrait;
            const steps = Math.max(1, Math.min(28, Number(form.elements.steps.value) || 28));
            const prefix = form.elements.prefix.value.trim();
            const dynamic = form.elements.dynamic.value.trim();
            const suffix = form.elements.suffix.value.trim();
            const prompt = [prefix, dynamic, suffix].filter(Boolean).join(', ');
            if (!prompt) {
                announce('请先填写正面提示词');
                return;
            }
            state.drawingDynamic = dynamic;
            TTS_ProviderRegistry.updateDrawingSettings({
                params: {
                    model: form.elements.model.value,
                    size: form.elements.size.value,
                    sampler: form.elements.sampler.value,
                    scheduler: form.elements.scheduler.value,
                    steps,
                    guidance: Number(form.elements.guidance.value) || 5,
                    rescale: Number(form.elements.rescale.value) || 0,
                    decrisper: Number(form.elements.decrisper.value) || 0,
                    seed: Number(form.elements.seed.value) || -1,
                },
            });
            state.featureBusy = 'novelai-draw';
            updateView();
            try {
                const response = await fetch('/api/novelai/generate', {
                    method: 'POST',
                    headers: { ...getRequestHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        input: prompt,
                        model: form.elements.model.value,
                        parameters: {
                            width,
                            height,
                            scale: Number(form.elements.guidance.value) || 5,
                            sampler: form.elements.sampler.value,
                            scheduler: form.elements.scheduler.value,
                            steps,
                            seed: Number(form.elements.seed.value) || -1,
                            uncond_scale: Number(form.elements.rescale.value) || 0,
                            cfg_rescale: Number(form.elements.rescale.value) || 0,
                            decrisper: Number(form.elements.decrisper.value) || 0,
                            negative_prompt: form.elements.negative.value.trim(),
                        },
                    }),
                });
                if (!response.ok) throw new Error(`NovelAI 返回 ${response.status}`);
                const blob = await response.blob();
                const key = `img-${Date.now().toString(36)}`;
                await TTS_ImageCache.put(key, blob, { description: dynamic });
                if (state.drawingLastImage?.startsWith('blob:')) URL.revokeObjectURL(state.drawingLastImage);
                state.drawingLastImage = URL.createObjectURL(blob);
                await loadDrawingGallery();
                announce('图片已生成并存入 IndexedDB');
            } catch (error) {
                announce(error.message || '绘制失败');
            } finally {
                state.featureBusy = null;
                updateView();
            }
            return;
        }
        if (event.target.hasAttribute('data-add-character-route-form')) {
            event.preventDefault();
            const characterName = event.target.elements.characterName.value.trim();
            if (!characterName) {
                announce('请输入角色名称');
                return;
            }
            TTS_ProviderRegistry.addCharacter(characterName);
            state.routeCharacter = characterName;
            updateView();
            announce(`已添加角色 ${characterName}`);
            return;
        }
        const quickCharacterName = event.target.dataset.quickCharacterRoute;
        if (quickCharacterName) {
            event.preventDefault();
            const form = event.target;
            const providerId = form.elements.providerId.value;
            const resource = form.elements.resource.value.trim();
            const currentRoute = TTS_ProviderRegistry.resolveRoute(quickCharacterName);
            if (providerId === 'gpt_sovits') {
                if (!resource) return announce('GPT-SoVITS 快速编辑需要填写模型文件夹');
                try {
                    await window.TTS_API.bindCharacter(quickCharacterName, resource);
                    window.TTS_State.CACHE.mappings[quickCharacterName] = resource;
                } catch (error) {
                    return announce(error.message || 'GPT-SoVITS 角色绑定失败');
                }
            }
            const providerSettings = TTS_ProviderRegistry.getSettings(providerId);
            const isSameProvider = currentRoute.providerId === providerId;
            TTS_ProviderRegistry.setCharacterRoute(quickCharacterName, {
                ...currentRoute,
                providerId,
                model: ['minimax', 'elevenlabs'].includes(providerId)
                    ? (isSameProvider ? currentRoute.model : '') || providerSettings.model || ''
                    : '',
                voice: providerId === 'gpt_sovits'
                    ? ''
                    : resource || (isSameProvider ? currentRoute.voice : '') || providerSettings.voice || '',
                referenceAudio: ['indextts2', 'voxcpm2'].includes(providerId) ? currentRoute.referenceAudio : '',
                promptText: ['indextts2', 'voxcpm2'].includes(providerId) ? currentRoute.promptText : '',
            });
            announce(`${quickCharacterName} 的快速路由已保存`);
            return;
        }
        const characterName = event.target.dataset.characterRouteForm;
        if (characterName) {
            event.preventDefault();
            const form = event.target;
            const selectedProviderId = form.elements.providerId.value;
            if (selectedProviderId === 'gpt_sovits') {
                const modelName = form.elements.legacyModel?.value;
                if (!modelName) {
                    announce('请先选择 GPT-SoVITS 模型文件夹');
                    return;
                }
                try {
                    await window.TTS_API.bindCharacter(characterName, modelName);
                    window.TTS_State.CACHE.mappings[characterName] = modelName;
                } catch (error) {
                    announce(error.message || 'GPT-SoVITS 角色模型绑定失败');
                    return;
                }
            }
            const miniMaxModel = form.elements.minimaxModel?.value || '';
            const miniMaxVoice = form.elements.minimaxVoice?.value.trim() || '';
            if (selectedProviderId === 'minimax' && (!miniMaxModel || !miniMaxVoice)) {
                announce('请从已同步目录选择 MiniMax 模型和角色音色');
                return;
            }
            const elevenLabsModel = form.elements.elevenLabsModel?.value || '';
            const elevenLabsVoice = form.elements.elevenLabsVoice?.value.trim() || '';
            if (selectedProviderId === 'elevenlabs' && (!elevenLabsModel || !elevenLabsVoice)) {
                announce('请先同步并选择 ElevenLabs 模型和角色音色');
                return;
            }
            const usesReferenceAudio = ['indextts2', 'voxcpm2'].includes(selectedProviderId);
            TTS_ProviderRegistry.setCharacterRoute(characterName, {
                providerId: selectedProviderId,
                model: selectedProviderId === 'minimax'
                    ? miniMaxModel
                    : selectedProviderId === 'elevenlabs' ? elevenLabsModel : '',
                voice: selectedProviderId === 'minimax'
                    ? miniMaxVoice
                    : selectedProviderId === 'elevenlabs' ? elevenLabsVoice : form.elements.voice.value,
                referenceAudio: usesReferenceAudio ? form.elements.referenceAudio.value : '',
                promptText: usesReferenceAudio ? form.elements.promptText.value : '',
            });
            announce(`${characterName} 的语音路由已保存`);
            return;
        }
        const providerId = event.target.dataset.providerForm;
        if (!providerId) return;
        event.preventDefault();
        const settings = commitProviderForm(providerId);
        if (providerId === 'gpt_sovits') {
            try {
                await syncGptServiceSettings(settings);
            } catch (error) {
                announce(`${error.message}；地址已保存在插件中`);
                return;
            }
        }
        announce('引擎配置已保存');
    });

    eventRoot.addEventListener('input', event => {
        const outputId = event.target.dataset.rangeOutput;
        if (outputId) document.getElementById(outputId).value = event.target.value;
        const phoneChatForm = event.target.closest('[data-phone-chat-form]');
        if (phoneChatForm) syncPhoneChatSubmitButton(phoneChatForm);
        if (event.target.id === 'tts-minimax-voice-search') filterMiniMaxVoices();
        if (event.target.id === 'tts-elevenlabs-voice-search') filterElevenLabsVoices();
        if (event.target.id === 'tts-favorite-search') filterFavoriteVoices();
        if (event.target.id === 'tts-contact-search') filterVoiceContacts();
        if (event.target.id === 'tts-phone-brief') state.phoneBrief = event.target.value;
        if (event.target.id === 'tts-dial-input') state.dialInput = event.target.value;
        if (event.target.id === 'tts-conversation-focus') state.conversationFocus = event.target.value;
        if (event.target.id === 'tts-quick-route-search') {
            const query = event.target.value.trim().toLocaleLowerCase('zh-CN');
            document.querySelectorAll('[data-quick-character-route]').forEach(form => {
                form.hidden = Boolean(query && !form.dataset.quickRouteSearch.includes(query));
            });
        }
    });

    eventRoot.addEventListener('change', async event => {
        if (event.target.matches('input[data-prompt-workflow-depth]')) {
            const depth = Number(event.target.value);
            FrontendVoiceTools.updatePromptWorkflowDepth(state.promptWorkflow, Number.isFinite(depth) ? depth : 0);
            announce('整体插入深度已保存');
            return;
        }
        if (event.target.id === 'tts-voice-backup-file') {
            const file = event.target.files?.[0];
            if (!file || !window.confirm(`确定从“${file.name}”恢复吗？当前状态会临时保留以便撤销。`)) return;
            try {
                restoreVoiceBackupBundle(await file.text());
                updateView();
                announce('完整备份已恢复');
            } catch (error) {
                announce(error.message || '备份恢复失败');
            }
            return;
        }
        if (event.target.id === 'tts-prompt-import-file') {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
                FrontendVoiceTools.importPromptPresetData(await file.text(), state.promptWorkflow);
                updateView();
                announce('提示词预设已导入');
            } catch (error) {
                announce(error.message || '提示词预设导入失败');
            }
            return;
        }
        if (event.target.id === 'tts-planner-mode') {
            document.querySelector('[data-planner-custom]')?.toggleAttribute(
                'hidden',
                event.target.value !== 'custom',
            );
            return;
        }
        if (event.target.id === 'tts-phone-source') {
            state.phoneContentSource = event.target.value;
            updateView();
            return;
        }
        if (event.target.id === 'tts-phone-caller') {
            state.phoneCaller = event.target.value;
            return;
        }
        if (event.target.id === 'tts-phone-duration') {
            state.phoneLength = event.target.value;
            return;
        }
        if (event.target.id === 'tts-planner-output-language') {
            const customField = document.querySelector('[data-planner-custom-language]');
            const customInput = document.getElementById('tts-planner-custom-language');
            const customSelected = event.target.value === 'custom';
            customField?.toggleAttribute('hidden', !customSelected);
            if (customInput) customInput.required = customSelected;
            return;
        }
        if (event.target.id === 'tts-phone-duration') state.phoneLength = event.target.value;
        if (event.target.id === 'tts-phone-caller') state.phoneCaller = event.target.value;
        if (event.target.id === 'tts-custom-favorite-provider') {
            const modelInput = document.getElementById('tts-custom-favorite-model');
            if (modelInput) {
                modelInput.value = event.target.value === 'elevenlabs'
                    ? modelInput.dataset.elevenlabsModel || ''
                    : modelInput.dataset.minimaxModel || '';
            }
            return;
        }
        if (event.target.name === 'speakers' && event.target.closest('[data-conversation-track-form]')) {
            state.conversationSpeakers = [...event.target.closest('form').querySelectorAll('input[name="speakers"]:checked')].map(input => input.value);
            const countNode = document.getElementById('tts-speaker-selection-count');
            if (countNode) countNode.textContent = `${state.conversationSpeakers.length}/${countNode.dataset.total || 0} · 至少两人`;
        }
        if (event.target.id === 'tts-route-provider') {
            const selectedProviderId = event.target.value;
            document.querySelectorAll('[data-route-provider-only]').forEach(element => {
                element.hidden = element.dataset.routeProviderOnly !== selectedProviderId;
            });
            document.querySelector('[data-route-generic-voice]')?.toggleAttribute(
                'hidden',
                ['gpt_sovits', 'minimax', 'elevenlabs'].includes(selectedProviderId),
            );
            document.querySelector('[data-route-reference-fields]')?.toggleAttribute(
                'hidden',
                !['indextts2', 'voxcpm2'].includes(selectedProviderId),
            );
            return;
        }
        if (event.target.id === 'tts-tag-preset') {
            const selected = event.target.selectedOptions[0];
            const templateInput = document.getElementById('tts-tag-template');
            if (event.target.value !== 'custom' && selected?.dataset.tagTemplate) {
                templateInput.value = selected.dataset.tagTemplate;
                templateInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            templateInput.readOnly = event.target.value !== 'custom' && !event.target.value.startsWith('tag-');
            const customPreset = event.target.value.startsWith('tag-');
            const deleteButton = document.querySelector('[data-delete-tag-preset]');
            if (deleteButton) deleteButton.disabled = !customPreset;
            const presetName = document.getElementById('tts-tag-preset-name');
            if (presetName) presetName.value = customPreset ? selected?.textContent?.trim() || '' : '';
        }
    });

    eventRoot.addEventListener('input', event => {
        if (event.target.id !== 'tts-tag-template') return;
        const example = document.querySelector('#tts-tag-format-example code');
        if (example) {
            example.textContent = event.target.value
                .replace('{角色}', '林晚')
                .replace('{情绪}', '开心')
                .replace('{文本}', '今天见到你真好。');
        }
    });

    eventRoot.addEventListener('keydown', event => {
        if (event.key === 'Escape' && state.open) TTS_Mobile.close();
    });
}

function updateClockDisplay() {
    const now = new Date();
    const timeText = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    const clock = document.getElementById('tts-mobile-clock');
    if (clock) clock.textContent = timeText;
    document.querySelectorAll('[data-home-clock]').forEach(element => { element.textContent = timeText; });
    const date = document.getElementById('tts-home-date');
    if (date) date.textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(now);
}

function startClock() {
    updateClockDisplay();
    if (!state.clockTimer) state.clockTimer = window.setInterval(updateClockDisplay, 30000);
}

function updateSystemNetworkStatus() {
    const label = document.getElementById('tts-network-label');
    const iconNode = document.getElementById('tts-network-icon');
    if (!label || !iconNode) return;
    const runtimeNavigator = globalThis.navigator || {};
    const connection = runtimeNavigator.connection || runtimeNavigator.mozConnection || runtimeNavigator.webkitConnection;
    const online = runtimeNavigator.onLine !== false;
    const type = String(connection?.type || '').toLowerCase();
    const effectiveType = String(connection?.effectiveType || '').toUpperCase();
    const text = !online
        ? '离线'
        : type === 'wifi'
            ? 'Wi-Fi'
            : ['cellular', 'wimax'].includes(type)
                ? (effectiveType || '移动网络')
                : (effectiveType || '在线');
    label.textContent = text;
    iconNode.classList.toggle('is-offline', !online);
    iconNode.setAttribute('aria-label', text);
}

function updateSystemBatteryStatus() {
    const root = document.getElementById('tts-system-battery');
    const levelNode = document.getElementById('tts-battery-level');
    if (!root || !levelNode || !state.batteryManager) return;
    const level = Math.max(0, Math.min(1, Number(state.batteryManager.level) || 0));
    const percentage = Math.round(level * 100);
    root.style.setProperty('--battery-level', String(level));
    root.classList.toggle('is-charging', Boolean(state.batteryManager.charging));
    root.classList.toggle('is-low', percentage <= 20 && !state.batteryManager.charging);
    root.setAttribute('aria-label', `${state.batteryManager.charging ? '正在充电，' : ''}电量 ${percentage}%`);
    levelNode.textContent = `${percentage}%`;
}

function startSystemStatus() {
    const runtimeNavigator = globalThis.navigator || {};
    updateSystemNetworkStatus();
    if (!state.systemStatusBound) {
        const connection = runtimeNavigator.connection || runtimeNavigator.mozConnection || runtimeNavigator.webkitConnection;
        window.addEventListener('online', updateSystemNetworkStatus, { passive: true });
        window.addEventListener('offline', updateSystemNetworkStatus, { passive: true });
        connection?.addEventListener?.('change', updateSystemNetworkStatus);
        state.systemStatusBound = true;
    }
    if (state.batteryManager) {
        updateSystemBatteryStatus();
        return;
    }
    runtimeNavigator.getBattery?.().then(battery => {
        state.batteryManager = battery;
        battery.addEventListener?.('levelchange', updateSystemBatteryStatus);
        battery.addEventListener?.('chargingchange', updateSystemBatteryStatus);
        updateSystemBatteryStatus();
    }).catch(() => {});
}

export const TTS_Mobile = {
    init() {
        if (state.initialized
            && document.getElementById('tts-mobile-root')
            && document.getElementById('tts-mobile-trigger')) return;
        state.initialized = true;
        console.info('[TTS Console] 正在挂载手机工作台');
        TTS_ProviderRegistry.syncPlaybackState();
        FrontendVoiceTools.init();
        if (!savedUiSettings.theme) TTS_ProviderRegistry.updateUiSettings({ theme: state.theme });
        buildShell();
        startClock();
        startSystemStatus();
        loadDrawingGallery();
        state.unsubscribe?.();
        state.unsubscribe = TTS_ProviderRegistry.subscribe(detail => {
            syncProviderNotification(detail);
            if (detail?.type === 'tags') FrontendVoiceTools.applyBodyPromptInjection();
            updateView();
        });
        state.toolsUnsubscribe?.();
        state.toolsUnsubscribe = FrontendVoiceTools.subscribe(detail => {
            syncFrontendToolNotification(detail);
            if (state.route === 'provider' && detail.type === 'voice-favorite') {
                const button = [...document.querySelectorAll('[data-toggle-voice-favorite]')]
                    .find(item => item.dataset.providerId === detail.providerId && item.dataset.voiceId === detail.voiceId);
                if (button) {
                    button.classList.toggle('is-favorite', detail.active);
                    button.setAttribute('aria-pressed', String(detail.active));
                    button.setAttribute('aria-label', `${detail.active ? '取消收藏' : '收藏'} ${button.dataset.voiceName}`);
                }
                return;
            }
            if (detail?.type === 'phone-chat-message' && state.route === 'chat') {
                const thread = document.querySelector('.voice-chat-thread');
                state.chatScrollToBottom = !thread || thread.scrollHeight - thread.scrollTop - thread.clientHeight < 96;
            }
            updateView();
        });
        state.schedulerUnsubscribe?.();
        state.schedulerUnsubscribe = window.TTS_Scheduler?.subscribe?.(detail => {
            syncTaskNotifications(detail);
            if (['home', 'tasks', 'notifications'].includes(state.route)) updateView();
        }) || null;
        if (!state.mountObserver) {
            state.mountObserver = new MutationObserver(() => {
                if (!document.getElementById('tts-mobile-root') || !document.getElementById('tts-mobile-trigger')) {
                    buildShell();
                    startClock();
                    startSystemStatus();
                }
            });
            // SillyTavern 启动时可能整体替换 documentElement；监听 Document 才能跨过这次重建。
            state.mountObserver.observe(document, { childList: true, subtree: true });
        }
        if (!state.resizeBound) {
            window.addEventListener('resize', applyTriggerPosition, { passive: true });
            state.resizeBound = true;
        }
        console.info('[TTS Console] 手机工作台已就绪');
    },
    open() {
        state.open = true;
        window.clearTimeout(state.triggerShelfTimer);
        document.getElementById('tts-mobile-root')?.classList.remove('minimized');
        document.getElementById('tts-mobile-trigger')?.classList.add('is-hidden');
        syncPhoneMotion();
    },
    close() {
        state.open = false;
        document.getElementById('tts-mobile-root')?.classList.add('minimized');
        document.getElementById('tts-mobile-trigger')?.classList.remove('is-hidden');
        syncPhoneMotion();
        scheduleTriggerShelf(1200);
    },
    toggle() {
        state.open ? this.close() : this.open();
    },
    openApp(appName) {
        const routes = {
            incoming_call: 'incoming',
            phone_call: 'incoming',
            favorites: 'favorites',
            tracks: 'tracks',
            eavesdrop: 'tracks',
            settings: 'settings',
        };
        state.route = routes[appName] || appName;
        this.open();
        updateView();
    },
    openProvider(providerId) {
        state.providerId = providerId;
        state.route = 'provider';
        this.open();
        updateView();
    },
    openCharacter(characterName) {
        state.routeCharacter = String(characterName || '').trim() || null;
        state.providerId = null;
        state.route = 'library';
        this.open();
        updateView();
    },
};

window.TTS_Mobile = TTS_Mobile;
