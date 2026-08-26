import { CALL_STATES, MESSAGE_KINDS, SCREENS, THEMES } from '../core/constants.js';
import {
    DEFAULT_PHONE_PROMPT_PRESET,
    addPhonePromptEntry,
    movePhonePromptEntry,
    normalizePhonePromptPreset,
    removePhonePromptEntry,
    updatePhonePromptEntry,
} from '../dialogue/prompt-preset.js';
import { DEFAULT_BODY_PROMPT_PRESET } from '../dialogue/body-speech.js';
import { clamp, escapeHtml, formatClock, icon, initials } from './dom.js';
import { auxiliaryScreensMarkup, dockMarkup, homeScreenMarkup } from './phone-home.js';
import { getOrbDockTarget, isOrbTap, shouldStartOrbDrag, updateOrbDrag } from './orb-gesture.js';
import { promptEntryMarkup, systemSettingsScreensMarkup } from './system-settings.js';

const ACTIVE_CALL_STATES = new Set([
    CALL_STATES.DIALING,
    CALL_STATES.RINGING,
    CALL_STATES.CONNECTED,
    CALL_STATES.GENERATING,
    CALL_STATES.SPEAKING,
]);

const SCREEN_COPY = Object.freeze({
    [SCREENS.HOME]: { title: 'Phonie', eyebrow: 'Resonance OS' },
    [SCREENS.CHAT]: { title: '', eyebrow: '私人频道' },
    [SCREENS.CALL]: { title: '电话', eyebrow: '实时声线' },
    [SCREENS.VOICE]: { title: '声线', eyebrow: '语音资料库' },
    [SCREENS.TRACE]: { title: '轨迹', eyebrow: '通话记录' },
    [SCREENS.CHARACTER]: { title: '角色', eyebrow: '声线路由' },
    [SCREENS.MODEL]: { title: '模型', eyebrow: '生成连接' },
    [SCREENS.PROMPTS]: { title: '提示词', eyebrow: '消息编排' },
    [SCREENS.SETTINGS]: { title: '设置', eyebrow: '手机与编排' },
});

function setBackgroundImage(element, url) {
    if (!(element instanceof HTMLElement)) return;
    if (!url) {
        element.style.removeProperty('background-image');
        element.dataset.hasImage = 'false';
        return;
    }
    element.style.backgroundImage = `url(${JSON.stringify(String(url))})`;
    element.dataset.hasImage = 'true';
}

