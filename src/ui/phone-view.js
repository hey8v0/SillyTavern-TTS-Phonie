import { CALL_STATES, MESSAGE_KINDS, SCREENS, THEMES } from '../core/constants.js';
import {
    DEFAULT_PHONE_PROMPT_PRESET,
    addPhonePromptEntry,
    movePhonePromptEntry,
    normalizePhonePromptPreset,
    removePhonePromptEntry,
    updatePhonePromptEntry,
} from '../dialogue/prompt-preset.js';
import { clamp, escapeHtml, formatClock, icon, initials } from './dom.js';
import { auxiliaryScreensMarkup, dockMarkup, homeScreenMarkup } from './phone-home.js';
import { isOrbTap, updateOrbDrag } from './orb-gesture.js';
import { promptEntryMarkup, systemSettingsScreensMarkup } from './system-settings.js';

const ACTIVE_CALL_STATES = new Set([
    CALL_STATES.DIALING,
    CALL_STATES.RINGING,
    CALL_STATES.CONNECTED,
    CALL_STATES.GENERATING,
    CALL_STATES.SPEAKING,
]);

const SCREEN_COPY = Object.freeze({
    [SCREENS.HOME]: { title: 'Phoen', eyebrow: 'Resonance OS' },
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

function callStatusLabel(state, elapsed = '') {
    const labels = {
        [CALL_STATES.IDLE]: '等待拨号',
        [CALL_STATES.DIALING]: '正在拨号',
        [CALL_STATES.RINGING]: '等待接听',
        [CALL_STATES.CONNECTED]: elapsed ? `通话中  ${elapsed}` : '通话中',
        [CALL_STATES.GENERATING]: '正在组织语言',
        [CALL_STATES.SPEAKING]: '对方正在说话',
        [CALL_STATES.ENDED]: '通话已结束',
        [CALL_STATES.ERROR]: '通话连接异常',
    };
    return labels[state] || labels[CALL_STATES.IDLE];
}

function makeWaveBars(seed = '') {
    const text = String(seed || 'phoen');
    return Array.from({ length: 18 }, (_, index) => {
        const code = text.charCodeAt(index % text.length) || 80;
        const height = 26 + ((code * (index + 3)) % 68);
        return `<i style="--bar-height:${height}%"></i>`;
    }).join('');
}

function renderMessage(message, showTranslation) {
    const outgoing = message.direction === 'outgoing';
    const translation = showTranslation && message.translationText
        ? `<p class="phoen-message__translation" lang="zh-CN">${escapeHtml(message.translationText)}</p>`
        : '';
    const voice = message.kind === MESSAGE_KINDS.VOICE
        ? `
            <div class="phoen-message__voice">
                <button class="phoen-voice-action" type="button" data-action="play-phone-audio" data-message-id="${escapeHtml(message.id)}" aria-label="播放这条语音消息">
                    ${icon(message.isPlaying ? 'pause' : 'play')}
                </button>
                <span class="phoen-message__waveform" aria-hidden="true">${makeWaveBars(message.id)}</span>
                <span class="phoen-message__duration">${escapeHtml(message.durationLabel || '--:--')}</span>
            </div>`
        : '';

    return `
        <article class="phoen-message ${outgoing ? 'phoen-message--outgoing' : ''}" data-phone-message-id="${escapeHtml(message.id)}">
            <div class="phoen-message__meta">
                <span>${escapeHtml(message.author)}</span>
                <time datetime="${new Date(message.createdAt).toISOString()}">${messageTime(message.createdAt)}</time>
            </div>
            <div class="phoen-message__bubble">
                ${voice}
                <p class="phoen-message__source" lang="${escapeHtml(message.language || '')}">${escapeHtml(message.originalText)}</p>
                ${translation}
            </div>
        </article>`;
}

export class PhoneView {
    #store;
    #actions;
    #root = null;
    #launcher = null;
    #unsubscribe = null;
    #clockTimer = null;
    #toastTimer = null;
    #drag = null;
    #suppressOrbClick = false;

    constructor({ store, actions }) {
        this.#store = store;
        this.#actions = actions;
    }

    mount() {
        if (document.getElementById('phoen-root')) return;

        const root = document.createElement('div');
        root.id = 'phoen-root';
        root.className = 'phoen-root';
        root.innerHTML = `
            <div class="phoen-scrim" data-action="close" aria-hidden="true"></div>
            <button class="phoen-orb" type="button" data-action="open" aria-label="打开 Phoen" aria-controls="phoen-phone">
                ${icon('wave')}
                <span class="phoen-orb__seam" aria-hidden="true"></span>
                <span class="phoen-orb__unread" data-role="unread" hidden></span>
            </button>
            <section class="phoen-phone" id="phoen-phone" aria-label="Phoen 声纹手机" aria-hidden="true">
                <span class="phoen-hardware-key phoen-hardware-key--volume" aria-hidden="true"></span>
                <span class="phoen-hardware-key phoen-hardware-key--power" aria-hidden="true"></span>
                <div class="phoen-frame">
                    <div class="phoen-wallpaper" data-role="wallpaper" aria-hidden="true"></div>
                    <div class="phoen-wallpaper-veil" aria-hidden="true"></div>
                    <div class="phoen-rain-curtain" aria-hidden="true">
                        <i style="--rain-index:0;--rain-x:5%;--rain-delay:-0.1s"></i><i style="--rain-index:1;--rain-x:14%;--rain-delay:-1.7s"></i><i style="--rain-index:2;--rain-x:23%;--rain-delay:-3.1s"></i><i style="--rain-index:3;--rain-x:32%;--rain-delay:-0.9s"></i><i style="--rain-index:4;--rain-x:41%;--rain-delay:-4.2s"></i><i style="--rain-index:5;--rain-x:50%;--rain-delay:-2.4s"></i><i style="--rain-index:6;--rain-x:59%;--rain-delay:-0.5s"></i><i style="--rain-index:7;--rain-x:68%;--rain-delay:-3.6s"></i><i style="--rain-index:8;--rain-x:77%;--rain-delay:-1.2s"></i><i style="--rain-index:9;--rain-x:86%;--rain-delay:-4.6s"></i><i style="--rain-index:10;--rain-x:93%;--rain-delay:-2.8s"></i><i style="--rain-index:11;--rain-x:97%;--rain-delay:-0.3s"></i>
                    </div>
                    <span class="phoen-voice-seam" aria-hidden="true"></span>
                    <header class="phoen-status">
                        <time class="phoen-status__time" data-role="clock"></time>
                        <span class="phoen-dynamic-island" aria-hidden="true"><i></i><b></b></span>
                        <span class="phoen-status__signals" aria-label="网络与电量">
                            <span>4G</span>${icon('wifi')}<span>80%</span>${icon('battery')}
                        </span>
                    </header>
                    <div class="phoen-header">
                        <div>
                            <p class="phoen-header__eyebrow" data-role="eyebrow">Private channel</p>
                            <h1 class="phoen-header__title" data-role="title">Phoen</h1>
                        </div>
                        <div class="phoen-header__actions">
                            <button class="phoen-icon-button phoen-icon-button--raised phoen-back-button" type="button" data-action="navigate" data-target-screen="home" aria-label="返回桌面">
                                ${icon('back')}
                            </button>
                            <button class="phoen-icon-button phoen-icon-button--raised phoen-header-call" type="button" data-action="start-call" aria-label="拨打电话">
                                ${icon('phone')}
                            </button>
                            <button class="phoen-icon-button" type="button" data-action="close" aria-label="收起 Phoen">
                                ${icon('close')}
                            </button>
                        </div>
                    </div>
                    <main class="phoen-screen-stack">
                        ${homeScreenMarkup()}
                        <section class="phoen-screen" data-screen="chat" aria-label="私人消息">
                            <div class="phoen-chat-list" data-role="message-list"></div>
                            <div class="phoen-generating" data-role="generating" hidden>
                                <span class="phoen-generating__line" aria-hidden="true"></span>
                                <span>对方正在组织语言</span>
                            </div>
                            <form class="phoen-composer" data-form="chat">
                                <button class="phoen-icon-button phoen-icon-button--raised" type="button" data-action="send-voice" aria-label="发送语音消息">
                                    ${icon('wave')}
                                </button>
                                <textarea rows="1" maxlength="1600" data-role="chat-input" placeholder="写一条私人消息" aria-label="私人消息内容"></textarea>
                                <button class="phoen-icon-button phoen-icon-button--raised" type="submit" aria-label="发送消息">
                                    ${icon('send')}
                                </button>
                            </form>
                        </section>
                        <section class="phoen-screen" data-screen="call" aria-label="电话">
                            <div class="phoen-call-screen">
                                <div class="phoen-contact-mark" data-role="call-initials">P</div>
                                <div class="phoen-call-identity">
                                    <h2 data-role="call-contact">Character</h2>
                                    <p class="phoen-call-status" data-role="call-status">等待拨号</p>
                                </div>
                                <div class="phoen-call-captions" data-role="call-captions" data-empty="true">
                                    <span data-role="call-empty">接通后，原文和译文会显示在这里</span>
                                    <div data-role="call-caption-content" hidden>
                                        <p class="phoen-call-caption-source" data-role="call-caption-source"></p>
                                        <p class="phoen-call-caption-translation" data-role="call-caption-translation"></p>
                                    </div>
                                </div>
                                <div class="phoen-call-idle-action" data-role="call-idle-action">
                                    <button class="phoen-button" type="button" data-action="start-call">开始通话</button>
                                </div>
                                <form class="phoen-call-controls" data-form="call" hidden>
                                    <input type="text" maxlength="1200" data-role="call-input" placeholder="输入这一轮要说的话" aria-label="通话输入">
                                    <button class="phoen-call-primary" type="submit" data-action="call-send" aria-label="发送这一轮">
                                        ${icon('send')}
                                    </button>
                                </form>
                                <button class="phoen-call-end" type="button" data-action="end-call" hidden aria-label="挂断电话">
                                    ${icon('end-call')}
                                    <span>挂断</span>
                                </button>
                            </div>
                        </section>
                        ${auxiliaryScreensMarkup()}
                        ${systemSettingsScreensMarkup()}
                        <section class="phoen-screen" data-screen="settings" aria-label="设置">
                            ${this.#settingsMarkup()}
                        </section>
                    </main>
                    ${dockMarkup()}
                    <div class="phoen-home-indicator" aria-hidden="true"></div>
                    <div class="phoen-toast" data-role="toast" role="status" aria-live="polite"></div>
                </div>
            </section>`;

        document.body.append(root);
        this.#root = root;
        this.#bindEvents();
        this.#mountSettingsLauncher();
        this.#unsubscribe = this.#store.subscribe((state) => this.render(state));
        this.#clockTimer = window.setInterval(() => this.#renderClocks(), 1000);
        this.render(this.#store.getState());
    }

    #settingsMarkup() {
        return `
            <div class="phoen-settings-list">
                <section class="phoen-settings-section">
                    <h2 class="phoen-settings-section__title">外观</h2>
                    <div class="phoen-settings-card">
                        ${this.#selectRow('主题', '日间、夜间或跟随酒馆', 'theme', [
                            [THEMES.DAY, '日间'],
                            [THEMES.NIGHT, '夜间'],
                            [THEMES.TAVERN, '跟随酒馆'],
                        ])}
                        ${this.#switchRow('显示中文译文', '原文始终保留为主文本', 'showTranslation')}
                    </div>
                </section>
                <section class="phoen-settings-section">
                    <h2 class="phoen-settings-section__title">语言</h2>
                    <div class="phoen-settings-card">
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
                        ${this.#switchRow('自动翻译', '正文没有译文时调用酒馆翻译模块', 'autoTranslate')}
                    </div>
                </section>
                <section class="phoen-settings-section">
                    <h2 class="phoen-settings-section__title">语音与连续性</h2>
                    <div class="phoen-settings-card">
                        <div class="phoen-setting-row">
                            <span>
                                <span class="phoen-setting-label">当前语音提供商</span>
                                <span class="phoen-setting-description">第一版跟随酒馆 TTS 与角色声线映射</span>
                            </span>
                            <span class="phoen-provider-chip" data-role="provider-chip"></span>
                        </div>
                        ${this.#switchRow('正文播放器', '在角色消息下方附加双语播放器', 'autoDecorateMessages')}
                        ${this.#switchRow('自动播放手机回复', '电话始终自动播放角色语音', 'autoPlayPhoneReplies')}
                        ${this.#switchRow('注入通信连续性', '只注入最近事件的短摘要', 'injectContinuity')}
                    </div>
                </section>
                <section class="phoen-settings-section">
                    <h2 class="phoen-settings-section__title">本地数据</h2>
                    <div class="phoen-settings-card">
                        <div class="phoen-setting-row">
                            <span>
                                <span class="phoen-setting-label">清除音频缓存</span>
                                <span class="phoen-setting-description">聊天文字和通话记录不会被删除</span>
                            </span>
                            <button class="phoen-icon-button" type="button" data-action="clear-cache" aria-label="清除音频缓存">${icon('trash')}</button>
                        </div>
                    </div>
                </section>
            </div>`;
    }

    #switchRow(label, description, key) {
        return `
            <label class="phoen-setting-row">
                <span>
                    <span class="phoen-setting-label">${escapeHtml(label)}</span>
                    <span class="phoen-setting-description">${escapeHtml(description)}</span>
                </span>
                <span class="phoen-switch">
                    <input type="checkbox" data-setting="${escapeHtml(key)}">
                    <span class="phoen-switch__track" aria-hidden="true"></span>
                </span>
            </label>`;
    }

    #selectRow(label, description, key, values) {
        const options = values.map(([value, text]) => `<option value="${escapeHtml(value)}">${escapeHtml(text)}</option>`).join('');
        return `
            <label class="phoen-setting-row">
                <span>
                    <span class="phoen-setting-label">${escapeHtml(label)}</span>
                    <span class="phoen-setting-description">${escapeHtml(description)}</span>
                </span>
                <select class="phoen-setting-select" data-setting="${escapeHtml(key)}">${options}</select>
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
        if (document.getElementById('phoen-settings-launcher')) return;
        const launcher = document.createElement('div');
        launcher.id = 'phoen-settings-launcher';
        launcher.className = 'phoen-settings-launcher';
        launcher.innerHTML = `
            <p class="phoen-settings-launcher__title">Phoen Voice Phone</p>
            <p class="phoen-settings-launcher__description">双语正文语音、私人消息与电话。</p>
            <button class="menu_button" type="button">打开手机设置</button>`;
        launcher.querySelector('button')?.addEventListener('click', () => {
            this.#actions.open?.();
            this.#actions.navigate?.(SCREENS.SETTINGS);
        });
        container.append(launcher);
        this.#launcher = launcher;
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
            } else if (action === 'end-call') {
                this.#actions.endCall?.();
            } else if (action === 'clear-cache') {
                this.#actions.clearCache?.();
            } else if (action === 'play-phone-audio') {
                this.#actions.playPhoneAudio?.(target.dataset.messageId);
            } else if (action === 'set-generation-profile') {
                this.#actions.updateSetting?.('generationProfileId', target.dataset.profileId || '');
            } else if (action === 'reset-prompt-preset') {
                this.#actions.updatePromptPreset?.(normalizePhonePromptPreset(DEFAULT_PHONE_PROMPT_PRESET));
            } else if (action === 'add-prompt-entry') {
                this.#actions.updatePromptPreset?.(addPhonePromptEntry(this.#store.getState().settings.promptPreset));
            } else if (action === 'move-prompt-entry') {
                const entryId = target.closest('[data-prompt-entry-id]')?.dataset.promptEntryId;
                if (entryId) this.#actions.updatePromptPreset?.(movePhonePromptEntry(this.#store.getState().settings.promptPreset, entryId, target.dataset.direction));
            } else if (action === 'delete-prompt-entry') {
                const entryId = target.closest('[data-prompt-entry-id]')?.dataset.promptEntryId;
                if (entryId) this.#actions.updatePromptPreset?.(removePhonePromptEntry(this.#store.getState().settings.promptPreset, entryId));
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
            const presetField = target.dataset.promptPresetField;
            if (presetField) {
                const preset = normalizePhonePromptPreset(this.#store.getState().settings.promptPreset);
                this.#actions.updatePromptPreset?.(normalizePhonePromptPreset({ ...preset, [presetField]: value }));
                return;
            }
            const entryField = target.dataset.promptEntryField;
            if (entryField) {
                const entryId = target.closest('[data-prompt-entry-id]')?.dataset.promptEntryId;
                if (entryId) {
                    const preset = updatePhonePromptEntry(this.#store.getState().settings.promptPreset, entryId, { [entryField]: value });
                    this.#actions.updatePromptPreset?.(preset);
                }
                return;
            }
            const key = target.dataset.setting;
            if (key) this.#actions.updateSetting?.(key, value);
        });

        const orb = this.#root.querySelector('.phoen-orb');
        orb?.addEventListener('pointerdown', (event) => this.#startOrbDrag(event));
    }

    #startOrbDrag(event) {
        if (event.button !== 0 || event.isPrimary === false) return;
        const orb = event.currentTarget;
        if (!(orb instanceof HTMLElement)) return;
        try {
            orb.setPointerCapture?.(event.pointerId);
        } catch (error) {
            console.debug('[Phoen] Pointer capture unavailable; continuing with click fallback.', error);
        }
        this.#drag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
        };
        const move = (moveEvent) => this.#moveOrb(moveEvent);
        const end = (endEvent) => {
            orb.removeEventListener('pointermove', move);
            orb.removeEventListener('pointerup', end);
            orb.removeEventListener('pointercancel', end);
            this.#endOrbDrag(endEvent);
        };
        orb.addEventListener('pointermove', move);
        orb.addEventListener('pointerup', end);
        orb.addEventListener('pointercancel', end);
    }

    #moveOrb(event) {
        if (!this.#drag || this.#drag.pointerId !== event.pointerId) return;
        this.#drag = updateOrbDrag(this.#drag, event.clientX, event.clientY);
        if (!this.#drag.moved) return;
        const y = clamp(event.clientY / window.innerHeight, 0.07, 0.9);
        this.#root.style.setProperty('--phoen-orb-y', `${y * 100}%`);
    }

    #endOrbDrag(event) {
        if (!this.#drag) return;
        const drag = this.#drag;
        const shouldOpen = isOrbTap(drag, event.type);
        if (drag.moved && event.type === 'pointerup') {
            const dockSide = event.clientX < window.innerWidth / 2 ? 'left' : 'right';
            const dockY = clamp(event.clientY / window.innerHeight, 0.07, 0.9);
            this.#suppressOrbClick = true;
            window.setTimeout(() => { this.#suppressOrbClick = false; }, 0);
            this.#actions.updateDock?.({ dockSide, dockY });
        }
        this.#drag = null;
        if (shouldOpen) {
            this.#suppressOrbClick = true;
            this.#actions.open?.();
            window.setTimeout(() => { this.#suppressOrbClick = false; }, 0);
        }
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
        this.#root.style.setProperty('--phoen-orb-y', `${clamp(state.settings.dockY, 0.07, 0.9) * 100}%`);

        const phone = this.#root.querySelector('.phoen-phone');
        phone?.setAttribute('aria-hidden', String(!state.open));
        const orb = this.#root.querySelector('.phoen-orb');
        orb?.setAttribute('aria-expanded', String(Boolean(state.open)));
        this.#setText('[data-role="provider"]', state.providerLabel);
        this.#setText('[data-role="provider-chip"]', state.providerLabel);
        const screenCopy = SCREEN_COPY[state.screen] || SCREEN_COPY[SCREENS.HOME];
        this.#setText('[data-role="title"]', state.screen === SCREENS.CHAT ? state.contact.name : screenCopy.title);
        this.#setText('[data-role="eyebrow"]', screenCopy.eyebrow);

        for (const screen of this.#root.querySelectorAll('[data-screen]')) {
            screen.dataset.active = String(screen.dataset.screen === state.screen);
        }
        for (const tab of this.#root.querySelectorAll('.phoen-dock-button[data-target-screen]')) {
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
        this.#renderClocks();
        this.#renderToast(state.toast);
    }

    #renderMessages(state) {
        const list = this.#root.querySelector('[data-role="message-list"]');
        if (!list) return;
        if (state.messages.length === 0) {
            list.innerHTML = `
                <div class="phoen-chat-empty">
                    <div class="phoen-chat-empty__mark">${icon('message')}</div>
                    <h2 class="phoen-chat-empty__title">一条安静的私人频道</h2>
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
        this.#setText('[data-role="call-status"]', callStatusLabel(state.callState, this.#elapsed(state.callStartedAt)));

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
        const callForm = this.#root.querySelector('[data-form="call"]');
        const idleAction = this.#root.querySelector('[data-role="call-idle-action"]');
        const endButton = this.#root.querySelector('[data-action="end-call"]');
        if (callForm) callForm.hidden = !active;
        if (idleAction) idleAction.hidden = active;
        if (endButton) endButton.hidden = !active;

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
        const list = this.#root.querySelector('[data-role="voice-library"]');
        if (!list) return;
        const voices = state.messages.filter((message) => message.kind === MESSAGE_KINDS.VOICE).slice(-8).reverse();
        if (!voices.length) {
            list.innerHTML = '<div class="phoen-record-empty">发送或播放语音后，声线片段会出现在这里。</div>';
            return;
        }
        list.innerHTML = voices.map((message) => `
            <article class="phoen-record-card">
                <button class="phoen-record-card__play" type="button" data-action="play-phone-audio" data-message-id="${escapeHtml(message.id)}" aria-label="播放语音片段">${icon(message.isPlaying ? 'pause' : 'play')}</button>
                <span class="phoen-record-card__copy"><strong>${escapeHtml(message.author)}</strong><small>${escapeHtml(message.originalText.slice(0, 54) || '无文字片段')}</small></span>
                <time>${escapeHtml(message.durationLabel || formatRecordDate(message.createdAt))}</time>
            </article>`).join('');
    }

    #renderTrace(state) {
        const list = this.#root.querySelector('[data-role="trace-list"]');
        if (!list) return;
        const records = state.calls.slice(-8).reverse();
        if (!records.length) {
            list.innerHTML = '<div class="phoen-record-empty">接通第一通电话后，这里会留下时间、时长和简短摘要。</div>';
            return;
        }
        list.innerHTML = records.map((record) => `
            <article class="phoen-record-card phoen-record-card--call">
                <span class="phoen-record-card__play" aria-hidden="true">${icon('phone')}</span>
                <span class="phoen-record-card__copy"><strong>${escapeHtml(record.contactName || state.contact.name)}</strong><small>${escapeHtml(record.summary || '通话已结束')}</small></span>
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
    }

    #renderModelSettings(state) {
        const target = state.generationTarget || { name: '跟随酒馆', model: '当前模型', api: 'current' };
        this.#setText('[data-role="generation-target"]', target.name);
        this.#setText('[data-role="generation-model"]', `${target.model || '当前模型'} · ${target.api || 'current'}`);
        this.#setText('[data-role="model-tts-provider"]', state.providerLabel);

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
        const choices = [{ id: '', name: '跟随酒馆', model: '自动使用当前模型', api: 'current' }, ...profiles];
        list.innerHTML = choices.map((profile) => {
            const current = (state.settings.generationProfileId || '') === profile.id;
            return `<button class="phoen-profile-card${current ? ' is-current' : ''}" type="button" data-action="set-generation-profile" data-profile-id="${escapeHtml(profile.id)}" aria-pressed="${current}">
                <span class="phoen-profile-card__mark">${icon('signal')}</span>
                <span><strong>${escapeHtml(profile.name)}</strong><small>${escapeHtml(profile.model || '当前模型')} · ${escapeHtml(profile.api || 'current')}</small></span>
                <b>${current ? '当前' : '选择'}</b>
            </button>`;
        }).join('');
    }

    #renderPromptPreset(state) {
        const preset = normalizePhonePromptPreset(state.settings.promptPreset);
        const name = this.#root.querySelector('[data-prompt-preset-field="name"]');
        const depth = this.#root.querySelector('[data-prompt-preset-field="insertionDepth"]');
        if (name instanceof HTMLInputElement) name.value = preset.name;
        if (depth instanceof HTMLInputElement) depth.value = String(preset.insertionDepth);
        const list = this.#root.querySelector('[data-role="prompt-entry-list"]');
        if (list) list.innerHTML = preset.entries.map((entry, index) => promptEntryMarkup(entry, index, preset.entries.length)).join('');
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
            this.#setText('[data-role="call-status"]', callStatusLabel(state.callState, this.#elapsed(state.callStartedAt)));
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
        this.#launcher?.remove();
        this.#root?.remove();
        this.#root = null;
    }
}
