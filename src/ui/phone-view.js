import { CALL_STATES, MESSAGE_KINDS, SCREENS, THEMES } from '../core/constants.js';
import { clamp, escapeHtml, formatClock, icon, initials } from './dom.js';

const ACTIVE_CALL_STATES = new Set([
    CALL_STATES.DIALING,
    CALL_STATES.RINGING,
    CALL_STATES.CONNECTED,
    CALL_STATES.GENERATING,
    CALL_STATES.SPEAKING,
]);

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
            <section class="phoen-phone" id="phoen-phone" aria-label="Phoen 语音手机" aria-hidden="true">
                <div class="phoen-frame">
                    <span class="phoen-voice-seam" aria-hidden="true"></span>
                    <header class="phoen-status">
                        <time class="phoen-status__time" data-role="clock"></time>
                        <span class="phoen-status__speaker" aria-hidden="true"></span>
                        <span class="phoen-status__provider" data-role="provider"></span>
                    </header>
                    <div class="phoen-header">
                        <div>
                            <p class="phoen-header__eyebrow" data-role="eyebrow">Private channel</p>
                            <h1 class="phoen-header__title" data-role="title">Phoen</h1>
                        </div>
                        <div class="phoen-header__actions">
                            <button class="phoen-icon-button phoen-icon-button--raised" type="button" data-action="start-call" aria-label="拨打电话">
                                ${icon('phone')}
                            </button>
                            <button class="phoen-icon-button" type="button" data-action="close" aria-label="收起 Phoen">
                                ${icon('close')}
                            </button>
                        </div>
                    </div>
                    <main class="phoen-screen-stack">
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
                        <section class="phoen-screen" data-screen="settings" aria-label="设置">
                            ${this.#settingsMarkup()}
                        </section>
                    </main>
                    <nav class="phoen-tabbar" aria-label="Phoen 主导航">
                        <button class="phoen-tab" type="button" data-action="navigate" data-target-screen="chat" role="tab">
                            ${icon('message')}<span>消息</span>
                        </button>
                        <button class="phoen-tab" type="button" data-action="navigate" data-target-screen="call" role="tab">
                            ${icon('phone')}<span>通话</span>
                        </button>
                        <button class="phoen-tab" type="button" data-action="navigate" data-target-screen="settings" role="tab">
                            ${icon('settings')}<span>设置</span>
                        </button>
                    </nav>
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
            const target = event.target.closest('[data-action]');
            if (!(target instanceof HTMLElement)) return;
            const action = target.dataset.action;

            if (action === 'open') {
                if (this.#suppressOrbClick) return;
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
            if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
            const key = target.dataset.setting;
            if (!key) return;
            const value = target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value;
            this.#actions.updateSetting?.(key, value);
        });

        const orb = this.#root.querySelector('.phoen-orb');
        orb?.addEventListener('pointerdown', (event) => this.#startOrbDrag(event));
    }

    #startOrbDrag(event) {
        if (event.button !== 0) return;
        const orb = event.currentTarget;
        if (!(orb instanceof HTMLElement)) return;
        orb.setPointerCapture(event.pointerId);
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
        const distance = Math.hypot(event.clientX - this.#drag.startX, event.clientY - this.#drag.startY);
        if (distance > 5) this.#drag.moved = true;
        if (!this.#drag.moved) return;
        const y = clamp(event.clientY / window.innerHeight, 0.07, 0.9);
        this.#root.style.setProperty('--phoen-orb-y', `${y * 100}%`);
    }

    #endOrbDrag(event) {
        if (!this.#drag) return;
        if (this.#drag.moved) {
            const dockSide = event.clientX < window.innerWidth / 2 ? 'left' : 'right';
            const dockY = clamp(event.clientY / window.innerHeight, 0.07, 0.9);
            this.#suppressOrbClick = true;
            window.setTimeout(() => { this.#suppressOrbClick = false; }, 0);
            this.#actions.updateDock?.({ dockSide, dockY });
        }
        this.#drag = null;
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
        this.#root.dataset.audioState = state.audioState || 'idle';
        this.#root.style.setProperty('--phoen-orb-y', `${clamp(state.settings.dockY, 0.07, 0.9) * 100}%`);

        const phone = this.#root.querySelector('.phoen-phone');
        phone?.setAttribute('aria-hidden', String(!state.open));
        this.#setText('[data-role="provider"]', state.providerLabel);
        this.#setText('[data-role="provider-chip"]', state.providerLabel);
        this.#setText('[data-role="title"]', state.screen === SCREENS.CHAT ? state.contact.name : state.screen === SCREENS.CALL ? '电话' : 'Phoen');
        this.#setText('[data-role="eyebrow"]', state.screen === SCREENS.SETTINGS ? 'Voice system' : 'Private channel');

        for (const screen of this.#root.querySelectorAll('[data-screen]')) {
            screen.dataset.active = String(screen.dataset.screen === state.screen);
        }
        for (const tab of this.#root.querySelectorAll('[data-target-screen]')) {
            tab.setAttribute('aria-selected', String(tab.dataset.targetScreen === state.screen));
        }

        const unread = this.#root.querySelector('[data-role="unread"]');
        if (unread) {
            unread.hidden = !state.unread;
            unread.textContent = state.unread > 99 ? '99' : String(state.unread || '');
        }

        this.#renderMessages(state);
        this.#renderCall(state);
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

    #renderSettings(state) {
        for (const control of this.#root.querySelectorAll('[data-setting]')) {
            const value = state.settings[control.dataset.setting];
            if (control instanceof HTMLInputElement && control.type === 'checkbox') {
                control.checked = Boolean(value);
            } else if (control instanceof HTMLSelectElement) {
                control.value = String(value);
            }
        }
    }

    #renderClocks() {
        this.#setText('[data-role="clock"]', formatClock());
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