function formatRecordDate(timestamp) {
    if (!timestamp) return '时间未知';
    return new Intl.DateTimeFormat('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(timestamp));
}

function formatDuration(startedAt, endedAt) {
    if (!startedAt || !endedAt) return '--:--';
    const total = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
    const minutes = Math.floor(total / 60).toString().padStart(2, '0');
    const seconds = (total % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function messageTime(timestamp) {
    return formatClock(timestamp);
}

function callStatusLabel(state, elapsed = '', direction = '') {
    const labels = {
        [CALL_STATES.IDLE]: '等待拨号',
        [CALL_STATES.DIALING]: '正在拨号',
        [CALL_STATES.RINGING]: direction === 'incoming' ? '角色来电' : '等待接听',
        [CALL_STATES.CONNECTED]: elapsed ? `通话中  ${elapsed}` : '通话中',
        [CALL_STATES.GENERATING]: '正在组织语言',
        [CALL_STATES.SPEAKING]: '对方正在说话',
        [CALL_STATES.ENDED]: '通话已结束',
        [CALL_STATES.ERROR]: '通话连接异常',
    };
    return labels[state] || labels[CALL_STATES.IDLE];
}

function makeWaveBars(seed = '') {
    const text = String(seed || 'phonie');
    return Array.from({ length: 18 }, (_, index) => {
        const code = text.charCodeAt(index % text.length) || 80;
        const height = 26 + ((code * (index + 3)) % 68);
        return `<i style="--bar-height:${height}%"></i>`;
    }).join('');
}

function renderMessage(message, showTranslation) {
    const outgoing = message.direction === 'outgoing';
    const translation = showTranslation && message.translationText
        ? `<p class="phonie-message__translation" lang="zh-CN">${escapeHtml(message.translationText)}</p>`
        : '';
    const voice = message.kind === MESSAGE_KINDS.VOICE
        ? `
            <div class="phonie-message__voice">
                <button class="phonie-voice-action" type="button" data-action="play-phone-audio" data-message-id="${escapeHtml(message.id)}" aria-label="播放这条语音消息">
                    ${icon(message.isPlaying ? 'pause' : 'play')}
                </button>
                <span class="phonie-message__waveform" aria-hidden="true">${makeWaveBars(message.id)}</span>
                <span class="phonie-message__duration">${escapeHtml(message.durationLabel || '--:--')}</span>
            </div>`
        : '';

    return `
        <article class="phonie-message ${outgoing ? 'phonie-message--outgoing' : ''}" data-phone-message-id="${escapeHtml(message.id)}">
            <div class="phonie-message__meta">
                <span>${escapeHtml(message.author)}</span>
                <time datetime="${new Date(message.createdAt).toISOString()}">${messageTime(message.createdAt)}</time>
            </div>
            <div class="phonie-message__bubble">
                ${voice}
                <p class="phonie-message__source" lang="${escapeHtml(message.language || '')}">${escapeHtml(message.originalText)}</p>
                ${translation}
            </div>
        </article>`;
}

function providerFieldMarkup(field, provider) {
    const value = provider.settings?.[field.key];
    if (field.when && provider.settings?.[field.when[0]] !== field.when[1]) return '';
    const label = `<span><strong>${escapeHtml(field.label)}</strong>${field.help ? `<small>${escapeHtml(field.help)}</small>` : ''}</span>`;
    if (field.type === 'secret') {
        return `<label class="phonie-provider-field phonie-provider-field--secret">${label}<span><input type="password" autocomplete="new-password" data-role="tts-secret-input" data-provider-id="${escapeHtml(provider.id)}" data-secret-key="${escapeHtml(field.key)}" placeholder="保存后不回显"><button type="button" data-action="save-tts-secret" data-provider-id="${escapeHtml(provider.id)}" data-secret-key="${escapeHtml(field.key)}">保存</button></span></label>`;
    }
    if (field.type === 'switch') {
        return `<label class="phonie-provider-field">${label}<span class="phonie-switch"><input type="checkbox" data-provider-field="${escapeHtml(field.key)}"${value ? ' checked' : ''}><span class="phonie-switch__track" aria-hidden="true"></span></span></label>`;
    }
    const resources = field.type === 'resource' ? (provider.catalog?.[field.resource] || []) : [];
    const options = field.type === 'select' ? (field.options || []) : resources.map((item) => [item.id, item.name || item.id]);
    if (field.type === 'select' || field.type === 'resource') {
        const choices = value && !options.some(([id]) => String(id) === String(value)) ? [[value, value], ...options] : options;
        return `<label class="phonie-provider-field">${label}<select data-provider-field="${escapeHtml(field.key)}">${choices.length ? choices.map(([id, name]) => `<option value="${escapeHtml(id)}"${String(id) === String(value) ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('') : '<option value="">请先同步资源</option>'}</select></label>`;
    }
    const inputType = field.type === 'range' ? 'range' : field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text';
    const constraints = field.type === 'range' ? ` min="${field.min}" max="${field.max}" step="${field.step}"` : '';
    return `<label class="phonie-provider-field">${label}<span class="phonie-provider-field__input"><input type="${inputType}" value="${escapeHtml(value ?? '')}" data-provider-field="${escapeHtml(field.key)}"${constraints}>${field.type === 'range' ? `<b>${escapeHtml(value)}</b>` : ''}</span></label>`;
}

export class PhoneView {
    #store;
    #actions;
    #root = null;
    #launcher = null;
    #wandLauncher = null;
    #unsubscribe = null;
    #clockTimer = null;
    #toastTimer = null;
    #drag = null;
    #suppressOrbClick = false;
    #orbMoveHandler = null;
    #orbEndHandler = null;

    constructor({ store, actions }) {
        this.#store = store;
        this.#actions = actions;
    }

    mount() {
        if (document.getElementById('phonie-root')) return;

        const root = document.createElement('div');
        root.id = 'phonie-root';
        root.className = 'phonie-root';
        root.dataset.open = 'false';
        root.innerHTML = `
            <div class="phonie-scrim" data-action="close" aria-hidden="true"></div>
            <button class="phonie-orb" type="button" data-action="open" aria-label="打开 Phonie" aria-controls="phonie-phone">
                ${icon('wave')}
                <span class="phonie-orb__seam" aria-hidden="true"></span>
                <span class="phonie-orb__unread" data-role="unread" hidden></span>
            </button>
            <section class="phonie-phone" id="phonie-phone" aria-label="Phonie 声纹手机" aria-hidden="true">
                <span class="phonie-hardware-key phonie-hardware-key--volume" aria-hidden="true"></span>
                <span class="phonie-hardware-key phonie-hardware-key--power" aria-hidden="true"></span>
                <div class="phonie-frame">
                    <div class="phonie-wallpaper" data-role="wallpaper" aria-hidden="true"></div>
                    <div class="phonie-wallpaper-veil" aria-hidden="true"></div>
                    <div class="phonie-rain-curtain" aria-hidden="true">
                        <i style="--rain-index:0;--rain-x:5%;--rain-delay:-0.1s"></i><i style="--rain-index:1;--rain-x:14%;--rain-delay:-1.7s"></i><i style="--rain-index:2;--rain-x:23%;--rain-delay:-3.1s"></i><i style="--rain-index:3;--rain-x:32%;--rain-delay:-0.9s"></i><i style="--rain-index:4;--rain-x:41%;--rain-delay:-4.2s"></i><i style="--rain-index:5;--rain-x:50%;--rain-delay:-2.4s"></i><i style="--rain-index:6;--rain-x:59%;--rain-delay:-0.5s"></i><i style="--rain-index:7;--rain-x:68%;--rain-delay:-3.6s"></i><i style="--rain-index:8;--rain-x:77%;--rain-delay:-1.2s"></i><i style="--rain-index:9;--rain-x:86%;--rain-delay:-4.6s"></i><i style="--rain-index:10;--rain-x:93%;--rain-delay:-2.8s"></i><i style="--rain-index:11;--rain-x:97%;--rain-delay:-0.3s"></i>
                    </div>
                    <span class="phonie-voice-seam" aria-hidden="true"></span>
                    <header class="phonie-status">
                        <time class="phonie-status__time" data-role="clock"></time>
                        <span class="phonie-dynamic-island" aria-hidden="true"><i></i><b></b></span>
                        <span class="phonie-status__signals" aria-label="网络与电量">
                            <span data-role="network-label">在线</span><span data-role="network-icon">${icon('wifi')}</span>
                            <span data-role="battery-label">--%</span><span class="phonie-status__battery-icon">${icon('battery')}<i data-role="charging-icon" hidden>${icon('bolt')}</i></span>
                        </span>
                    </header>
                    <div class="phonie-header">
                        <div>
                            <p class="phonie-header__eyebrow" data-role="eyebrow">Private channel</p>
                            <h1 class="phonie-header__title" data-role="title">Phonie</h1>
                        </div>
                        <div class="phonie-header__actions">
                            <button class="phonie-icon-button phonie-icon-button--raised phonie-back-button" type="button" data-action="navigate" data-target-screen="home" aria-label="返回桌面">
                                ${icon('back')}
                            </button>
                            <button class="phonie-icon-button phonie-icon-button--raised phonie-theme-button" type="button" data-action="cycle-theme" aria-label="切换当前主题">
                                ${icon('stars')}
                            </button>
                            <button class="phonie-icon-button" type="button" data-action="close" aria-label="收起 Phonie">
                                ${icon('close')}
                            </button>
                        </div>
                    </div>
                    <main class="phonie-screen-stack">
                        ${homeScreenMarkup()}
                        <section class="phonie-screen" data-screen="chat" aria-label="私人消息">
                            <div class="phonie-chat-list" data-role="message-list"></div>
                            <div class="phonie-generating" data-role="generating" hidden>
                                <span class="phonie-generating__line" aria-hidden="true"></span>
                                <span>对方正在组织语言</span>
                            </div>
                            <form class="phonie-composer" data-form="chat">
                                <button class="phonie-icon-button phonie-icon-button--raised" type="button" data-action="send-voice" aria-label="发送语音消息">
                                    ${icon('wave')}
                                </button>
                                <textarea rows="1" maxlength="1600" data-role="chat-input" placeholder="写一条私人消息" aria-label="私人消息内容"></textarea>
                                <button class="phonie-icon-button phonie-icon-button--raised" type="submit" aria-label="发送消息">
                                    ${icon('send')}
                                </button>
                            </form>
                        </section>
                        <section class="phonie-screen" data-screen="call" aria-label="电话">
                            <div class="phonie-call-screen">
                                <div class="phonie-contact-mark" data-role="call-mark"><span data-role="call-initials">P</span></div>
                                <div class="phonie-call-identity">
                                    <h2 data-role="call-contact">Character</h2>
                                    <p class="phonie-call-status" data-role="call-status">等待拨号</p>
                                </div>
                                <div class="phonie-call-captions" data-role="call-captions" data-empty="true">
                                    <span data-role="call-empty">接通后，原文和译文会显示在这里</span>
                                    <div data-role="call-caption-content" hidden>
                                        <p class="phonie-call-caption-source" data-role="call-caption-source"></p>
                                        <p class="phonie-call-caption-translation" data-role="call-caption-translation"></p>
                                    </div>
                                </div>
                                <div class="phonie-call-idle-action" data-role="call-idle-action">
                                    <button class="phonie-button" type="button" data-action="start-call">${icon('phone')}<span>拨打电话</span></button>
                                    <button class="phonie-button phonie-button--secondary" type="button" data-action="start-incoming-call">${icon('signal')}<span>接收角色来电</span></button>
                                </div>
                                <div class="phonie-call-incoming-actions" data-role="call-incoming-actions" hidden>
                                    <button type="button" data-action="decline-call" aria-label="拒接">${icon('end-call')}<span>拒接</span></button>
                                    <button type="button" data-action="accept-call" aria-label="接听">${icon('accept-call')}<span>接听</span></button>
                                </div>
                                <div class="phonie-call-feature-controls" data-role="call-feature-controls" hidden>
                                    <button type="button" data-action="toggle-call-control" data-call-control="muted">${icon('microphone')}<span>静音</span></button>
                                    <button type="button" data-action="toggle-call-control" data-call-control="speaker">${icon('speaker')}<span>扬声器</span></button>
                                    <button type="button" data-action="toggle-call-control" data-call-control="captions">${icon('caption')}<span>字幕</span></button>
                                </div>
                                <form class="phonie-call-controls" data-form="call" hidden>
                                    <input type="text" maxlength="1200" data-role="call-input" placeholder="输入这一轮要说的话" aria-label="通话输入">
                                    <button class="phonie-call-primary" type="submit" data-action="call-send" aria-label="发送这一轮">
                                        ${icon('send')}
                                    </button>
                                </form>
                                <button class="phonie-call-end" type="button" data-action="end-call" hidden aria-label="挂断电话">
                                    ${icon('end-call')}
                                    <span>挂断</span>
                                </button>
                            </div>
                        </section>
                        ${auxiliaryScreensMarkup()}
                        ${systemSettingsScreensMarkup()}
                        <section class="phonie-screen" data-screen="settings" aria-label="设置">
                            ${this.#settingsMarkup()}
                        </section>
                    </main>
                    ${dockMarkup()}
                    <div class="phonie-home-indicator" aria-hidden="true"></div>
                    <div class="phonie-toast" data-role="toast" role="status" aria-live="polite"></div>
                </div>
            </section>`;

        document.body.append(root);
        this.#root = root;
        this.#bindEvents();
        this.#mountSettingsLauncher();
        this.#mountWandLauncher();
        this.#unsubscribe = this.#store.subscribe((state) => this.render(state));
        this.#clockTimer = window.setInterval(() => this.#renderClocks(), 1000);
        this.render(this.#store.getState());
    }

    #settingsMarkup() {
        return `
            <div class="phonie-settings-list">
                <section class="phonie-settings-section">
                    <h2 class="phonie-settings-section__title">外观</h2>
                    <div class="phonie-settings-card">
                        ${this.#selectRow('主题', '日间、夜间或跟随酒馆', 'theme', [
                            [THEMES.DAY, '日间'],
                            [THEMES.NIGHT, '夜间'],
                            [THEMES.TAVERN, '跟随酒馆'],
                        ])}
                        ${this.#selectRow('打开入口', '悬浮球、魔棒菜单或同时显示', 'launcherMode', [
                            ['orb', '悬浮球'],
                            ['wand', '酒馆魔棒菜单'],
                            ['both', '两个入口都显示'],
                        ])}
                        ${this.#switchRow('显示手机译文', '控制私信与电话中的辅助中文字幕', 'showTranslation')}
                    </div>
                </section>
                <section class="phonie-settings-section">
                    <h2 class="phonie-settings-section__title">语言</h2>
                    <div class="phonie-settings-card">
                        ${this.#selectRow('角色语言', '静默回复与语音默认语言', 'sourceLanguage', [
                            ['ja-JP', '日本語'],
                            ['zh-CN', '简体中文'],
                            ['en-US', 'English'],
                            ['ko-KR', '한국어'],
                        ])}
                        ${this.#selectRow('翻译语言', '手机与正文的辅助字幕', 'targetLanguage', [
                            ['zh-CN', '简体中文'],
                            ['ja-JP', '日本語'],
                            ['en-US', 'English'],
                            ['ko-KR', '한국어'],
                        ])}
                        ${this.#switchRow('正文双语格式', '生成时要求可见中文译文与原语言语音段', 'bodyPromptEnabled')}
                    </div>
                </section>
                <section class="phonie-settings-section">
                    <h2 class="phonie-settings-section__title">语音与连续性</h2>
                    <div class="phonie-settings-card">
                        <div class="phonie-setting-row">
                            <span>
                                <span class="phonie-setting-label">当前语音提供商</span>
                                <span class="phonie-setting-description">由 Phonie 自己合成正文、私信与电话</span>
                            </span>
                            <span class="phonie-provider-chip" data-role="provider-chip"></span>
                        </div>
                        ${this.#switchRow('正文播放器', '在可见译文后附加逐句播放键', 'autoDecorateMessages')}
                        ${this.#switchRow('自动播放手机回复', '电话始终自动播放角色语音', 'autoPlayPhoneReplies')}
                        ${this.#switchRow('注入通信连续性', '只注入最近事件的短摘要', 'injectContinuity')}
                    </div>
                </section>
                <section class="phonie-settings-section">
                    <h2 class="phonie-settings-section__title">本地数据</h2>
                    <div class="phonie-settings-card">
                        <div class="phonie-setting-row">
                            <span>
                                <span class="phonie-setting-label">清除音频缓存</span>
                                <span class="phonie-setting-description">聊天文字和通话记录不会被删除</span>
                            </span>
                            <button class="phonie-icon-button" type="button" data-action="clear-cache" aria-label="清除音频缓存">${icon('trash')}</button>
                        </div>
                    </div>
                </section>
            </div>`;
    }

    #switchRow(label, description, key) {
        return `
            <label class="phonie-setting-row">
                <span>
                    <span class="phonie-setting-label">${escapeHtml(label)}</span>
                    <span class="phonie-setting-description">${escapeHtml(description)}</span>
                </span>
                <span class="phonie-switch">
                    <input type="checkbox" data-setting="${escapeHtml(key)}">
                    <span class="phonie-switch__track" aria-hidden="true"></span>
                </span>
            </label>`;
    }

    #selectRow(label, description, key, values) {
        const options = values.map(([value, text]) => `<option value="${escapeHtml(value)}">${escapeHtml(text)}</option>`).join('');
        return `
            <label class="phonie-setting-row">
                <span>
                    <span class="phonie-setting-label">${escapeHtml(label)}</span>
                    <span class="phonie-setting-description">${escapeHtml(description)}</span>
                </span>
                <select class="phonie-setting-select" data-setting="${escapeHtml(key)}">${options}</select>
            </label>`;
    }

    #mountSettingsLauncher() {
        const container = document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
        if (!container) {
            window.setTimeout(() => {
                if (this.#root?.isConnected && !this.#launcher) this.#mountSettingsLauncher();
            }, 700);
            return;
        }
        if (document.getElementById('phonie-settings-launcher')) return;
        const launcher = document.createElement('div');
        launcher.id = 'phonie-settings-launcher';
        launcher.className = 'extension_container phonie-settings-launcher';
        launcher.innerHTML = `
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Phonie Voice Phone</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <small>双语语音、私信与电话</small>
                    <label for="phonie-launcher-mode">打开入口</label>
                    <select id="phonie-launcher-mode" class="text_pole" data-launcher-setting="launcherMode">
                        <option value="orb">悬浮球</option>
                        <option value="wand">酒馆魔棒菜单</option>
                        <option value="both">两个入口都显示</option>
                    </select>
                    <button class="menu_button menu_button_icon" type="button" data-launcher-action="open">
                        <i class="fa-solid fa-mobile-screen-button"></i>
                        <span>打开手机设置</span>
                    </button>
                </div>
            </div>`;
        launcher.querySelector('[data-launcher-action="open"]')?.addEventListener('click', () => {
            this.#actions.open?.();
            this.#actions.navigate?.(SCREENS.SETTINGS);
        });
        launcher.querySelector('[data-launcher-setting="launcherMode"]')?.addEventListener('change', (event) => {
            this.#actions.updateSetting?.('launcherMode', event.currentTarget.value);
        });
        container.append(launcher);
        this.#launcher = launcher;
    }

    #mountWandLauncher() {
        if (this.#wandLauncher?.isConnected) return;
        const container = document.getElementById('tts_wand_container') || document.getElementById('extensionsMenu');
        if (!container) {
            window.setTimeout(() => {
                if (this.#root?.isConnected && !this.#wandLauncher?.isConnected) this.#mountWandLauncher();
            }, 700);
            return;
        }
        document.getElementById('phonie-wand-menu-item')?.remove();
        const item = document.createElement('div');
        item.id = 'phonie-wand-menu-item';
        item.className = 'list-group-item flex-container flexGap5';
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.setAttribute('aria-label', '打开 Phonie 手机');
        item.innerHTML = '<div class="extensionsMenuExtensionButton fa-solid fa-mobile-screen-button"></div><span>Phonie 手机</span>';
        const open = () => this.#actions.open?.();
        item.addEventListener('click', open);
        item.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                open();
            }
        });
        container.append(item);
        this.#wandLauncher = item;
    }

    #bindEvents() {
        this.#root.addEventListener('click', (event) => {
            const eventTarget = event.target;
            if (!(eventTarget instanceof Element)) return;
            const target = eventTarget.closest('[data-action]');
            if (!(target instanceof HTMLElement)) return;
            const action = target.dataset.action;

            if (action === 'open') {
                if (this.#suppressOrbClick) {
                    event.preventDefault();
                    return;
                }
                this.#actions.open?.();
            } else if (action === 'close') {
                this.#actions.close?.();
            } else if (action === 'navigate') {
                this.#actions.navigate?.(target.dataset.targetScreen);
            } else if (action === 'send-voice') {
                this.#submitChat(MESSAGE_KINDS.VOICE);
            } else if (action === 'start-call') {
                this.#actions.startCall?.();
            } else if (action === 'start-incoming-call') {
                this.#actions.startIncomingCall?.();
            } else if (action === 'accept-call') {
                this.#actions.acceptCall?.();
            } else if (action === 'decline-call') {
                this.#actions.declineCall?.();
            } else if (action === 'toggle-call-control') {
                this.#actions.toggleCallControl?.(target.dataset.callControl);
            } else if (action === 'cycle-theme') {
                this.#actions.cycleTheme?.();
            } else if (action === 'end-call') {
                this.#actions.endCall?.();
            } else if (action === 'clear-cache') {
                this.#actions.clearCache?.();
            } else if (action === 'play-phone-audio') {
                this.#actions.playPhoneAudio?.(target.dataset.messageId);
            } else if (action === 'set-tts-provider') {
                this.#actions.setTtsProvider?.(target.dataset.providerId);
            } else if (action === 'check-tts-provider') {
                this.#actions.checkTtsProvider?.(target.dataset.providerId);
            } else if (action === 'sync-tts-resources') {
                this.#actions.syncTtsResources?.(target.dataset.providerId);
            } else if (action === 'save-tts-secret') {
                const input = [...this.#root.querySelectorAll('[data-role="tts-secret-input"]')].find((candidate) => (
                    candidate.dataset.providerId === (target.dataset.providerId || '')
                    && candidate.dataset.secretKey === (target.dataset.secretKey || '')
                ));
                if (input instanceof HTMLInputElement) {
                    this.#actions.saveTtsSecret?.(target.dataset.providerId, target.dataset.secretKey, input.value).then((saved) => {
                        if (saved) input.value = '';
                    });
                }
            } else if (action === 'save-character-route') {
                const providerId = this.#root.querySelector('[data-role="character-provider-select"]')?.value || '';
                const fallbackProviderId = this.#root.querySelector('[data-role="character-fallback-provider-select"]')?.value || '';
                const voiceId = this.#root.querySelector('[data-role="character-voice-id"]')?.value || '';
                const referenceAudio = this.#root.querySelector('[data-role="character-reference-audio"]')?.value || '';
                this.#actions.updateCharacterRoute?.({ providerId, fallbackProviderId, voiceId, referenceAudio });
            } else if (action === 'set-generation-profile') {
                this.#actions.updateSetting?.('generationMode', 'profile');
                this.#actions.updateSetting?.('generationProfileId', target.dataset.profileId || '');
            } else if (action === 'save-custom-key') {
                this.#saveCustomKey();
            } else if (action === 'refresh-custom-models') {
                const endpoint = this.#root.querySelector('[data-setting="customOpenAIEndpoint"]')?.value || '';
                this.#actions.refreshCustomModels?.(endpoint);
            } else if (action === 'reset-prompt-preset') {
                const kind = this.#store.getState().settings.promptWorkflowKind || 'body';
                const defaults = kind === 'body' ? DEFAULT_BODY_PROMPT_PRESET : DEFAULT_PHONE_PROMPT_PRESET;
                this.#actions.updatePromptPreset?.(kind, normalizePhonePromptPreset(defaults));
            } else if (action === 'add-prompt-entry') {
                const { kind, preset } = this.#currentPromptPreset();
                this.#actions.updatePromptPreset?.(kind, addPhonePromptEntry(preset));
            } else if (action === 'move-prompt-entry') {
                const entryId = target.closest('[data-prompt-entry-id]')?.dataset.promptEntryId;
                const { kind, preset } = this.#currentPromptPreset();
                if (entryId) this.#actions.updatePromptPreset?.(kind, movePhonePromptEntry(preset, entryId, target.dataset.direction));
            } else if (action === 'delete-prompt-entry') {
                const entryId = target.closest('[data-prompt-entry-id]')?.dataset.promptEntryId;
                const { kind, preset } = this.#currentPromptPreset();
                if (entryId) this.#actions.updatePromptPreset?.(kind, removePhonePromptEntry(preset, entryId));
            }
        });

        this.#root.addEventListener('submit', (event) => {
            event.preventDefault();
            const form = event.target;
            if (!(form instanceof HTMLFormElement)) return;
            if (form.dataset.form === 'chat') this.#submitChat(MESSAGE_KINDS.TEXT);
            if (form.dataset.form === 'call') this.#submitCall();
        });

        this.#root.addEventListener('keydown', (event) => {
            const target = event.target;
            if (target instanceof HTMLTextAreaElement && target.dataset.role === 'chat-input' && event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                this.#submitChat(MESSAGE_KINDS.TEXT);
            }
        });

        this.#root.addEventListener('change', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
            const value = target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value;
            const providerField = target.dataset.providerField;
            if (providerField) {
                const editor = target.closest('[data-provider-editor-id]');
                const providerId = editor?.dataset.providerEditorId;
                const nextValue = target instanceof HTMLInputElement && target.type === 'range' ? Number(value) : value;
                if (providerId) this.#actions.updateTtsProvider?.(providerId, providerField, nextValue);
                return;
            }
            const presetField = target.dataset.promptPresetField;
            if (presetField) {
                const { kind, preset } = this.#currentPromptPreset();
                this.#actions.updatePromptPreset?.(kind, normalizePhonePromptPreset({ ...preset, [presetField]: value }));
                return;
            }
            const entryField = target.dataset.promptEntryField;
            if (entryField) {
                const entryId = target.closest('[data-prompt-entry-id]')?.dataset.promptEntryId;
                if (entryId) {
                    const { kind, preset } = this.#currentPromptPreset();
                    this.#actions.updatePromptPreset?.(kind, updatePhonePromptEntry(preset, entryId, { [entryField]: value }));
                }
                return;
            }
            const key = target.dataset.setting;
            if (key) this.#actions.updateSetting?.(key, value);
        });

        const orb = this.#root.querySelector('.phonie-orb');
        orb?.addEventListener('pointerdown', (event) => this.#startOrbDrag(event));
    }

    async #saveCustomKey() {
        const input = this.#root.querySelector('[data-role="custom-openai-key"]');
        if (!(input instanceof HTMLInputElement)) return;
        const saved = await this.#actions.saveCustomKey?.(input.value);
        if (saved) input.value = '';
    }

    #startOrbDrag(event) {
        if (this.#drag || !shouldStartOrbDrag(event)) return;
        const orb = event.currentTarget;
        if (!(orb instanceof HTMLElement)) return;
        try {
            orb.setPointerCapture?.(event.pointerId);
        } catch (error) {
            console.debug('[Phonie] Pointer capture unavailable; continuing with click fallback.', error);
        }
        this.#drag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            orb,
            moved: false,
        };
        orb.dataset.dragging = 'false';
        this.#orbMoveHandler = (moveEvent) => this.#moveOrb(moveEvent);
        this.#orbEndHandler = (endEvent) => this.#endOrbDrag(endEvent);
        window.addEventListener('pointermove', this.#orbMoveHandler, { capture: true, passive: false });
        window.addEventListener('pointerup', this.#orbEndHandler, true);
        window.addEventListener('pointercancel', this.#orbEndHandler, true);
    }

    #moveOrb(event) {
        if (!this.#drag || this.#drag.pointerId !== event.pointerId) return;
        this.#drag = updateOrbDrag(this.#drag, event.clientX, event.clientY);
        if (!this.#drag.moved) return;
        event.preventDefault();
        const dx = event.clientX - this.#drag.startX;
        const dy = event.clientY - this.#drag.startY;
        this.#drag.orb.dataset.dragging = 'true';
        this.#drag.orb.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(0.97)`;
    }

    #endOrbDrag(event) {
        if (!this.#drag) return;
        if (this.#drag.pointerId !== event.pointerId) return;
        const drag = this.#drag;
        this.#removeOrbWindowListeners();
        const shouldOpen = isOrbTap(drag, event.type);
        if (drag.moved && event.type === 'pointerup') {
            event.preventDefault();
            const before = drag.orb.getBoundingClientRect();
            const target = getOrbDockTarget(event.clientX, event.clientY, window.innerWidth, window.innerHeight);
            this.#suppressOrbClick = true;
            drag.orb.style.removeProperty('transform');
            drag.orb.dataset.dragging = 'false';
            this.#actions.updateDock?.(target);
            const after = drag.orb.getBoundingClientRect();
            if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && typeof drag.orb.animate === 'function') {
                drag.orb.animate([
                    { transform: `translate3d(${before.left - after.left}px, ${before.top - after.top}px, 0) scale(0.97)` },
                    { transform: 'translate3d(0, 0, 0) scale(1)' },
                ], { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
            }
            window.setTimeout(() => { this.#suppressOrbClick = false; }, 40);
        } else {
            drag.orb.style.removeProperty('transform');
            drag.orb.dataset.dragging = 'false';
        }
        this.#drag = null;
        if (shouldOpen) {
            this.#suppressOrbClick = true;
            this.#actions.open?.();
            window.setTimeout(() => { this.#suppressOrbClick = false; }, 0);
        }
    }

    #removeOrbWindowListeners() {
        if (this.#orbMoveHandler) window.removeEventListener('pointermove', this.#orbMoveHandler, true);
        if (this.#orbEndHandler) {
            window.removeEventListener('pointerup', this.#orbEndHandler, true);
            window.removeEventListener('pointercancel', this.#orbEndHandler, true);
        }
        this.#orbMoveHandler = null;
        this.#orbEndHandler = null;
    }

    #currentPromptPreset() {
        const settings = this.#store.getState().settings;
        const kind = settings.promptWorkflowKind === 'phone' ? 'phone' : 'body';
        return {
            kind,
            preset: normalizePhonePromptPreset(kind === 'body' ? settings.bodyPromptPreset : settings.promptPreset),
        };
    }

    #submitChat(kind) {
        const input = this.#root.querySelector('[data-role="chat-input"]');
        if (!(input instanceof HTMLTextAreaElement)) return;
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        this.#actions.sendMessage?.(text, kind, false);
    }

    #submitCall() {
        const input = this.#root.querySelector('[data-role="call-input"]');
        if (!(input instanceof HTMLInputElement)) return;
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        this.#actions.sendMessage?.(text, MESSAGE_KINDS.TEXT, true);
    }

    render(state) {
        if (!this.#root) return;
        this.#root.dataset.theme = state.settings.theme;
        this.#root.dataset.open = String(Boolean(state.open));
        this.#root.dataset.dock = state.settings.dockSide;
        this.#root.dataset.screen = state.screen;
        this.#root.dataset.audioState = state.audioState || 'idle';
        this.#root.dataset.launcher = state.settings.launcherMode || 'orb';
        this.#root.style.setProperty('--phonie-orb-y', `${clamp(state.settings.dockY, 0.07, 0.9) * 100}%`);

        const phone = this.#root.querySelector('.phonie-phone');
        phone?.setAttribute('aria-hidden', String(!state.open));
        const orb = this.#root.querySelector('.phonie-orb');
        orb?.setAttribute('aria-expanded', String(Boolean(state.open)));
        const wandVisible = ['wand', 'both'].includes(state.settings.launcherMode);
        if (this.#wandLauncher) this.#wandLauncher.hidden = !wandVisible;
        const launcherSelect = this.#launcher?.querySelector('[data-launcher-setting="launcherMode"]');
        if (launcherSelect instanceof HTMLSelectElement) launcherSelect.value = state.settings.launcherMode || 'orb';
        this.#setText('[data-role="provider"]', state.providerLabel);
        this.#setText('[data-role="provider-chip"]', state.providerLabel);
        const themeButton = this.#root.querySelector('.phonie-theme-button');
        if (themeButton) {
            const nextLabels = { day: '夜间', night: '跟随酒馆', tavern: '日间' };
            themeButton.setAttribute('aria-label', `切换到${nextLabels[state.settings.theme] || '下一个'}主题`);
            themeButton.title = `当前：${state.settings.theme === 'day' ? '日间' : state.settings.theme === 'night' ? '夜间' : '跟随酒馆'}`;
            if (themeButton.dataset.currentTheme !== state.settings.theme) {
                themeButton.dataset.currentTheme = state.settings.theme;
                themeButton.innerHTML = icon(state.settings.theme === 'day' ? 'sun' : state.settings.theme === 'night' ? 'moon' : 'stars');
                themeButton.dataset.changing = 'true';
                window.setTimeout(() => { if (themeButton.isConnected) themeButton.dataset.changing = 'false'; }, 180);
            }
        }
        const screenCopy = SCREEN_COPY[state.screen] || SCREEN_COPY[SCREENS.HOME];
        this.#setText('[data-role="title"]', state.screen === SCREENS.CHAT ? state.contact.name : screenCopy.title);
        this.#setText('[data-role="eyebrow"]', screenCopy.eyebrow);

        for (const screen of this.#root.querySelectorAll('[data-screen]')) {
            screen.dataset.active = String(screen.dataset.screen === state.screen);
        }
        for (const tab of this.#root.querySelectorAll('.phonie-dock-button[data-target-screen]')) {
            tab.setAttribute('aria-selected', String(tab.dataset.targetScreen === state.screen));
        }

        const unread = this.#root.querySelector('[data-role="unread"]');
        if (unread) {
            unread.hidden = !state.unread;
            unread.textContent = state.unread > 99 ? '99' : String(state.unread || '');
        }

        this.#renderMessages(state);
        this.#renderCall(state);
        this.#renderHome(state);
        this.#renderVoiceLibrary(state);
        this.#renderTrace(state);
        this.#renderCharacter(state);
        this.#renderModelSettings(state);
        this.#renderPromptPreset(state);
        this.#renderSettings(state);
        this.#renderDeviceStatus(state);
        this.#renderClocks();
        this.#renderToast(state.toast);
    }

    #renderMessages(state) {
        const list = this.#root.querySelector('[data-role="message-list"]');
        if (!list) return;
        if (state.messages.length === 0) {
            list.innerHTML = `
                <div class="phonie-chat-empty">
                    <div class="phonie-chat-empty__mark">${icon('message')}</div>
                    <h2 class="phonie-chat-empty__title">一条安静的私人频道</h2>
                    <p>这里的消息属于故事世界，但不会挤进酒馆正文。</p>
                </div>`;
        } else {
            list.innerHTML = state.messages.map((message) => renderMessage(message, state.settings.showTranslation)).join('');
        }
        const generating = this.#root.querySelector('[data-role="generating"]');
        if (generating) generating.hidden = !state.generating;
        requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
    }

    #renderCall(state) {
        this.#setText('[data-role="call-initials"]', initials(state.contact.name));
        this.#setText('[data-role="call-contact"]', state.contact.name);
        this.#setText('[data-role="call-status"]', callStatusLabel(state.callState, this.#elapsed(state.callStartedAt), state.callDirection));

        const captions = this.#root.querySelector('[data-role="call-captions"]');
        const empty = this.#root.querySelector('[data-role="call-empty"]');
        const content = this.#root.querySelector('[data-role="call-caption-content"]');
        const hasCaption = Boolean(state.callCaption?.source);
        if (captions) captions.dataset.empty = String(!hasCaption);
        if (empty) empty.hidden = hasCaption;
        if (content) content.hidden = !hasCaption;
        this.#setText('[data-role="call-caption-source"]', state.callCaption?.source || '');
        this.#setText('[data-role="call-caption-translation"]', state.settings.showTranslation ? state.callCaption?.translation || '' : '');

        const active = ACTIVE_CALL_STATES.has(state.callState);
        const connected = [CALL_STATES.CONNECTED, CALL_STATES.GENERATING, CALL_STATES.SPEAKING].includes(state.callState);
        const incoming = state.callState === CALL_STATES.RINGING && state.callDirection === 'incoming';
        const callForm = this.#root.querySelector('[data-form="call"]');
        const idleAction = this.#root.querySelector('[data-role="call-idle-action"]');
        const endButton = this.#root.querySelector('[data-action="end-call"]');
        const incomingActions = this.#root.querySelector('[data-role="call-incoming-actions"]');
        const featureControls = this.#root.querySelector('[data-role="call-feature-controls"]');
        const mark = this.#root.querySelector('[data-role="call-mark"]');
        if (callForm) callForm.hidden = !connected;
        if (idleAction) idleAction.hidden = active;
        if (endButton) endButton.hidden = !active || incoming;
        if (incomingActions) incomingActions.hidden = !incoming;
        if (featureControls) featureControls.hidden = !connected;
        if (mark) mark.dataset.ringing = String(incoming || state.callState === CALL_STATES.DIALING);
        if (captions) captions.hidden = connected && state.callControls?.captions === false;
        for (const button of this.#root.querySelectorAll('[data-call-control]')) {
            const pressed = Boolean(state.callControls?.[button.dataset.callControl]);
            button.setAttribute('aria-pressed', String(pressed));
        }

        const input = this.#root.querySelector('[data-role="call-input"]');
        if (input instanceof HTMLInputElement) {
            input.disabled = ![CALL_STATES.CONNECTED, CALL_STATES.SPEAKING].includes(state.callState) || state.generating;
        }
    }

    #renderHome(state) {
        const voiceCount = state.messages.filter((message) => message.kind === MESSAGE_KINDS.VOICE).length;
        this.#setText('[data-role="home-contact"]', state.contact.name);
        this.#setText('[data-role="home-contact-service"]', state.contact.name);
        this.#setText('[data-role="home-provider"]', state.providerLabel);
        this.#setText('[data-role="home-message-summary"]', `${state.messages.length} 条手机消息`);
        this.#setText('[data-role="home-chat-count"]', `${state.messages.length} 条`);
        this.#setText('[data-role="home-call-count"]', `${state.calls.length} 通`);
        this.#setText('[data-role="home-voice-count"]', `${voiceCount} 条`);
        this.#setText('[data-role="home-trace-count"]', `${state.calls.length} 段`);
        setBackgroundImage(this.#root.querySelector('[data-role="wallpaper"]'), state.contact.avatarUrl);
        this.#root.dataset.hasWallpaper = String(Boolean(state.contact.avatarUrl));
    }

    #renderVoiceLibrary(state) {
        this.#setText('[data-role="voice-provider"]', state.providerLabel);
        this.#setText('[data-role="voice-language"]', state.settings.sourceLanguage);
        const providers = this.#root.querySelector('[data-role="tts-provider-list"]');
        if (providers) {
            const list = Array.isArray(state.providerSnapshot?.providers) ? state.providerSnapshot.providers : [];
            const signature = JSON.stringify(list.map((provider) => [provider.id, provider.selected, provider.runtime?.status, provider.runtime?.message]));
            if (providers.dataset.signature !== signature) {
                providers.dataset.signature = signature;
                providers.innerHTML = list.length ? list.map((provider) => `
                <button class="phonie-profile-card${provider.selected ? ' is-current' : ''}" type="button" data-action="set-tts-provider" data-provider-id="${escapeHtml(provider.id)}" aria-pressed="${provider.selected}">
                    <span class="phonie-profile-card__mark">${icon(provider.icon || 'signal')}</span>
                    <span><strong>${escapeHtml(provider.name)}</strong><small>${escapeHtml(provider.runtime?.message || provider.mode)}</small></span>
                    <b>${provider.selected ? '当前' : provider.category}</b>
                </button>`).join('') : '<div class="phonie-record-empty">Phonie 语音引擎目录未载入。</div>';
            }
        }
        const editor = this.#root.querySelector('[data-role="tts-provider-editor"]');
        const current = state.providerSnapshot?.providers?.find((provider) => provider.selected);
        if (editor && current) {
            const signature = JSON.stringify([current.id, current.settings, current.catalog, current.runtime, state.providerSnapshot?.fallbackProvider]);
            if (editor.dataset.signature !== signature) {
                editor.dataset.signature = signature;
                editor.dataset.providerEditorId = current.id;
                editor.innerHTML = `
                    <header class="phonie-provider-editor__header">
                        <span class="phonie-profile-card__mark">${icon(current.icon || 'signal')}</span>
                        <span><small>${escapeHtml(current.category)} · ${escapeHtml(current.mode)}</small><strong>${escapeHtml(current.name)} 配置</strong><i>${escapeHtml(current.runtime?.message || '等待检测')}</i></span>
                    </header>
                    <div class="phonie-provider-editor__actions">
                        <button type="button" data-action="check-tts-provider" data-provider-id="${escapeHtml(current.id)}">${icon('signal')}<span>检测连接</span></button>
                        ${['elevenlabs', 'minimax'].includes(current.id) ? `<button type="button" data-action="sync-tts-resources" data-provider-id="${escapeHtml(current.id)}">${icon('reset')}<span>同步模型与音色</span></button>` : ''}
                    </div>
                    <label class="phonie-provider-field">
                        <span><strong>全局备用引擎</strong><small>当前引擎失败时自动尝试</small></span>
                        <select data-setting="ttsFallbackProvider">
                            <option value="">不使用备用引擎</option>
                            ${state.providerSnapshot.providers.filter((provider) => provider.id !== current.id).map((provider) => '<option value="' + escapeHtml(provider.id) + '"' + (provider.id === state.providerSnapshot.fallbackProvider ? ' selected' : '') + '>' + escapeHtml(provider.name) + '</option>').join('')}
                        </select>
                    </label>
                    <div class="phonie-provider-fields">${current.fields.map((field) => providerFieldMarkup(field, current)).join('')}</div>`;
            }
        }
        const list = this.#root.querySelector('[data-role="voice-library"]');
        if (!list) return;
        const voices = state.messages.filter((message) => message.kind === MESSAGE_KINDS.VOICE).slice(-8).reverse();
        if (!voices.length) {
            list.innerHTML = '<div class="phonie-record-empty">发送或播放语音后，声线片段会出现在这里。</div>';
            return;
        }
        list.innerHTML = voices.map((message) => `
            <article class="phonie-record-card">
                <button class="phonie-record-card__play" type="button" data-action="play-phone-audio" data-message-id="${escapeHtml(message.id)}" aria-label="播放语音片段">${icon(message.isPlaying ? 'pause' : 'play')}</button>
                <span class="phonie-record-card__copy"><strong>${escapeHtml(message.author)}</strong><small>${escapeHtml(message.originalText.slice(0, 54) || '无文字片段')}</small></span>
                <time>${escapeHtml(message.durationLabel || formatRecordDate(message.createdAt))}</time>
            </article>`).join('');
    }

    #renderTrace(state) {
        const list = this.#root.querySelector('[data-role="trace-list"]');
        if (!list) return;
        const records = state.calls.slice(-8).reverse();
        if (!records.length) {
            list.innerHTML = '<div class="phonie-record-empty">接通第一通电话后，这里会留下时间、时长和简短摘要。</div>';
            return;
        }
        list.innerHTML = records.map((record) => `
            <article class="phonie-record-card phonie-record-card--call">
                <span class="phonie-record-card__play" aria-hidden="true">${icon('phone')}</span>
                <span class="phonie-record-card__copy"><strong>${escapeHtml(record.contactName || state.contact.name)}</strong><small>${record.direction === 'incoming' ? '来电' : '外呼'} · ${record.outcome === 'declined' ? '未接通' : '已结束'} · ${escapeHtml(record.summary || '通话已结束')}</small></span>
                <time>${escapeHtml(formatDuration(record.startedAt, record.endedAt))}<br>${escapeHtml(formatRecordDate(record.startedAt))}</time>
            </article>`).join('');
    }

    #renderCharacter(state) {
        this.#setText('[data-role="character-initials"]', initials(state.contact.name));
        this.#setText('[data-role="character-name"]', state.contact.name);
        this.#setText('[data-role="character-provider"]', state.providerLabel);
        this.#setText('[data-role="character-source-language"]', state.settings.sourceLanguage);
        this.#setText('[data-role="character-target-language"]', state.settings.targetLanguage);
        this.#setText('[data-role="character-continuity"]', state.settings.injectContinuity ? '开启' : '关闭');
        setBackgroundImage(this.#root.querySelector('[data-role="character-portrait"]'), state.contact.avatarUrl);
        const providers = state.providerSnapshot?.providers || [];
        const route = state.settings.ttsCharacterRoutes?.[state.contact.name] || {};
        const providerSelect = this.#root.querySelector('[data-role="character-provider-select"]');
        const fallbackSelect = this.#root.querySelector('[data-role="character-fallback-provider-select"]');
        if (providerSelect instanceof HTMLSelectElement) {
            providerSelect.innerHTML = providers.map((provider) => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.name)}</option>`).join('');
            providerSelect.value = route.providerId || state.settings.ttsActiveProvider || '';
        }
        if (fallbackSelect instanceof HTMLSelectElement) {
            fallbackSelect.innerHTML = [
                '<option value="">沿用全局备用引擎</option>',
                ...providers.filter((provider) => provider.id !== (route.providerId || state.settings.ttsActiveProvider)).map((provider) => '<option value="' + escapeHtml(provider.id) + '">' + escapeHtml(provider.name) + '</option>'),
            ].join('');
            fallbackSelect.value = route.fallbackProviderId || '';
        }
        const voice = this.#root.querySelector('[data-role="character-voice-id"]');
        const reference = this.#root.querySelector('[data-role="character-reference-audio"]');
        if (voice instanceof HTMLInputElement && document.activeElement !== voice) voice.value = route.voiceId || '';
        if (reference instanceof HTMLInputElement && document.activeElement !== reference) reference.value = route.referenceAudio || '';
    }

    #renderModelSettings(state) {
        const target = state.generationTarget || { name: '跟随酒馆', model: '当前模型', api: 'current' };
        this.#setText('[data-role="generation-target"]', target.name);
        this.#setText('[data-role="generation-model"]', `${target.model || '当前模型'} · ${target.api || 'current'}`);
        this.#setText('[data-role="model-tts-provider"]', state.providerLabel);
        this.#setText('[data-role="custom-openai-status"]', state.customModelStatus || '密钥由酒馆安全保存，不会进入插件备份');

        const mode = state.settings.generationMode || 'tavern';
        for (const section of this.#root.querySelectorAll('[data-generation-source]')) {
            section.hidden = section.dataset.generationSource !== mode;
        }

        const select = this.#root.querySelector('[data-role="generation-profile-select"]');
        const profiles = Array.isArray(state.generationProfiles) ? state.generationProfiles : [];
        if (select instanceof HTMLSelectElement) {
            select.innerHTML = [
                '<option value="">跟随酒馆当前连接</option>',
                ...profiles.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)} · ${escapeHtml(profile.model)}</option>`),
            ].join('');
            select.value = state.settings.generationProfileId || '';
        }

        const list = this.#root.querySelector('[data-role="generation-profile-list"]');
        if (!list) return;
        const choices = profiles;
        list.innerHTML = choices.map((profile) => {
            const current = mode === 'profile' && (state.settings.generationProfileId || '') === profile.id;
            return `<button class="phonie-profile-card${current ? ' is-current' : ''}" type="button" data-action="set-generation-profile" data-profile-id="${escapeHtml(profile.id)}" aria-pressed="${current}">
                <span class="phonie-profile-card__mark">${icon('signal')}</span>
                <span><strong>${escapeHtml(profile.name)}</strong><small>${escapeHtml(profile.model || '当前模型')} · ${escapeHtml(profile.api || 'current')}</small></span>
                <b>${current ? '当前' : '选择'}</b>
            </button>`;
        }).join('');

        const customSelect = this.#root.querySelector('[data-role="custom-model-select"]');
        if (customSelect instanceof HTMLSelectElement) {
            const models = Array.isArray(state.settings.customOpenAIModels) ? state.settings.customOpenAIModels : [];
            const current = state.settings.customOpenAIModel || '';
            const choices = current && !models.includes(current) ? [current, ...models] : models;
            customSelect.innerHTML = choices.length
                ? choices.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join('')
                : '<option value="">请先拉取模型</option>';
            customSelect.value = current;
        }
    }

    #renderPromptPreset(state) {
        const kind = state.settings.promptWorkflowKind === 'phone' ? 'phone' : 'body';
        const preset = normalizePhonePromptPreset(kind === 'body' ? state.settings.bodyPromptPreset : state.settings.promptPreset);
        const name = this.#root.querySelector('[data-prompt-preset-field="name"]');
        const depth = this.#root.querySelector('[data-prompt-preset-field="insertionDepth"]');
        if (name instanceof HTMLInputElement) name.value = preset.name;
        if (depth instanceof HTMLInputElement) depth.value = String(preset.insertionDepth);
        const list = this.#root.querySelector('[data-role="prompt-entry-list"]');
        if (list) list.innerHTML = preset.entries.map((entry, index) => promptEntryMarkup(entry, index, preset.entries.length)).join('');
        this.#setText('[data-role="prompt-intro"]', kind === 'body'
            ? '正文生成前按顺序注入；译文保留在正文，TTSVoice 标签只作为角色、情绪和原语言的内部控制。'
            : '手机私信与电话的静默生成工作流；每条可选择 system、user 或 assistant。');
        const master = this.#root.querySelector('[data-role="body-prompt-master"]');
        if (master) master.hidden = kind !== 'body';
    }
    #renderSettings(state) {
        for (const control of this.#root.querySelectorAll('[data-setting]')) {
            const value = state.settings[control.dataset.setting];
            if (control instanceof HTMLInputElement && control.type === 'checkbox') {
                control.checked = Boolean(value);
            } else if (control instanceof HTMLSelectElement) {
                control.value = String(value ?? '');
            } else if (control instanceof HTMLInputElement) {
                control.value = String(value ?? '');
            }
        }
    }

    #renderDeviceStatus(state) {
        const battery = state.deviceStatus?.battery || {};
        const network = state.deviceStatus?.network || {};
        this.#setText('[data-role="network-label"]', network.label || '在线');
        this.#setText('[data-role="battery-label"]', battery.available ? `${battery.percent}%` : '--%');
        const networkIcon = this.#root.querySelector('[data-role="network-icon"]');
        if (networkIcon) networkIcon.innerHTML = icon(network.kind === 'wifi' ? 'wifi' : 'signal');
        const charging = this.#root.querySelector('[data-role="charging-icon"]');
        if (charging) charging.hidden = !battery.charging;
        const signals = this.#root.querySelector('.phonie-status__signals');
        if (signals) {
            signals.dataset.online = String(network.online !== false);
            signals.title = [
                network.label || '网络状态不可读',
                network.downlink ? `${network.downlink} Mbps` : '',
                battery.available ? `电量 ${battery.percent}%${battery.charging ? ' · 充电中' : ''}` : '浏览器不提供电量权限',
            ].filter(Boolean).join(' · ');
        }
    }

    #renderClocks() {
        const now = new Date();
        const clock = formatClock(now.getTime());
        this.#setText('[data-role="clock"]', clock);
        this.#setText('[data-role="home-clock"]', clock);
        this.#setText('[data-role="home-date"]', new Intl.DateTimeFormat('zh-CN', {
            month: 'long',
            day: 'numeric',
            weekday: 'short',
        }).format(now));
        const state = this.#store.getState();
        if (state && ACTIVE_CALL_STATES.has(state.callState)) {
            this.#setText('[data-role="call-status"]', callStatusLabel(state.callState, this.#elapsed(state.callStartedAt), state.callDirection));
        }
    }

    #elapsed(startedAt) {
        if (!startedAt) return '';
        const total = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
        const minutes = Math.floor(total / 60).toString().padStart(2, '0');
        const seconds = (total % 60).toString().padStart(2, '0');
        return `${minutes}:${seconds}`;
    }

    #renderToast(toast) {
        const element = this.#root.querySelector('[data-role="toast"]');
        if (!element) return;
        window.clearTimeout(this.#toastTimer);
        if (!toast?.text) {
            element.dataset.visible = 'false';
            return;
        }
        element.textContent = toast.text;
        element.dataset.visible = 'true';
        this.#toastTimer = window.setTimeout(() => this.#actions.clearToast?.(), 2600);
    }

    #setText(selector, value) {
        const element = this.#root?.querySelector(selector);
        if (element) element.textContent = String(value ?? '');
    }

    dispose() {
        window.clearInterval(this.#clockTimer);
        window.clearTimeout(this.#toastTimer);
        this.#unsubscribe?.();
        this.#removeOrbWindowListeners();
        this.#launcher?.remove();
        this.#wandLauncher?.remove();
        this.#root?.remove();
        this.#root = null;
    }
}
