import { CALL_STATES, MESSAGE_KINDS, SCREENS, THEMES } from '../core/constants.js';
import {
    DEFAULT_CALL_PROMPT_PRESET,
    DEFAULT_CHAT_PROMPT_PRESET,
    addPhonePromptEntry,
    movePhonePromptEntry,
    normalizePhonePromptPreset,
    removePhonePromptEntry,
    updatePhonePromptEntry,
} from '../dialogue/prompt-preset.js';
import { DEFAULT_BODY_PROMPT_PRESET } from '../dialogue/body-speech.js';
import { clamp, escapeHtml, formatClock, icon, initials } from './dom.js';
import { AudioActionMenu } from './audio-action-menu.js';
import { auxiliaryScreensMarkup, dockMarkup, homeScreenMarkup } from './phone-home.js';
import { getOrbDockTargetFromRect, getOrbTop, isOrbTap, shouldStartOrbDrag, updateOrbDrag } from './orb-gesture.js';
import { promptEntryMarkup, systemSettingsScreensMarkup } from './system-settings.js';

const ACTIVE_CALL_STATES = new Set([
    CALL_STATES.DIALING,
    CALL_STATES.RINGING,
    CALL_STATES.CONNECTED,
    CALL_STATES.GENERATING,
    CALL_STATES.SPEAKING,
]);

const LANGUAGE_OPTIONS = Object.freeze([
    ['ja-JP', '日本語'],
    ['zh-CN', '简体中文'],
    ['zh-TW', '繁體中文'],
    ['en-US', 'English'],
    ['ko-KR', '한국어'],
    ['yue-HK', '粤语'],
    ['de-DE', 'Deutsch'],
    ['fr-FR', 'Français'],
    ['es-ES', 'Español'],
]);

const SCREEN_COPY = Object.freeze({
    [SCREENS.HOME]: { title: 'Phonie', eyebrow: 'Resonance OS' },
    [SCREENS.CHAT]: { title: '', eyebrow: '私人频道' },
    [SCREENS.CALL]: { title: '电话', eyebrow: '实时声线' },
    [SCREENS.VOICE]: { title: '声线', eyebrow: '语音资料库' },
    [SCREENS.PROVIDER]: { title: '语音引擎', eyebrow: '供应商配置' },
    [SCREENS.TRACE]: { title: '轨迹', eyebrow: '通话记录' },
    [SCREENS.CHARACTER]: { title: '通讯录', eyebrow: '联系人与声线' },
    [SCREENS.MODEL]: { title: '模型', eyebrow: '生成连接' },
    [SCREENS.PROMPTS]: { title: '提示词', eyebrow: '消息编排' },
    [SCREENS.GUIDE]: { title: '说明', eyebrow: 'Phonie 指南' },
    [SCREENS.NOVELAI]: { title: '绘图', eyebrow: 'NovelAI Diffusion' },
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

function setImageSource(element, url) {
    if (!(element instanceof HTMLImageElement)) return;
    const container = element.closest('.phonie-wallpaper');
    if (!url) {
        element.removeAttribute('src');
        element.hidden = true;
        if (container) container.dataset.hasImage = 'false';
        return;
    }
    element.src = String(url);
    element.hidden = false;
    if (container) container.dataset.hasImage = 'true';
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

function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024 * 1024) return (value / 1024).toFixed(value < 10240 ? 1 : 0) + ' KB';
    return (value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 2 : 1) + ' MB';
}

function callStatusLabel(state, elapsed = '', direction = '') {
    const labels = {
        [CALL_STATES.IDLE]: '等待拨号',
        [CALL_STATES.DIALING]: '正在拨号',
        [CALL_STATES.RINGING]: direction === 'incoming' ? '角色来电' : '等待接听',
        [CALL_STATES.CONNECTED]: elapsed ? `通话中  ${elapsed}` : '通话中',
        [CALL_STATES.GENERATING]: '正在组织语言',
        [CALL_STATES.SPEAKING]: elapsed ? `通话中  ${elapsed}` : '通话中',
        [CALL_STATES.ENDED]: '通话已结束',
        [CALL_STATES.ERROR]: '通话连接异常',
    };
    return labels[state] || labels[CALL_STATES.IDLE];
}

function makeWaveBars(seed = '', count = 18) {
    const text = String(seed || 'phonie');
    return Array.from({ length: count }, (_, index) => {
        const code = text.charCodeAt(index % text.length) || 80;
        const height = 26 + ((code * (index + 3)) % 68);
        return `<i style="--bar-height:${height}%;--bar-live:var(--phonie-audio-bar-${index % 18},.18)"></i>`;
    }).join('');
}

function callDialPadMarkup() {
    const letters = { 2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ' };
    return ['1','2','3','4','5','6','7','8','9','*','0','#']
        .map((digit) => `<button type='button' data-action='call-digit' data-digit='${digit}'><b>${digit}</b><small>${letters[digit] || (digit === '0' ? '+' : '')}</small></button>`)
        .join('');
}

function contactNumber(identity = '') {
    let hash = 2166136261;
    for (const character of String(identity)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    const digits = String(Math.abs(hash >>> 0)).padStart(10, '0').slice(0, 10);
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

function renderMessage(message, showTranslation, state) {
    const outgoing = message.direction === 'outgoing';
    const recalled = message.kind === MESSAGE_KINDS.RECALLED;
    const translation = showTranslation && message.translationText
        ? `<p class="phonie-message__translation" lang="zh-CN">${escapeHtml(message.translationText)}</p>`
        : '';
    const avatarUrl = outgoing ? '' : state.contact?.avatarUrl;
    const avatarName = outgoing ? state.userName : state.contact?.name;
    const avatarStyle = avatarUrl ? ` style="background-image:url('${escapeHtml(avatarUrl)}')"` : '';
    const quote = message.replySnapshot
        ? `<blockquote class="phonie-message__quote"><strong>${escapeHtml(message.replySnapshot.sender || '消息')}</strong><span>${escapeHtml(message.replySnapshot.content || '原消息已撤回')}</span></blockquote>`
        : '';
    let body = `<p class="phonie-message__source" lang="${escapeHtml(message.language || '')}">${escapeHtml(message.originalText)}</p>${translation}`;
    if (message.kind === MESSAGE_KINDS.VOICE) {
        body = `
            <div class="phonie-message__voice">
                <button class="phonie-voice-action" type="button" data-action="play-phone-audio" data-message-id="${escapeHtml(message.id)}" aria-label="播放这条语音消息">
                    ${icon(message.isPlaying ? 'pause' : 'play')}
                </button>
                <span class="phonie-message__waveform" aria-hidden="true">${makeWaveBars(message.id)}</span>
                <span class="phonie-message__duration">${escapeHtml(message.durationLabel || '--:--')}</span>
            </div>
            <details class="phonie-message__transcript">
                <summary>查看文字与译文</summary>
                <p class="phonie-message__source" lang="${escapeHtml(message.language || '')}">${escapeHtml(message.originalText)}</p>
                ${translation}
            </details>`;
    } else if (message.kind === MESSAGE_KINDS.IMAGE) {
        body = message.imageUrl
            ? `<figure class="phonie-message__generated-image"><img src="${escapeHtml(message.imageUrl)}" alt="${escapeHtml(message.description || message.attachmentName || '聊天图片')}"><figcaption>${escapeHtml(message.attachmentName || '图片')}</figcaption></figure>`
            : `<div class="phonie-message__image-card">${icon('image')}<span><strong>图片</strong><small>${escapeHtml(message.attachmentName || message.originalText || '模拟图片')}</small></span></div>`;
    } else if ([MESSAGE_KINDS.TRANSFER, MESSAGE_KINDS.RED_PACKET].includes(message.kind)) {
        const title = message.kind === MESSAGE_KINDS.TRANSFER ? '转账' : '红包';
        const mark = message.kind === MESSAGE_KINDS.TRANSFER ? 'wallet' : 'gift';
        body = `<div class="phonie-message__money-card" data-money-kind="${escapeHtml(message.kind)}">${icon(mark)}<span><small>${title}</small><strong>¥ ${Number(message.amount || 0).toFixed(2)}</strong><i>${escapeHtml(message.note || '请查收')}</i></span></div>`;
    } else if (recalled) {
        body = `<p class="phonie-message__recalled">${escapeHtml(message.originalText)}</p>`;
    }

    const messageActions = recalled ? '' : `
        <span class="phonie-message__actions">
            <button type="button" data-action="quote-phone-message" data-message-id="${escapeHtml(message.id)}" aria-label="引用这条消息">${icon('quote')}</button>
            ${outgoing ? `<button type="button" data-action="recall-phone-message" data-message-id="${escapeHtml(message.id)}" aria-label="撤回这条消息">${icon('recall')}</button>` : ''}
        </span>`;

    return `
        <article class="phonie-message ${outgoing ? 'phonie-message--outgoing' : ''}${recalled ? ' phonie-message--recalled' : ''}" data-phone-message-id="${escapeHtml(message.id)}">
            <span class="phonie-message__avatar"${avatarStyle}><b>${escapeHtml(initials(avatarName))}</b></span>
            <div class="phonie-message__content">
                <div class="phonie-message__meta">
                    <span>${escapeHtml(message.author)}</span>
                    <time datetime="${new Date(message.createdAt).toISOString()}">${messageTime(message.createdAt)}</time>
                    ${messageActions}
                </div>
                <div class="phonie-message__bubble">
                    ${quote}
                    ${body}
                </div>
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
    #orb = null;
    #launcher = null;
    #wandLauncher = null;
    #unsubscribe = null;
    #clockTimer = null;
    #toastTimer = null;
    #drag = null;
    #suppressOrbClick = false;
    #orbMoveHandler = null;
    #orbEndHandler = null;
    #orbWakeTimer = null;
    #resizeHandler = null;
    #characterProviderDraft = null;
    #messageSignature = '';
    #quotedMessageId = null;
    #chatToolMode = null;
    #audioMenu = new AudioActionMenu();

    constructor({ store, actions }) {
        this.#store = store;
        this.#actions = actions;
    }

    mount() {
        if (document.getElementById('phonie-root') || document.getElementById('phonie-orb')) return;

        const root = document.createElement('div');
        root.id = 'phonie-root';
        root.className = 'phonie-root';
        root.dataset.open = 'false';
        root.innerHTML = `
            <div class="phonie-scrim" data-action="close" aria-hidden="true"></div>
            <section class="phonie-phone" id="phonie-phone" aria-label="Phonie 声纹手机" aria-hidden="true">
                <span class="phonie-hardware-key phonie-hardware-key--volume" aria-hidden="true"></span>
                <span class="phonie-hardware-key phonie-hardware-key--power" aria-hidden="true"></span>
                <div class="phonie-frame">
                    <div class="phonie-wallpaper" data-role="wallpaper" aria-hidden="true"><img class="phonie-wallpaper__image" data-role="wallpaper-image" alt="" hidden></div>
                    <div class="phonie-wallpaper-veil" aria-hidden="true"></div>
                    <div class="phonie-rain-curtain" aria-hidden="true">
                        <i style="--rain-index:0;--rain-x:5%;--rain-delay:-0.1s"></i><i style="--rain-index:1;--rain-x:14%;--rain-delay:-1.7s"></i><i style="--rain-index:2;--rain-x:23%;--rain-delay:-3.1s"></i><i style="--rain-index:3;--rain-x:32%;--rain-delay:-0.9s"></i><i style="--rain-index:4;--rain-x:41%;--rain-delay:-4.2s"></i><i style="--rain-index:5;--rain-x:50%;--rain-delay:-2.4s"></i><i style="--rain-index:6;--rain-x:59%;--rain-delay:-0.5s"></i><i style="--rain-index:7;--rain-x:68%;--rain-delay:-3.6s"></i><i style="--rain-index:8;--rain-x:77%;--rain-delay:-1.2s"></i><i style="--rain-index:9;--rain-x:86%;--rain-delay:-4.6s"></i><i style="--rain-index:10;--rain-x:93%;--rain-delay:-2.8s"></i><i style="--rain-index:11;--rain-x:97%;--rain-delay:-0.3s"></i>
                    </div>
                    <span class="phonie-voice-seam" aria-hidden="true"></span>
                    <header class="phonie-status">
                        <time class="phonie-status__time" data-role="clock"></time>
                        <span class="phonie-dynamic-island" data-role="dynamic-island" data-state="idle" aria-live="polite">
                            <span class="phonie-dynamic-island__label" data-role="dynamic-island-label"></span>
                            <span class="phonie-dynamic-island__wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
                            <b class="phonie-dynamic-island__sensor" aria-hidden="true"></b>
                        </span>
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
                            <header class="phonie-chat-appbar">
                                <span class="phonie-chat-appbar__avatar" data-role="chat-contact-avatar"><b data-role="chat-contact-initials">P</b></span>
                                <span class="phonie-chat-appbar__identity"><strong data-role="chat-contact-name">Character</strong><small>私人频道 · 在线</small></span>
                                <span class="phonie-chat-appbar__actions">
                                    <button class="phonie-icon-button" type="button" data-action="open-chat-settings" aria-label="打开私信设置">${icon('settings')}</button>
                                </span>
                            </header>
                            <div class="phonie-chat-list" data-role="message-list"></div>
                            <div class="phonie-generating" data-role="generating" hidden>
                                <span class="phonie-generating__line" aria-hidden="true"></span>
                                <span>对方正在组织语言</span>
                            </div>
                            <div class="phonie-reply-composer" data-role="reply-composer" hidden>
                                <span>${icon('quote')}<span><small>正在引用</small><strong data-role="reply-composer-text"></strong></span></span>
                                <button type="button" data-action="cancel-phone-quote" aria-label="取消引用">${icon('close')}</button>
                            </div>
                            <div class="phonie-chat-tools" data-role="chat-tools" hidden>
                                <button type="button" data-action="choose-chat-image">${icon('image')}<span>图片</span></button>
                                <button type="button" data-action="navigate" data-target-screen="${SCREENS.NOVELAI}">${icon('spark')}<span>AI 图片</span></button>
                                <button type="button" data-action="open-chat-action" data-chat-kind="transfer">${icon('wallet')}<span>转账</span></button>
                                <button type="button" data-action="open-chat-action" data-chat-kind="red_packet">${icon('gift')}<span>红包</span></button>
                                <button type="button" data-action="send-voice">${icon('wave')}<span>语音</span></button>
                                <button type="button" data-action="start-call">${icon('phone')}<span>电话</span></button>
                            </div>
                            <div class="phonie-chat-action-sheet" data-role="chat-action-sheet" hidden>
                                <header><strong data-role="chat-action-title">转账</strong><button type="button" data-action="close-chat-action" aria-label="关闭">${icon('close')}</button></header>
                                <label><span>金额</span><input type="number" min="0.01" max="999999" step="0.01" inputmode="decimal" data-role="chat-action-amount" placeholder="0.00"></label>
                                <label><span>备注</span><input type="text" maxlength="80" data-role="chat-action-note" placeholder="写一句话"></label>
                                <button type="button" data-action="send-chat-action">发送</button>
                            </div>
                            <aside class="phonie-chat-settings-sheet" data-role="chat-settings-sheet" hidden>
                                <header><strong>聊天设置</strong><button type="button" data-action="close-chat-settings" aria-label="关闭">${icon('close')}</button></header>
                                <div><button type="button" data-action="open-chat-preset">${icon('layers')}<span><strong>聊天预设</strong></span>${icon('chevron')}</button></div>
                                <div><button type="button" data-action="clear-chat-history">${icon('reset')}<span><strong>清空聊天记录</strong></span></button></div>
                                <div><button class="phonie-danger-action" type="button" data-action="delete-chat-conversation">${icon('trash')}<span><strong>删除这个会话</strong></span></button></div>
                            </aside>
                            <form class="phonie-composer" data-form="chat">
                                <button class="phonie-icon-button phonie-icon-button--raised" type="button" data-action="toggle-chat-tools" aria-label="打开聊天工具">
                                    ${icon('plus')}
                                </button>
                                <textarea rows="1" maxlength="1600" data-role="chat-input" placeholder="写一条私人消息" aria-label="私人消息内容"></textarea>
                                <button class="phonie-icon-button phonie-icon-button--raised phonie-chat-send" type="submit" data-role="chat-send" aria-label="发送消息">
                                    ${icon('send')}
                                </button>
                            </form>
                            <input type="file" accept="image/*" data-role="chat-image-input" hidden>
                        </section>
                        <section class="phonie-screen" data-screen="call" aria-label="电话">
                            <div class="phonie-call-screen">
                                <div class="phonie-call-backdrop" data-role="call-backdrop" aria-hidden="true"></div>
                                <div class="phonie-call-veil" aria-hidden="true"></div>
                                <div class="phonie-call-topline"><button type="button" data-action="navigate" data-target-screen="home" aria-label="返回桌面">${icon('back')}</button><span>语音通话</span><i></i><span data-role="call-direction-label">拨号</span></div>
                                <div class="phonie-call-ripples" aria-hidden="true"><i></i><i></i><i></i></div>
                                <div class="phonie-contact-mark" data-role="call-mark"><span data-role="call-initials">P</span></div>
                                <div class="phonie-call-participants" data-role="call-participant-orbit" hidden></div>
                                <div class="phonie-call-identity">
                                    <h2 data-role="call-contact">Character</h2>
                                    <p class="phonie-call-status" data-role="call-status">等待拨号</p>
                                </div>
                                <div class="phonie-call-live-wave" data-role="call-live-wave" aria-hidden="true">${makeWaveBars('prepared-call', 30)}</div>
                                <div class="phonie-call-captions" data-role="call-captions" data-empty="true">
                                    <div data-role="call-caption-content" hidden>
                                        <p class="phonie-call-caption-source" data-role="call-caption-source"></p>
                                        <p class="phonie-call-caption-translation" data-role="call-caption-translation"></p>
                                    </div>
                                </div>
                                <div class="phonie-call-idle-action" data-role="call-idle-action">
                                    <section class="phonie-call-contacts phonie-call-contacts--select"><header><span>正文联系人</span><small data-role="call-selected-summary">1 人</small></header><div class="phonie-call-contact-picker"><select data-role="call-contact-picker" aria-label="选择电话联系人"></select><button type="button" data-action="add-call-participant">${icon('plus')}<span>加入通话</span></button></div><div class="phonie-call-selection" data-role="call-selection" aria-label="已选通话联系人"></div><select data-role="call-participants" multiple hidden></select></section>
                                    <div class="phonie-call-number-row"><input class="phonie-call-number" data-role="call-number" inputmode="tel" readonly placeholder="选择联系人或输入号码"><button type="button" data-action="call-backspace" aria-label="删除一位">${icon('back')}</button></div>
                                    <div class="phonie-call-dialpad" aria-label="模拟拨号盘">${callDialPadMarkup()}</div>
                                    <details class="phonie-call-plan"><summary>${icon('spark')}<span>通话内容</span>${icon('chevron')}</summary><div><label><span>想聊什么</span><textarea data-role="call-topic" maxlength="600" rows="3" placeholder="通话主题"></textarea></label><label><span>编排方式</span><select data-role="call-strategy"><option value="context">根据上下文</option><option value="topic">指定内容优先</option></select></label><label><span>电话长度</span><select data-role="call-length"><option value="short">短来电 · 4–6 句</option><option value="normal" selected>普通 · 7–10 句</option><option value="long">长来电 · 12–18 句</option></select></label></div></details>
                                    <div class="phonie-call-launchers"><button class="phonie-call-launch phonie-call-launch--message" type="button" data-action="start-incoming-call">${icon('signal')}<span>角色留言</span></button><button class="phonie-call-launch phonie-call-launch--dial" type="button" data-action="start-call">${icon('phone')}<span>拨号</span></button></div>
                                </div>
                                <div class="phonie-call-incoming-actions" data-role="call-incoming-actions" hidden>
                                    <button type="button" data-action="decline-call" aria-label="拒接">${icon('end-call')}<span>拒接</span></button>
                                    <button type="button" data-action="accept-call" aria-label="接听">${icon('accept-call')}<span>接听</span></button>
                                </div>
                                <div class="phonie-call-track" data-role="call-track" hidden aria-label="通话段落进度"></div>
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

        const orb = document.createElement('button');
        orb.id = 'phonie-orb';
        orb.className = 'phonie-orb';
        orb.type = 'button';
        orb.setAttribute('aria-label', '打开 Phonie');
        orb.setAttribute('aria-controls', 'phonie-phone');
        orb.innerHTML = icon('wave')
            + `<span class='phonie-orb__wave' aria-hidden='true'><i></i><i></i><i></i><i></i></span>`
            + '<span class="phonie-orb__unread" data-role="unread" hidden></span>';
        document.body.append(root, orb);
        this.#root = root;
        this.#orb = orb;
        this.#bindEvents();
        const homePages = this.#root.querySelector('[data-role="home-pages"]');
        if (homePages) {
            const syncHomePage = () => {
                const page = Math.max(0, Math.min(1, Math.round(homePages.scrollLeft / Math.max(1, homePages.clientWidth))));
                this.#root.dataset.homePage = String(page);
                for (const button of this.#root.querySelectorAll('[data-action="set-home-page"]')) {
                    button.setAttribute('aria-current', String(Number(button.dataset.page) === page));
                }
            };
            homePages.addEventListener('scroll', syncHomePage, { passive: true });
            syncHomePage();
        }
        this.#mountSettingsLauncher();
        this.#mountWandLauncher();
        this.#unsubscribe = this.#store.subscribe((state) => this.render(state));
        this.#clockTimer = window.setInterval(() => this.#renderClocks(), 1000);
        this.render(this.#store.getState());
    }

    setAudioLevel(level, levels = []) {
        const value = Math.min(1, Math.max(0, Number(level) || 0));
        for (const target of [this.#root, this.#orb]) {
            target?.style.setProperty('--phonie-audio-level', value.toFixed(3));
            for (let index = 0; index < 18; index += 1) {
                const bar = Math.min(1, Math.max(0, Number(levels[index]) || value));
                target?.style.setProperty(`--phonie-audio-bar-${index}`, bar.toFixed(3));
            }
        }
    }

    #settingsMarkup() {
        return `
            <div class="phonie-settings-list">
                <section class="phonie-settings-section">
                    <h2 class="phonie-settings-section__title">外观</h2>
                    <div class="phonie-settings-card">
                        ${this.#selectRow('主题', 'theme', [
                            [THEMES.DAY, '日间'],
                            [THEMES.NIGHT, '夜间'],
                            [THEMES.TAVERN, '跟随酒馆'],
                        ])}
                        ${this.#selectRow('打开入口', 'launcherMode', [
                            ['orb', '悬浮球'],
                            ['wand', '酒馆魔棒菜单'],
                            ['both', '两个入口都显示'],
                        ])}
                        ${this.#switchRow('显示手机译文', 'showTranslation')}
                    </div>
                </section>
                <section class="phonie-settings-section">
                    <h2 class="phonie-settings-section__title">语言</h2>
                    <div class="phonie-settings-card">
                        ${this.#languageRow('角色语言', 'sourceLanguage')}
                        ${this.#languageRow('翻译语言', 'targetLanguage')}
                        ${this.#switchRow('正文双语格式', 'bodyPromptEnabled')}
                    </div>
                </section>
                <section class="phonie-settings-section">
                    <h2 class="phonie-settings-section__title">语音与连续性</h2>
                    <div class="phonie-settings-card">
                        <div class="phonie-setting-row">
                            <span>
                                <span class="phonie-setting-label">当前语音提供商</span>
                            </span>
                            <span class="phonie-provider-chip" data-role="provider-chip"></span>
                        </div>
                        ${this.#switchRow('正文播放器', 'autoDecorateMessages')}
                        ${this.#switchRow('自动播放手机回复', 'autoPlayPhoneReplies')}
                        ${this.#switchRow('注入通信连续性', 'injectContinuity')}
                    </div>
                </section>
                <section class="phonie-settings-section">
                    <h2 class="phonie-settings-section__title">本地数据</h2>
                    <div class="phonie-settings-card">
                        <div class="phonie-setting-row">
                            <span>
                                <span class="phonie-setting-label">清除音频缓存</span>
                                <b class="phonie-setting-value" data-role="audio-cache-size">正在统计</b>
                            </span>
                            <button class="phonie-icon-button" type="button" data-action="clear-cache" aria-label="清除音频缓存">${icon('trash')}</button>
                        </div>
                    </div>
                </section>
            </div>`;
    }

    #switchRow(label, key) {
        return `
            <label class="phonie-setting-row">
                <span>
                    <span class="phonie-setting-label">${escapeHtml(label)}</span>
                </span>
                <span class="phonie-switch">
                    <input type="checkbox" data-setting="${escapeHtml(key)}">
                    <span class="phonie-switch__track" aria-hidden="true"></span>
                </span>
            </label>`;
    }

    #selectRow(label, key, values) {
        const options = values.map(([value, text]) => `<option value="${escapeHtml(value)}">${escapeHtml(text)}</option>`).join('');
        return `
            <label class="phonie-setting-row">
                <span>
                    <span class="phonie-setting-label">${escapeHtml(label)}</span>
                </span>
                <select class="phonie-setting-select" data-setting="${escapeHtml(key)}">${options}</select>
            </label>`;
    }

    #languageRow(label, key) {
        const options = LANGUAGE_OPTIONS.map(([value, text]) => `<option value="${escapeHtml(value)}">${escapeHtml(text)} · ${escapeHtml(value)}</option>`).join('');
        return `<div class='phonie-setting-row phonie-language-row'><span><span class='phonie-setting-label'>${escapeHtml(label)}</span></span><span class='phonie-language-control'><select class='phonie-setting-select' data-language-select='${escapeHtml(key)}'>${options}<option value='custom'>自定义语言</option></select><input class='phonie-setting-select' type='text' data-language-custom='${escapeHtml(key)}' placeholder='例如 ca-ES' hidden></span></div>`;
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
            } else if (action === 'set-home-page') {
                const pages = this.#root.querySelector('[data-role="home-pages"]');
                const page = Number(target.dataset.page) || 0;
                pages?.scrollTo({ left: page * pages.clientWidth, behavior: 'smooth' });
            } else if (action === 'send-voice') {
                this.#submitChat(MESSAGE_KINDS.VOICE);
            } else if (action === 'toggle-chat-tools') {
                const tools = this.#root.querySelector('[data-role="chat-tools"]');
                if (tools) tools.hidden = !tools.hidden;
            } else if (action === 'choose-chat-image') {
                this.#root.querySelector('[data-role="chat-image-input"]')?.click();
            } else if (action === 'open-chat-action') {
                this.#chatToolMode = target.dataset.chatKind;
                const sheet = this.#root.querySelector('[data-role="chat-action-sheet"]');
                if (sheet) sheet.hidden = false;
                this.#setText('[data-role="chat-action-title"]', this.#chatToolMode === MESSAGE_KINDS.RED_PACKET ? '发送红包' : '发起转账');
            } else if (action === 'close-chat-action') {
                this.#closeChatAction();
            } else if (action === 'send-chat-action') {
                this.#submitStructuredChat();
            } else if (action === 'quote-phone-message') {
                this.#quotedMessageId = target.dataset.messageId || null;
                this.#renderReplyComposer(this.#store.getState());
            } else if (action === 'cancel-phone-quote') {
                this.#quotedMessageId = null;
                this.#renderReplyComposer(this.#store.getState());
            } else if (action === 'recall-phone-message') {
                this.#actions.recallPhoneMessage?.(target.dataset.messageId);
            } else if (action === 'regenerate-phone-audio') {
                this.#actions.regeneratePhoneAudio?.(target.dataset.messageId);
            } else if (action === 'delete-call-record') {
                this.#actions.deleteCallRecord?.(target.dataset.callId);
            } else if (action === 'replay-call-record') {
                this.#actions.replayCallRecord?.(target.dataset.callId);
            } else if (action === 'open-chat-preset') {
                this.#actions.updateSetting?.('promptWorkflowKind', 'chat');
                this.#actions.navigate?.(SCREENS.PROMPTS);
            } else if (action === 'open-chat-settings') {
                const sheet = this.#root.querySelector('[data-role="chat-settings-sheet"]');
                if (sheet) sheet.hidden = false;
            } else if (action === 'close-chat-settings') {
                const sheet = this.#root.querySelector('[data-role="chat-settings-sheet"]');
                if (sheet) sheet.hidden = true;
            } else if (action === 'clear-chat-history') {
                if (window.confirm?.('清空当前会话的全部消息吗？') !== false) this.#actions.clearCurrentConversation?.();
            } else if (action === 'delete-chat-conversation') {
                if (window.confirm?.('删除当前会话吗？联系人和声线路由会保留。') !== false) this.#actions.deleteCurrentConversation?.();
            } else if (action === 'open-contact-chat') {
                this.#actions.openContactChat?.(target.dataset.characterId);
            } else if (action === 'toggle-chat-contact') {
                this.#actions.toggleChatContact?.(target.dataset.characterId);
            } else if (action === 'open-group-chat') {
                this.#actions.openGroupChat?.();
            } else if (action === 'call-digit') {
                const number = this.#root.querySelector('[data-role=call-number]');
                if (number instanceof HTMLInputElement) {
                    number.value = (number.value.replace(/\D/g, '') + (target.dataset.digit || '')).slice(-12);
                    this.#syncDialSelection(number.value);
                }
            } else if (action === 'call-backspace') {
                const number = this.#root.querySelector('[data-role=call-number]');
                if (number instanceof HTMLInputElement) {
                    number.value = number.value.replace(/\D/g, '').slice(0, -1);
                    this.#syncDialSelection(number.value);
                }
            } else if (action === 'select-call-contact') {
                const select = this.#root.querySelector('[data-role=call-participants]');
                if (select instanceof HTMLSelectElement) {
                    const option = [...select.options].find((entry) => entry.value === target.dataset.characterId);
                    if (option) option.selected = !option.selected;
                    if (![...select.selectedOptions].length && option) option.selected = true;
                    const selected = [...select.selectedOptions];
                    const number = this.#root.querySelector('[data-role=call-number]');
                    if (number instanceof HTMLInputElement) number.value = selected.length > 1 ? `多人通话 · ${selected.length} 人` : target.dataset.number || '';
                    this.#syncCallContactButtons();
                }
            } else if (action === 'add-call-participant') {
                const picker = this.#root.querySelector('[data-role=call-contact-picker]');
                const selected = this.#root.querySelector('[data-role=call-participants]');
                if (picker instanceof HTMLSelectElement && selected instanceof HTMLSelectElement) {
                    const option = [...selected.options].find((entry) => entry.value === picker.value);
                    if (option) option.selected = true;
                    this.#syncCallContactButtons();
                }
            } else if (action === 'remove-call-participant') {
                const selected = this.#root.querySelector('[data-role=call-participants]');
                if (selected instanceof HTMLSelectElement) {
                    const option = [...selected.options].find((entry) => entry.value === target.dataset.characterId);
                    if (option) option.selected = false;
                    this.#syncCallContactButtons();
                }
            } else if (action === 'start-call') {
                this.#actions.startCall?.(this.#callSetup());
            } else if (action === 'start-incoming-call') {
                this.#actions.startIncomingCall?.(this.#callSetup());
            } else if (action === 'accept-call') {
                this.#actions.acceptCall?.();
            } else if (action === 'decline-call') {
                this.#actions.declineCall?.();
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
            } else if (action === 'open-tts-provider') {
                this.#actions.openTtsProvider?.(target.dataset.providerId);
            } else if (action === 'check-tts-provider') {
                this.#actions.checkTtsProvider?.(target.dataset.providerId);
            } else if (action === 'sync-tts-resources') {
                this.#actions.syncTtsResources?.(target.dataset.providerId);
            } else if (action === 'preview-tts-provider') {
                const editor = target.closest('[data-provider-editor-id]');
                const input = editor?.querySelector('[data-role="provider-preview-text"]');
                this.#actions.previewTtsProvider?.(target.dataset.providerId, input?.value || '');
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
                const modelId = this.#root.querySelector('[data-role="character-model-select"]')?.value || '';
                const catalogVoiceId = this.#root.querySelector('[data-role="character-voice-select"]')?.value || '';
                const customVoiceId = this.#root.querySelector('[data-role="character-voice-id"]')?.value || '';
                const textLanguage = this.#root.querySelector('[data-role="character-text-language"]')?.value || '';
                const referenceAudio = this.#root.querySelector('[data-role="character-reference-audio"]')?.value || '';
                this.#actions.updateCharacterRoute?.({
                    providerId,
                    fallbackProviderId,
                    modelId,
                    voiceId: customVoiceId || catalogVoiceId,
                    textLanguage,
                    referenceAudio,
                });
            } else if (action === 'add-manual-character') {
                const input = this.#root.querySelector('[data-role="manual-character-name"]');
                if (input instanceof HTMLInputElement && input.value.trim()) {
                    this.#actions.addManualCharacter?.(input.value.trim());
                    input.value = '';
                }
            } else if (action === 'delete-character-route') {
                if (window.confirm?.('删除当前角色的专属声线路由吗？') !== false) this.#actions.deleteCharacterRoute?.();
            } else if (action === 'select-character-route') {
                this.#characterProviderDraft = null;
                this.#actions.selectCharacterRoute?.(target.dataset.characterId);
                if (target.dataset.targetScreen) this.#actions.navigate?.(target.dataset.targetScreen);
            } else if (action === 'save-custom-key') {
                this.#saveCustomKey();
            } else if (action === 'refresh-custom-models') {
                const endpoint = this.#root.querySelector('[data-setting="customOpenAIEndpoint"]')?.value || '';
                this.#actions.refreshCustomModels?.(endpoint);
            } else if (action === 'save-novelai-token') {
                const input = this.#root.querySelector('[data-role="novelai-token"]');
                this.#actions.saveNovelAiToken?.(input?.value || '').then((saved) => { if (saved && input) input.value = ''; });
            } else if (action === 'generate-novelai-image') {
                const size = String(this.#root.querySelector('[data-role="novelai-size"]')?.value || '832x1216').split('x').map(Number);
                this.#actions.generateNovelAiImage?.({
                    prompt: this.#root.querySelector('[data-role="novelai-prompt"]')?.value || '',
                    artistTags: this.#root.querySelector('[data-role="novelai-artist-tags"]')?.value || '',
                    negativePrompt: this.#store.getState().settings.novelAiNegativePrompt,
                    model: this.#store.getState().settings.novelAiModel,
                    steps: this.#store.getState().settings.novelAiSteps,
                    scale: this.#store.getState().settings.novelAiScale,
                    width: size[0],
                    height: size[1],
                });
            } else if (action === 'generate-novelai-tags') {
                const idea = this.#root.querySelector('[data-role="novelai-idea"]')?.value || '';
                const instruction = this.#store.getState().settings.novelAiTagInstruction;
                this.#actions.generateNovelAiTags?.({ idea, instruction }).then((result) => {
                    if (result) this.#writeNovelAiFields(result);
                });
            } else if (action === 'save-novelai-preset') {
                const state = this.#store.getState();
                const select = this.#root.querySelector('[data-role="novelai-preset-select"]');
                const activeId = select instanceof HTMLSelectElement ? select.value : '';
                const existing = state.settings.novelAiPromptPresets?.find((entry) => entry.id === activeId);
                const name = existing?.name || window.prompt?.('预设名称', '新绘图预设')?.trim();
                if (name) {
                    const preset = {
                        id: existing?.id || `nai-${Date.now().toString(36)}`,
                        name,
                        prompt: this.#root.querySelector('[data-role="novelai-prompt"]')?.value || '',
                        artistTags: this.#root.querySelector('[data-role="novelai-artist-tags"]')?.value || '',
                        negativePrompt: this.#store.getState().settings.novelAiNegativePrompt,
                    };
                    const next = existing
                        ? state.settings.novelAiPromptPresets.map((entry) => entry.id === existing.id ? preset : entry)
                        : [...(state.settings.novelAiPromptPresets || []), preset];
                    this.#actions.updateSetting?.('novelAiPromptPresets', next);
                    this.#actions.updateSetting?.('novelAiActivePresetId', preset.id);
                }
            } else if (action === 'delete-novelai-preset') {
                const state = this.#store.getState();
                const select = this.#root.querySelector('[data-role="novelai-preset-select"]');
                const activeId = select instanceof HTMLSelectElement ? select.value : '';
                if (activeId && window.confirm?.('删除当前绘图提示词预设吗？') !== false) {
                    this.#actions.updateSetting?.('novelAiPromptPresets', (state.settings.novelAiPromptPresets || []).filter((entry) => entry.id !== activeId));
                    this.#actions.updateSetting?.('novelAiActivePresetId', '');
                }
            } else if (action === 'send-novelai-image') {
                this.#actions.sendNovelAiImage?.();
            } else if (action === 'download-novelai-image') {
                this.#actions.downloadNovelAiImage?.();
            } else if (action === 'reset-prompt-preset') {
                const kind = this.#store.getState().settings.promptWorkflowKind || 'body';
                const defaults = kind === 'body'
                    ? DEFAULT_BODY_PROMPT_PRESET
                    : kind === 'call' ? DEFAULT_CALL_PROMPT_PRESET : DEFAULT_CHAT_PROMPT_PRESET;
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
            } else if (action === 'save-prompt-preset') {
                const { kind, preset } = this.#currentPromptPreset();
                this.#actions.savePromptPreset?.(kind, preset, false);
            } else if (action === 'save-as-prompt-preset') {
                const { kind, preset } = this.#currentPromptPreset();
                this.#actions.savePromptPreset?.(kind, preset, true);
            } else if (action === 'delete-prompt-preset') {
                const { kind, preset } = this.#currentPromptPreset();
                if (window.confirm?.('确认删除当前提示词预设吗？') !== false) {
                    this.#actions.deletePromptPreset?.(kind, preset.id);
                }
            } else if (action === 'export-prompt-preset') {
                const { kind, preset } = this.#currentPromptPreset();
                this.#downloadJson('phonie-' + kind + '-' + preset.id + '.json', { kind, presets: [preset] });
            } else if (action === 'export-prompt-library') {
                this.#downloadJson('phonie-prompt-presets.json', {
                    schemaVersion: 1,
                    promptPresetLibraries: this.#store.getState().settings.promptPresetLibraries,
                });
            } else if (action === 'import-prompt-presets') {
                this.#root.querySelector('[data-role="prompt-preset-import"]')?.click();
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

        this.#root.addEventListener('input', (event) => {
            const target = event.target;
            if (target instanceof HTMLInputElement && target.dataset.role === 'character-search') {
                const query = target.value.trim().toLocaleLowerCase('zh-CN');
                for (const item of this.#root.querySelectorAll('[data-character-search]')) {
                    item.hidden = Boolean(query) && !String(item.dataset.characterSearch || '').includes(query);
                }
                return;
            }
            if (target instanceof HTMLTextAreaElement && target.dataset.role === 'chat-input') {
                const send = this.#root.querySelector('[data-role="chat-send"]');
                if (send) send.dataset.hasText = String(Boolean(target.value.trim()));
            }
        });

        this.#root.addEventListener('change', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
            const value = target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value;
            if (target.dataset.role === 'chat-image-input' && target instanceof HTMLInputElement) {
                const file = target.files?.[0];
                if (file) {
                    this.#actions.sendMessage?.(file.name || '图片', MESSAGE_KINDS.IMAGE, false, {
                        attachmentName: file.name || '图片',
                        description: '用户发送了一张模拟图片',
                        replyToId: this.#quotedMessageId,
                    });
                    this.#quotedMessageId = null;
                    this.#renderReplyComposer(this.#store.getState());
                    target.value = '';
                }
                return;
            }
            if (target.dataset.role === 'prompt-preset-import' && target instanceof HTMLInputElement) {
                const file = target.files?.[0];
                if (file) this.#importPromptPresets(file);
                target.value = '';
                return;
            }
            if (target.dataset.role === 'prompt-preset-library') {
                const kind = ['body', 'chat', 'call'].includes(this.#store.getState().settings.promptWorkflowKind)
                    ? this.#store.getState().settings.promptWorkflowKind : 'body';
                this.#actions.applyPromptPreset?.(kind, String(value || ''));
                return;
            }
            if (target.dataset.role === 'call-contact-picker' && target instanceof HTMLSelectElement) {
                const character = this.#store.getState().characters.find((entry) => entry.id === target.value);
                const number = this.#root.querySelector('[data-role=call-number]');
                if (number instanceof HTMLInputElement && character) number.value = contactNumber(character.id || character.name);
                this.#syncCallContactButtons({ preserveNumber: true });
                return;
            }
            if (target.dataset.role === 'novelai-preset-select' && target instanceof HTMLSelectElement) {
                const preset = this.#store.getState().settings.novelAiPromptPresets?.find((entry) => entry.id === target.value);
                this.#actions.updateSetting?.('novelAiActivePresetId', target.value);
                if (preset) this.#writeNovelAiFields(preset);
                return;
            }
            if (target.dataset.role === 'character-provider-select') {
                this.#characterProviderDraft = String(value || '');
                this.#renderCharacter(this.#store.getState());
                return;
            }
            const languageKey = target.dataset.languageSelect;
            if (languageKey) {
                const custom = this.#root.querySelector(`[data-language-custom="${languageKey}"]`);
                if (custom instanceof HTMLInputElement) {
                    custom.hidden = value !== 'custom';
                    if (value === 'custom') {
                        custom.focus();
                    } else {
                        this.#actions.updateSetting?.(languageKey, value);
                    }
                }
                return;
            }
            const customLanguageKey = target.dataset.languageCustom;
            if (customLanguageKey) {
                const nextLanguage = String(value || '').trim();
                if (nextLanguage) this.#actions.updateSetting?.(customLanguageKey, nextLanguage);
                return;
            }
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

        const orb = this.#orb;
        orb?.addEventListener('click', (event) => {
            if (this.#suppressOrbClick || event.detail > 0) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            this.#actions.open?.();
        });
        orb?.addEventListener('pointerdown', (event) => this.#startOrbDrag(event));
        orb?.addEventListener('pointerenter', () => this.#wakeOrb());
        orb?.addEventListener('focus', () => this.#wakeOrb());
        orb?.addEventListener('pointerleave', () => this.#wakeOrb(460));
        this.#resizeHandler = () => this.#positionOrb(this.#store.getState().settings);
        window.addEventListener('resize', this.#resizeHandler, { passive: true });
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
        event.preventDefault();
        this.#wakeOrb();
        this.#suppressOrbClick = false;
        const rect = orb.getBoundingClientRect();
        try {
            orb.setPointerCapture?.(event.pointerId);
        } catch (error) {
            console.debug('[Phonie] Pointer capture unavailable; continuing with click fallback.', error);
        }
        this.#drag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
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
        const maxX = Math.max(0, window.innerWidth - this.#drag.orb.offsetWidth);
        const maxY = Math.max(0, window.innerHeight - this.#drag.orb.offsetHeight);
        const x = clamp(event.clientX - this.#drag.offsetX, 0, maxX);
        const y = clamp(event.clientY - this.#drag.offsetY, 0, maxY);
        this.#drag.orb.dataset.dragging = 'true';
        this.#drag.orb.style.left = x + 'px';
        this.#drag.orb.style.top = y + 'px';
        this.#drag.orb.style.right = 'auto';
        this.#drag.orb.style.bottom = 'auto';
    }

    #endOrbDrag(event) {
        if (!this.#drag) return;
        if (this.#drag.pointerId !== event.pointerId) return;
        const drag = this.#drag;
        this.#removeOrbWindowListeners();
        const shouldOpen = isOrbTap(drag, event.type);
        if (drag.moved) {
            event.preventDefault();
            const before = drag.orb.getBoundingClientRect();
            const target = getOrbDockTargetFromRect(before, window.innerWidth, window.innerHeight);
            this.#suppressOrbClick = true;
            this.#drag = null;
            drag.orb.style.removeProperty('left');
            drag.orb.style.removeProperty('top');
            drag.orb.style.removeProperty('right');
            drag.orb.style.removeProperty('bottom');
            drag.orb.dataset.dragging = 'false';
            this.#actions.updateDock?.(target);
            const after = drag.orb.getBoundingClientRect();
            if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && typeof drag.orb.animate === 'function') {
                drag.orb.animate([
                    { transform: `translate3d(${before.left - after.left}px, ${before.top - after.top}px, 0) scale(0.97)` },
                    { transform: 'translate3d(0, 0, 0) scale(1)' },
                ], { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
            }
            window.setTimeout(() => { this.#suppressOrbClick = false; }, 650);
        } else {
            drag.orb.dataset.dragging = 'false';
            this.#drag = null;
            this.#positionOrb(this.#store.getState().settings);
        }
        if (shouldOpen) {
            this.#suppressOrbClick = true;
            this.#actions.open?.();
            window.setTimeout(() => { this.#suppressOrbClick = false; }, 450);
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
        const kind = ['body', 'chat', 'call'].includes(settings.promptWorkflowKind) ? settings.promptWorkflowKind : 'body';
        return {
            kind,
            preset: normalizePhonePromptPreset(kind === 'body'
                ? settings.bodyPromptPreset
                : kind === 'call' ? settings.callPromptPreset : settings.chatPromptPreset),
        };
    }

    #downloadJson(filename, value) {
        const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    async #importPromptPresets(file) {
        try {
            const payload = JSON.parse(await file.text());
            this.#actions.importPromptPresets?.(payload);
        } catch {
            this.#actions.importPromptPresets?.(null);
        }
    }

    #renderReplyComposer(state) {
        const preview = this.#root.querySelector('[data-role="reply-composer"]');
        if (!preview) return;
        const message = state.messages.find((entry) => entry.id === this.#quotedMessageId);
        preview.hidden = !message;
        this.#setText('[data-role="reply-composer-text"]', message
            ? (message.kind === MESSAGE_KINDS.RECALLED ? '原消息已撤回' : message.originalText.slice(0, 80))
            : '');
    }

    #closeChatAction() {
        this.#chatToolMode = null;
        const sheet = this.#root.querySelector('[data-role="chat-action-sheet"]');
        if (sheet) sheet.hidden = true;
    }

    #submitStructuredChat() {
        const kind = this.#chatToolMode === MESSAGE_KINDS.RED_PACKET ? MESSAGE_KINDS.RED_PACKET : MESSAGE_KINDS.TRANSFER;
        const amount = Number(this.#root.querySelector('[data-role="chat-action-amount"]')?.value || 0);
        const note = this.#root.querySelector('[data-role="chat-action-note"]')?.value?.trim() || '';
        if (!(amount > 0)) return;
        const title = kind === MESSAGE_KINDS.RED_PACKET ? '红包' : '转账';
        this.#actions.sendMessage?.(title + ' ¥' + amount.toFixed(2), kind, false, {
            amount,
            note,
            replyToId: this.#quotedMessageId,
        });
        this.#quotedMessageId = null;
        const amountInput = this.#root.querySelector('[data-role="chat-action-amount"]');
        const noteInput = this.#root.querySelector('[data-role="chat-action-note"]');
        if (amountInput) amountInput.value = '';
        if (noteInput) noteInput.value = '';
        this.#closeChatAction();
        this.#renderReplyComposer(this.#store.getState());
    }

    #submitChat(kind) {
        const input = this.#root.querySelector('[data-role="chat-input"]');
        if (!(input instanceof HTMLTextAreaElement)) return;
        const text = input.value.trim();
        if (!text && kind === MESSAGE_KINDS.VOICE) return;
        if (text) input.value = '';
        const send = this.#root.querySelector('[data-role="chat-send"]');
        if (send) send.dataset.hasText = 'false';
        this.#actions.sendMessage?.(text, kind, false, { replyToId: this.#quotedMessageId });
        this.#quotedMessageId = null;
        this.#renderReplyComposer(this.#store.getState());
    }

    #submitCall() {
        const input = this.#root.querySelector('[data-role="call-input"]');
        if (!(input instanceof HTMLInputElement)) return;
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        this.#actions.sendMessage?.(text, MESSAGE_KINDS.TEXT, true);
    }

    #callSetup() {
        const select = this.#root.querySelector('[data-role=call-participants]');
        return {
            participantIds: select instanceof HTMLSelectElement ? [...select.selectedOptions].map((option) => option.value) : [],
            topic: this.#root.querySelector('[data-role=call-topic]')?.value?.trim() || '',
            strategy: this.#root.querySelector('[data-role=call-strategy]')?.value || 'context',
            callLength: this.#root.querySelector('[data-role=call-length]')?.value || 'normal',
            number: this.#root.querySelector('[data-role=call-number]')?.value || '',
        };
    }

    #syncDialSelection(number) {
        const select = this.#root.querySelector('[data-role=call-participants]');
        if (!(select instanceof HTMLSelectElement)) return;
        const normalized = String(number || '').replace(/\D/g, '');
        for (const option of select.options) option.selected = false;
        const picker = this.#root.querySelector('[data-role=call-contact-picker]');
        const option = [...select.options].find((entry) => String(entry.dataset.number || '').replace(/\D/g, '') === normalized);
        if (option) option.selected = true;
        if (picker instanceof HTMLSelectElement && option) picker.value = option.value;
        this.#syncCallContactButtons();
    }

    #syncCallContactButtons({ preserveNumber = false } = {}) {
        const select = this.#root.querySelector('[data-role=call-participants]');
        const selectedOptions = select instanceof HTMLSelectElement ? [...select.selectedOptions] : [];
        const selected = new Set(selectedOptions.map((option) => option.value));
        this.#setText('[data-role="call-selected-summary"]', `${selected.size} 人`);
        const button = this.#root.querySelector('[data-action=add-call-participant]');
        const picker = this.#root.querySelector('[data-role=call-contact-picker]');
        if (button && picker instanceof HTMLSelectElement) {
            const active = selected.has(picker.value);
            button.dataset.selected = String(active);
            button.disabled = active || !picker.value;
            button.querySelector('span').textContent = active ? '已在通话' : '加入通话';
        }
        const selection = this.#root.querySelector('[data-role="call-selection"]');
        if (selection) selection.innerHTML = selectedOptions.map((option) => `
            <span class="phonie-call-selection__chip"><b>${escapeHtml(initials(option.textContent))}</b><span>${escapeHtml(String(option.textContent || '').split(' · ')[0])}</span><button type="button" data-action="remove-call-participant" data-character-id="${escapeHtml(option.value)}" aria-label="移除 ${escapeHtml(option.textContent)}">${icon('close')}</button></span>
        `).join('');
        if (!preserveNumber) {
            const number = this.#root.querySelector('[data-role=call-number]');
            if (number instanceof HTMLInputElement) {
                number.value = selectedOptions.length > 1
                    ? `多人通话 · ${selectedOptions.length} 人`
                    : selectedOptions[0]?.dataset.number || '';
            }
        }
    }

    render(state) {
        if (!this.#root) return;
        this.#root.dataset.theme = state.settings.theme;
        this.#root.dataset.open = String(Boolean(state.open));
        this.#root.dataset.dock = state.settings.dockSide;
        this.#root.dataset.screen = state.screen;
        this.#root.dataset.callState = state.callState || 'idle';
        this.#root.dataset.audioState = state.audioState || 'idle';
        this.#root.dataset.launcher = state.settings.launcherMode || 'orb';
        this.#root.hidden = !state.open;
        this.#root.style.display = state.open ? 'block' : 'none';
        this.#root.inert = !state.open;
        if (this.#orb) {
            this.#orb.dataset.theme = state.settings.theme;
            this.#orb.dataset.dock = state.settings.dockSide;
            this.#orb.dataset.audioState = state.audioState || 'idle';
            this.#orb.hidden = state.open || state.settings.launcherMode === 'wand';
            this.#positionOrb(state.settings);
        }

        const phone = this.#root.querySelector('.phonie-phone');
        phone?.setAttribute('aria-hidden', String(!state.open));
        const orb = this.#orb;
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
        const selectedProvider = state.providerSnapshot?.providers?.find((provider) => provider.id === state.selectedProviderId);
        const title = state.screen === SCREENS.CHAT
            ? state.contact.name
            : state.screen === SCREENS.PROVIDER
                ? selectedProvider?.name || screenCopy.title
                : screenCopy.title;
        this.#setText('[data-role="title"]', title);
        this.#setText('[data-role="eyebrow"]', screenCopy.eyebrow);

        for (const screen of this.#root.querySelectorAll('[data-screen]')) {
            screen.dataset.active = String(screen.dataset.screen === state.screen);
        }
        for (const tab of this.#root.querySelectorAll('.phonie-dock-button[data-target-screen]')) {
            tab.setAttribute('aria-selected', String(tab.dataset.targetScreen === state.screen));
        }

        const unread = this.#orb?.querySelector('[data-role="unread"]');
        if (unread) {
            unread.hidden = !state.unread;
            unread.textContent = state.unread > 99 ? '99' : String(state.unread || '');
        }

        this.#renderMessages(state);
        this.#renderCall(state);
        this.#renderHome(state);
        this.#renderVoiceLibrary(state);
        this.#renderProviderDetail(state);
        this.#renderTrace(state);
        this.#renderCharacter(state);
        this.#renderModelSettings(state);
        this.#renderPromptPreset(state);
        this.#renderNovelAi(state);
        this.#renderSettings(state);
        this.#renderDeviceStatus(state);
        this.#renderDynamicIsland(state);
        this.#renderClocks();
        this.#renderToast(state.toast);
    }

    #renderNovelAi(state) {
        this.#setText('[data-role="novelai-status"]', state.novelStatus || '待命');
        const generate = this.#root.querySelector('[data-action="generate-novelai-image"]');
        if (generate instanceof HTMLButtonElement) {
            generate.disabled = Boolean(state.novelBusy);
            generate.setAttribute('aria-busy', String(Boolean(state.novelBusy)));
            const label = generate.querySelector('span');
            if (label) label.textContent = state.novelBusy ? '生成中…' : '生成图片';
        }
        const result = this.#root.querySelector('[data-role="novelai-result"]');
        const image = result?.querySelector('img');
        if (result) result.hidden = !state.novelImage;
        if (image instanceof HTMLImageElement && image.src !== state.novelImage) image.src = state.novelImage || '';
        const tagButton = this.#root.querySelector('[data-action="generate-novelai-tags"]');
        if (tagButton instanceof HTMLButtonElement) {
            tagButton.disabled = Boolean(state.novelTagBusy);
            tagButton.setAttribute('aria-busy', String(Boolean(state.novelTagBusy)));
            const label = tagButton.querySelector('span');
            if (label) label.textContent = state.novelTagBusy ? '正在整理提示词…' : '让当前模型整理画面提示词';
        }
        const presetSelect = this.#root.querySelector('[data-role="novelai-preset-select"]');
        if (presetSelect instanceof HTMLSelectElement) {
            const presets = state.settings.novelAiPromptPresets || [];
            const signature = JSON.stringify(presets.map((entry) => [entry.id, entry.name]));
            if (presetSelect.dataset.signature !== signature) {
                presetSelect.dataset.signature = signature;
                presetSelect.innerHTML = '<option value="">未选择预设</option>' + presets.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</option>`).join('');
            }
            presetSelect.value = presets.some((entry) => entry.id === state.settings.novelAiActivePresetId)
                ? state.settings.novelAiActivePresetId : '';
        }
    }

    #writeNovelAiFields(value = {}) {
        const prompt = this.#root.querySelector('[data-role="novelai-prompt"]');
        const artists = this.#root.querySelector('[data-role="novelai-artist-tags"]');
        const negative = this.#root.querySelector('[data-setting="novelAiNegativePrompt"]');
        if (prompt instanceof HTMLTextAreaElement) prompt.value = String(value.prompt || '');
        if (artists instanceof HTMLTextAreaElement) artists.value = String(value.artistTags || '');
        if (negative instanceof HTMLTextAreaElement) negative.value = String(value.negativePrompt || '');
        if (value.artistTags != null) this.#actions.updateSetting?.('novelAiArtistTags', String(value.artistTags || ''));
        if (value.negativePrompt != null) this.#actions.updateSetting?.('novelAiNegativePrompt', String(value.negativePrompt || ''));
    }

    #renderDynamicIsland(state) {
        const island = this.#root.querySelector('[data-role="dynamic-island"]');
        if (!island) return;
        const inCall = ACTIVE_CALL_STATES.has(state.callState);
        const islandState = state.generating || state.audioState === 'generating' || state.callState === CALL_STATES.GENERATING
                ? 'generating'
                : state.audioState === 'speaking'
                    ? inCall ? 'call' : 'playing'
                    : 'idle';
        const labels = { idle: '', generating: '生成中', playing: '播放中', call: '通话中' };
        island.dataset.state = islandState;
        this.#setText('[data-role="dynamic-island-label"]', labels[islandState]);
        this.#root.dataset.islandState = islandState;
    }

    #renderMessages(state) {
        const list = this.#root.querySelector('[data-role="message-list"]');
        if (!list) return;
        const callMessageIds = new Set((state.calls || []).flatMap((record) => record.messageIds || []));
        const chatMessages = state.messages.filter((message) => message.channel !== 'call' && !callMessageIds.has(message.id));
        const chatParticipants = state.chatParticipants?.length ? state.chatParticipants : [state.contact];
        const primary = chatParticipants[0];
        const chatName = chatParticipants.length > 1 ? `群聊 · ${chatParticipants.length} 人` : primary.name;
        this.#setText('[data-role="chat-contact-name"]', chatName);
        this.#setText('[data-role="chat-contact-initials"]', chatParticipants.length > 1 ? String(chatParticipants.length) : initials(primary.name));
        setBackgroundImage(this.#root.querySelector('[data-role="chat-contact-avatar"]'), chatParticipants.length > 1 ? '' : primary.avatarUrl);
        const pendingCount = Array.isArray(state.pendingUserMessageIds) ? state.pendingUserMessageIds.length : 0;
        const send = this.#root.querySelector('[data-role="chat-send"]');
        if (send) {
            send.dataset.mode = pendingCount ? 'request-reply' : 'send';
            send.title = pendingCount ? `已发送 ${pendingCount} 条，输入框留空可请求回复` : '发送消息';
            send.setAttribute('aria-label', pendingCount ? `请求角色回复已发送的 ${pendingCount} 条消息` : '发送消息');
        }
        const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 72;
        const previousTop = list.scrollTop;
        const signature = JSON.stringify(chatMessages.map((message) => [
            message.id, message.kind, message.originalText, message.translationText, message.isPlaying, message.audioStatus,
            message.durationLabel, message.amount, message.note, message.recalledAt,
            message.replySnapshot?.content, message.imageUrl,
        ]));
        if (signature !== this.#messageSignature) {
            this.#messageSignature = signature;
            if (chatMessages.length === 0) {
                list.innerHTML = `
                <div class="phonie-chat-empty">
                    <div class="phonie-chat-empty__mark">${icon('message')}</div>
                    <h2 class="phonie-chat-empty__title">暂无消息</h2>
                </div>`;
            } else {
                list.innerHTML = chatMessages.map((message) => renderMessage(message, state.settings.showTranslation, state)).join('');
            }
        }
        const generating = this.#root.querySelector('[data-role="generating"]');
        if (generating) generating.hidden = !state.generating;
        for (const message of chatMessages) {
            const action = [...list.querySelectorAll('[data-action=play-phone-audio]')].find((button) => button.dataset.messageId === String(message.id));
            const voice = action?.closest('.phonie-message__voice');
            if (voice) voice.dataset.audioState = message.audioStatus || (message.isPlaying ? 'playing' : 'idle');
            this.#audioMenu.bind(action, {
                download: () => this.#actions.downloadPhoneAudio?.(message.id),
                regenerate: () => this.#actions.regeneratePhoneAudio?.(message.id),
            });
        }
        this.#renderReplyComposer(state);
        requestAnimationFrame(() => {
            list.scrollTop = nearBottom || chatMessages.length <= 1 ? list.scrollHeight : previousTop;
        });
    }

    #renderCall(state) {
        const primary = state.callParticipants?.[0] || state.contact;
        const primaryAvatarUrl = primary.avatarUrl || state.contact.avatarUrl || '';
        this.#setText('[data-role="call-initials"]', initials(primary.name));
        this.#setText('[data-role="call-contact"]', primary.name);
        this.#setText('[data-role="call-status"]', state.callPreparationLabel || callStatusLabel(state.callState, this.#elapsed(state.callStartedAt), state.callDirection));
        this.#setText('[data-role="call-direction-label"]', state.callDirection === 'incoming' ? '来电' : state.callDirection === 'outgoing' ? '去电' : '拨号');
        setBackgroundImage(this.#root.querySelector('[data-role="call-backdrop"]'), primaryAvatarUrl);
        setBackgroundImage(this.#root.querySelector('[data-role="call-mark"]'), primaryAvatarUrl);
        const callScreen = this.#root.querySelector('.phonie-call-screen');
        if (callScreen) {
            callScreen.dataset.callState = state.callState;
            callScreen.dataset.audioState = state.audioState || 'idle';
        }

        const captions = this.#root.querySelector('[data-role="call-captions"]');
        const content = this.#root.querySelector('[data-role="call-caption-content"]');
        const hasCaption = Boolean(state.callCaption?.source);
        if (captions) captions.dataset.empty = String(!hasCaption);
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
        const mark = this.#root.querySelector('[data-role="call-mark"]');
        const participantOrbit = this.#root.querySelector('[data-role="call-participant-orbit"]');
        if (callForm) callForm.hidden = !connected;
        if (idleAction) idleAction.hidden = active;
        if (endButton) endButton.hidden = !active || incoming;
        if (incomingActions) incomingActions.hidden = !incoming;
        if (mark) mark.dataset.ringing = String(incoming || state.callState === CALL_STATES.DIALING);
        const callParticipants = state.callParticipants?.length ? state.callParticipants : [primary];
        if (participantOrbit) {
            participantOrbit.hidden = callParticipants.length < 2 || !active;
            const signature = JSON.stringify(callParticipants.map((entry) => [entry.id, entry.name, entry.avatarUrl, entry.name === state.callSpeaker]));
            if (participantOrbit.dataset.signature !== signature) {
                participantOrbit.dataset.signature = signature;
                participantOrbit.innerHTML = callParticipants.map((entry) => {
                    const speaking = entry.name === state.callSpeaker && state.audioState === 'speaking';
                    return `<span class="phonie-call-participant" data-speaking="${speaking}" title="${escapeHtml(entry.name)}"><i data-participant-avatar="${escapeHtml(entry.id || entry.name)}"><b>${escapeHtml(initials(entry.name))}</b></i><small>${escapeHtml(entry.name)}</small></span>`;
                }).join('');
                for (const entry of callParticipants) {
                    const avatar = [...participantOrbit.querySelectorAll('[data-participant-avatar]')]
                        .find((node) => node.dataset.participantAvatar === String(entry.id || entry.name));
                    const directoryEntry = state.characters?.find((character) => (
                        String(character.id) === String(entry.id)
                        || character.name === entry.name
                    ));
                    setBackgroundImage(avatar, entry.avatarUrl || directoryEntry?.avatarUrl || primaryAvatarUrl);
                }
            }
        }
        if (mark) mark.hidden = callParticipants.length > 1 && active;
        if (captions) captions.hidden = !connected || !hasCaption;

        const input = this.#root.querySelector('[data-role="call-input"]');
        if (input instanceof HTMLInputElement) {
            input.disabled = ![CALL_STATES.CONNECTED, CALL_STATES.SPEAKING].includes(state.callState) || state.generating;
        }
        const picker = this.#root.querySelector('[data-role=call-participants]');
        const contactPicker = this.#root.querySelector('[data-role=call-contact-picker]');
        if (picker instanceof HTMLSelectElement && !active) {
            const signature = (state.characters || []).map((entry) => entry.id + ':' + entry.name).join('|');
            if (picker.dataset.signature !== signature) {
                picker.dataset.signature = signature;
                const options = (state.characters || []).map((entry, index) => {
                    const number = contactNumber(entry.id || entry.name);
                    return `<option value='${escapeHtml(entry.id)}' data-number='${number}'${index === 0 ? ' selected' : ''}>${escapeHtml(entry.name)} · ${number}</option>`;
                }).join('');
                picker.innerHTML = options;
                if (contactPicker instanceof HTMLSelectElement) contactPicker.innerHTML = options || '<option value="">暂无联系人</option>';
                const number = this.#root.querySelector('[data-role=call-number]');
                if (number instanceof HTMLInputElement && state.characters?.[0]) number.value = contactNumber(state.characters[0].id || state.characters[0].name);
                this.#syncCallContactButtons();
            }
        }
        if (active && state.callParticipants?.length) {
            const names = state.callParticipants.map((entry) => entry.name).join('、');
            this.#setText('[data-role=call-contact]', names);
            this.#setText('[data-role=call-initials]', initials(names));
        }
        const track = this.#root.querySelector('[data-role=call-track]');
        if (track) {
            const count = state.callScriptQueue?.length || 0;
            track.hidden = !connected || count < 2;
            track.innerHTML = Array.from({ length: count }, (_, index) => `<i data-active='${index === state.callScriptIndex}'></i>`).join('');
        }
    }

    #renderHome(state) {
        const voiceCount = (state.characters || []).filter((character) => character.route?.voiceId || character.route?.referenceAudio).length;
        const callMessageIds = new Set((state.calls || []).flatMap((record) => record.messageIds || []));
        const chatMessageCount = state.messages.filter((message) => message.channel !== 'call' && !callMessageIds.has(message.id)).length;
        const chatParticipants = state.chatParticipants?.length ? state.chatParticipants : [state.contact];
        this.#setText('[data-role="home-contact"]', chatParticipants.length > 1 ? `群聊 · ${chatParticipants.length} 人` : chatParticipants[0].name);
        this.#setText('[data-role="home-contact-service"]', state.contact.name);
        this.#setText('[data-role="home-provider"]', state.providerLabel);
        this.#setText('[data-role="home-message-summary"]', `${chatMessageCount} 条手机消息`);
        this.#setText('[data-role="home-chat-count"]', `${chatMessageCount} 条`);
        this.#setText('[data-role="home-call-count"]', `${state.calls.length} 通`);
        this.#setText('[data-role="home-voice-count"]', `${voiceCount} 个`);
        this.#setText('[data-role="home-group-count"]', chatParticipants.length > 1 ? `${chatParticipants.length} 人` : '选人开聊');
        setImageSource(this.#root.querySelector('[data-role="wallpaper-image"]'), state.contact.avatarUrl);
        this.#root.dataset.hasWallpaper = String(Boolean(state.contact.avatarUrl));
    }

    #renderVoiceLibrary(state) {
        this.#setText('[data-role="voice-provider"]', '角色声线路由');
        this.#setText('[data-role="voice-language"]', state.settings.sourceLanguage);
        const providers = this.#root.querySelector('[data-role="tts-provider-list"]');
        if (providers) {
            const list = Array.isArray(state.providerSnapshot?.providers) ? state.providerSnapshot.providers : [];
            const signature = JSON.stringify(list.map((provider) => [
                provider.id, provider.selected, provider.tone, provider.runtime?.status, provider.runtime?.message,
            ]));
            if (providers.dataset.signature !== signature) {
                providers.dataset.signature = signature;
                providers.innerHTML = list.length ? list.map((provider) => `
                <button class="phonie-profile-card phonie-provider-card${provider.selected ? ' is-current' : ''}" type="button" data-action="open-tts-provider" data-provider-id="${escapeHtml(provider.id)}" data-provider-tone="${escapeHtml(provider.tone || 'silver')}" aria-label="打开 ${escapeHtml(provider.name)} 专属设置">
                    <span class="phonie-profile-card__mark">${icon(provider.icon || 'signal')}</span>
                    <span><strong>${escapeHtml(provider.name)}</strong><small>${escapeHtml(provider.summary || provider.runtime?.message || provider.mode)}</small></span>
                    <b data-status="${escapeHtml(provider.runtime?.status || 'idle')}">${provider.selected ? '当前' : '进入'}</b>
                </button>`).join('') : '<div class="phonie-record-empty">Phonie 语音引擎目录未载入。</div>';
            }
        }
        const list = this.#root.querySelector('[data-role="voice-library"]');
        if (!list) return;
        const voices = (state.characters || []).filter((character) => (
            character.route?.voiceId || character.route?.referenceAudio || character.route?.providerId
        ));
        this.#setText('[data-role="voice-route-count"]', `${voices.length} 条`);
        if (!voices.length) {
            list.innerHTML = '<div class="phonie-record-empty">暂无已保存声线</div>';
            return;
        }
        list.innerHTML = voices.map((character) => {
            const route = character.route || {};
            const provider = state.providerSnapshot?.providers?.find((entry) => entry.id === route.providerId);
            return `
            <article class="phonie-record-card">
                <span class="phonie-record-card__play" aria-hidden="true">${icon(provider?.icon || 'wave')}</span>
                <span class="phonie-record-card__copy"><strong>${escapeHtml(character.name)}</strong><small>${escapeHtml(provider?.name || state.providerLabel)} · ${escapeHtml(route.voiceId || (route.referenceAudio ? '参考音频复刻' : '默认音色'))}</small></span>
                <button class="phonie-record-card__edit" type="button" data-action="select-character-route" data-character-id="${escapeHtml(character.id)}" data-target-screen="${SCREENS.CHARACTER}" aria-label="编辑 ${escapeHtml(character.name)} 的声线">${icon('settings')}</button>
            </article>`;
        }).join('');
    }

    #renderProviderDetail(state) {
        const editor = this.#root.querySelector('[data-role="tts-provider-editor"]');
        if (!editor) return;
        const providers = state.providerSnapshot?.providers || [];
        const current = providers.find((provider) => provider.id === state.selectedProviderId)
            || providers.find((provider) => provider.selected)
            || providers[0];
        if (!current) {
            editor.innerHTML = '<div class="phonie-record-empty">没有可用的 Phonie 语音引擎。</div>';
            return;
        }
        const signature = JSON.stringify([
            current.id, current.settings, current.catalog, current.runtime,
            state.providerSnapshot?.fallbackProvider, current.selected,
        ]);
        if (editor.dataset.signature === signature) return;
        editor.dataset.signature = signature;
        editor.dataset.providerEditorId = current.id;
        editor.dataset.providerTone = current.tone || 'silver';
        const modelCount = current.catalog?.models?.length || 0;
        const voiceCount = current.catalog?.voices?.length || 0;
        const busy = current.runtime?.status === 'checking';
        const syncing = busy && /同步/.test(current.runtime?.message || '');
        editor.innerHTML = `
            <section class="phonie-provider-editor" data-provider-editor-id="${escapeHtml(current.id)}" data-provider-tone="${escapeHtml(current.tone || 'silver')}">
                <header class="phonie-provider-hero">
                    <span class="phonie-provider-hero__mark">${icon(current.icon || 'signal')}</span>
                    <span class="phonie-provider-hero__copy">
                        <small>${escapeHtml(current.category)} · ${escapeHtml(current.mode)}</small>
                        <strong>${escapeHtml(current.name)}</strong>
                        <p>${escapeHtml(current.summary || '')}</p>
                    </span>
                    <i data-status="${escapeHtml(current.runtime?.status || 'idle')}">${escapeHtml(current.runtime?.message || '等待检测')}</i>
                </header>
                <dl class="phonie-provider-stats">
                    <div><dt>模型目录</dt><dd>${modelCount}</dd></div>
                    <div><dt>账号音色</dt><dd>${voiceCount}</dd></div>
                    <div><dt>当前状态</dt><dd>${current.selected ? '正在使用' : '未启用'}</dd></div>
                </dl>
                <div class="phonie-provider-editor__actions">
                    <button type="button" data-action="set-tts-provider" data-provider-id="${escapeHtml(current.id)}">${icon('check')}<span>${current.selected ? '当前引擎' : '设为当前'}</span></button>
                    <button type="button" data-action="check-tts-provider" data-provider-id="${escapeHtml(current.id)}" data-busy="${busy}"${busy ? ' disabled aria-busy="true"' : ''}>${icon('signal')}<span>${busy && !syncing ? '检测中' : '检测连接'}</span></button>
                    ${['elevenlabs', 'minimax'].includes(current.id) ? `<button type="button" data-action="sync-tts-resources" data-provider-id="${escapeHtml(current.id)}" data-busy="${busy}"${busy ? ' disabled aria-busy="true"' : ''}>${icon('reset')}<span>${syncing ? '同步中' : '同步目录'}</span></button>` : ''}
                </div>
                <label class="phonie-provider-field">
                    <span><strong>全局备用引擎</strong><small>仅在这个引擎失败时接管</small></span>
                    <select data-setting="ttsFallbackProvider">
                        <option value="">不使用备用引擎</option>
                        ${providers.filter((provider) => provider.id !== current.id).map((provider) => '<option value="' + escapeHtml(provider.id) + '"' + (provider.id === state.providerSnapshot.fallbackProvider ? ' selected' : '') + '>' + escapeHtml(provider.name) + '</option>').join('')}
                    </select>
                </label>
                <div class="phonie-provider-fields">${current.fields.map((field) => providerFieldMarkup(field, current)).join('')}</div>
                <section class="phonie-provider-preview">
                    <label for="phonie-provider-preview-${escapeHtml(current.id)}">试听文本</label>
                    <textarea id="phonie-provider-preview-${escapeHtml(current.id)}" data-role="provider-preview-text" rows="3">おはよう。今日はどんな話をしようか。</textarea>
                    <button type="button" data-action="preview-tts-provider" data-provider-id="${escapeHtml(current.id)}">${icon('play')}<span>用 ${escapeHtml(current.name)} 试听</span></button>
                </section>
            </section>`;
    }

    #renderTrace(state) {
        const list = this.#root.querySelector('[data-role="trace-list"]');
        if (!list) return;
        const records = state.calls.slice().reverse();
        if (!records.length) {
            list.innerHTML = '<div class="phonie-record-empty">暂无通话记录</div>';
            return;
        }
        list.innerHTML = records.map((record) => `
            <article class="phonie-record-card phonie-record-card--call">
                ${record.messageIds?.length || record.messages?.length
                    ? `<button class="phonie-record-card__play" type="button" data-action="replay-call-record" data-call-id="${escapeHtml(record.id)}" aria-label="重播这次通话">${icon('play')}</button>`
                    : `<span class="phonie-record-card__play" aria-hidden="true">${icon('phone')}</span>`}
                <span class="phonie-record-card__copy"><strong>${escapeHtml(record.title || record.contactName || state.contact.name)}</strong><small>${escapeHtml(record.contactName || state.contact.name)} · ${record.direction === 'incoming' ? '来电' : '外呼'} · ${record.outcome === 'declined' ? '未接通' : '已结束'}</small><em>${escapeHtml(record.summary || '通话已结束')}</em></span>
                <time>${escapeHtml(formatDuration(record.startedAt, record.endedAt))}<br>${escapeHtml(formatRecordDate(record.startedAt))}</time>
                <button class="phonie-record-card__delete" type="button" data-action="delete-call-record" data-call-id="${escapeHtml(record.id)}" aria-label="删除这条通话记录">${icon('trash')}</button>
            </article>`).join('');
    }

    #renderCharacter(state) {
        const characters = Array.isArray(state.characters) ? state.characters : [];
        const characterSections = [
            this.#root.querySelector('.phonie-character-card'),
            this.#root.querySelector('.phonie-character-specs'),
            this.#root.querySelector('.phonie-route-editor'),
        ];
        if (!characters.length) {
            this.#setText('[data-role="character-directory-count"]', '0 位联系人');
            const directory = this.#root.querySelector('[data-role="character-directory"]');
            if (directory) directory.innerHTML = '<div class="phonie-record-empty">暂无声线路由</div>';
            characterSections.forEach((section) => { if (section) section.hidden = true; });
            return;
        }
        characterSections.forEach((section) => { if (section) section.hidden = false; });
        const selected = characters.find((character) => character.id === state.selectedCharacterId)
            || characters[0];
        const route = selected.route || {};
        const providers = state.providerSnapshot?.providers || [];
        const providerId = this.#characterProviderDraft || route.providerId || state.settings.ttsActiveProvider || providers[0]?.id || '';
        const provider = providers.find((entry) => entry.id === providerId) || providers[0];

        this.#setText('[data-role="character-directory-count"]', `${characters.length} 位联系人`);
        const directory = this.#root.querySelector('[data-role="character-directory"]');
        if (directory) {
            const signature = JSON.stringify(characters.map((character) => [
                character.id, character.name, character.avatarUrl, character.current, character.spoken,
                character.route?.providerId, character.route?.voiceId,
            ]));
            if (directory.dataset.signature !== signature || directory.dataset.selected !== selected.id) {
                directory.dataset.signature = signature;
                directory.dataset.selected = selected.id;
                directory.innerHTML = characters.map((character) => {
                    const configured = Boolean(character.route && Object.keys(character.route).length);
                    const sourceLabel = '正文说话人';
                    const avatarStyle = character.avatarUrl ? ` style="background-image:url('${escapeHtml(character.avatarUrl)}')"` : '';
                    const chatSelected = (state.chatParticipants || []).some((entry) => entry.id === character.id);
                    return `
                        <article class="phonie-character-route${character.id === selected.id ? ' is-selected' : ''}" data-character-search="${escapeHtml(character.name.toLocaleLowerCase('zh-CN'))}">
                            <button class="phonie-character-route__main" type="button" data-action="select-character-route" data-character-id="${escapeHtml(character.id)}">
                                <span class="phonie-character-route__avatar"${avatarStyle}><b>${escapeHtml(initials(character.name))}</b></span>
                                <span><strong>${escapeHtml(character.name)}</strong><small>${escapeHtml(sourceLabel)}${configured ? ' · 已设专属声线' : ''}</small></span>
                            </button>
                            <span class="phonie-character-route__actions">
                                <button type="button" data-action="toggle-chat-contact" data-character-id="${escapeHtml(character.id)}" aria-pressed="${chatSelected}" aria-label="选择 ${escapeHtml(character.name)} 加入群聊">${chatSelected ? icon('check') : icon('plus')}</button>
                                <button type="button" data-action="open-contact-chat" data-character-id="${escapeHtml(character.id)}" aria-label="与 ${escapeHtml(character.name)} 私信">${icon('message')}</button>
                            </span>
                        </article>`;
                }).join('');
            }
            const query = this.#root.querySelector('[data-role="character-search"]')?.value?.trim().toLocaleLowerCase('zh-CN') || '';
            for (const item of directory.querySelectorAll('[data-character-search]')) {
                item.hidden = Boolean(query) && !String(item.dataset.characterSearch || '').includes(query);
            }
        }

        this.#setText('[data-role="character-initials"]', initials(selected.name));
        this.#setText('[data-role="character-name"]', selected.name);
        this.#setText('[data-role="character-provider"]', provider?.name || state.providerLabel);
        this.#setText('[data-role="character-source-language"]', route.textLanguage || state.settings.sourceLanguage);
        this.#setText('[data-role="character-target-language"]', state.settings.targetLanguage);
        this.#setText('[data-role="character-continuity"]', state.settings.injectContinuity ? '开启' : '关闭');
        setBackgroundImage(this.#root.querySelector('[data-role="character-portrait"]'), selected.avatarUrl);
        const providerSelect = this.#root.querySelector('[data-role="character-provider-select"]');
        const fallbackSelect = this.#root.querySelector('[data-role="character-fallback-provider-select"]');
        if (providerSelect instanceof HTMLSelectElement) {
            providerSelect.innerHTML = providers.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</option>`).join('');
            providerSelect.value = providerId;
        }
        if (fallbackSelect instanceof HTMLSelectElement) {
            fallbackSelect.innerHTML = [
                '<option value="">沿用全局备用引擎</option>',
                ...providers.filter((entry) => entry.id !== providerId).map((entry) => '<option value="' + escapeHtml(entry.id) + '">' + escapeHtml(entry.name) + '</option>'),
            ].join('');
            fallbackSelect.value = route.fallbackProviderId || '';
        }
        const modelSelect = this.#root.querySelector('[data-role="character-model-select"]');
        const voiceSelect = this.#root.querySelector('[data-role="character-voice-select"]');
        const models = provider?.catalog?.models || [];
        const voices = provider?.catalog?.voices || [];
        if (modelSelect instanceof HTMLSelectElement) {
            const choices = route.modelId && !models.some((item) => item.id === route.modelId)
                ? [{ id: route.modelId, name: route.modelId }, ...models]
                : models;
            modelSelect.innerHTML = ['<option value="">沿用引擎默认模型</option>', ...choices.map((item) => '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.name || item.id) + '</option>')].join('');
            modelSelect.value = route.modelId || '';
        }
        if (voiceSelect instanceof HTMLSelectElement) {
            const choices = route.voiceId && !voices.some((item) => item.id === route.voiceId)
                ? [{ id: route.voiceId, name: route.voiceId }, ...voices]
                : voices;
            voiceSelect.innerHTML = ['<option value="">沿用引擎默认音色</option>', ...choices.map((item) => '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.name || item.id) + '</option>')].join('');
            voiceSelect.value = route.voiceId || '';
        }
        const voice = this.#root.querySelector('[data-role="character-voice-id"]');
        const language = this.#root.querySelector('[data-role="character-text-language"]');
        const reference = this.#root.querySelector('[data-role="character-reference-audio"]');
        if (voice instanceof HTMLInputElement && document.activeElement !== voice) {
            voice.value = voices.some((item) => item.id === route.voiceId) ? '' : route.voiceId || '';
        }
        if (language instanceof HTMLInputElement && document.activeElement !== language) language.value = route.textLanguage || state.settings.sourceLanguage;
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
        const kind = ['body', 'chat', 'call'].includes(state.settings.promptWorkflowKind) ? state.settings.promptWorkflowKind : 'body';
        const preset = normalizePhonePromptPreset(kind === 'body'
            ? state.settings.bodyPromptPreset
            : kind === 'call' ? state.settings.callPromptPreset : state.settings.chatPromptPreset);
        const name = this.#root.querySelector('[data-prompt-preset-field="name"]');
        const depth = this.#root.querySelector('[data-prompt-preset-field="insertionDepth"]');
        if (name instanceof HTMLInputElement) name.value = preset.name;
        if (depth instanceof HTMLInputElement) depth.value = String(preset.insertionDepth);
        const librarySelect = this.#root.querySelector('[data-role="prompt-preset-library"]');
        if (librarySelect instanceof HTMLSelectElement) {
            const presets = state.settings.promptPresetLibraries?.[kind] || [preset];
            librarySelect.innerHTML = presets.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</option>`).join('');
            librarySelect.value = presets.some((entry) => entry.id === preset.id) ? preset.id : '';
        }
        const list = this.#root.querySelector('[data-role="prompt-entry-list"]');
        if (list) list.innerHTML = preset.entries.map((entry, index) => promptEntryMarkup(entry, index, preset.entries.length)).join('');
        this.#setText('[data-role="prompt-intro"]', kind === 'body'
            ? '正文生成前按顺序注入；译文保留在正文，TTSVoice 标签只作为角色、情绪和原语言的内部控制。'
            : kind === 'call'
                ? '电话编排专用工作流；不会与私信预设互相覆盖。'
                : '私信聊天专用工作流；不会与电话编排预设互相覆盖。');
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
        for (const select of this.#root.querySelectorAll('[data-language-select]')) {
            if (!(select instanceof HTMLSelectElement)) continue;
            const key = select.dataset.languageSelect;
            const value = String(state.settings[key] || '');
            const known = LANGUAGE_OPTIONS.some(([code]) => code === value);
            select.value = known ? value : 'custom';
            const custom = this.#root.querySelector(`[data-language-custom="${key}"]`);
            if (custom instanceof HTMLInputElement) {
                custom.hidden = known;
                if (!known && document.activeElement !== custom) custom.value = value;
            }
        }
        const stats = state.audioCacheStats || { count: 0, bytes: 0 };
        this.#setText('[data-role="audio-cache-size"]', `${formatBytes(stats.bytes)} · ${stats.count} 条`);
        const clear = this.#root.querySelector('[data-action="clear-cache"]');
        if (clear instanceof HTMLButtonElement) {
            clear.disabled = Boolean(state.cacheBusy);
            clear.dataset.busy = String(Boolean(state.cacheBusy));
            clear.setAttribute('aria-busy', String(Boolean(state.cacheBusy)));
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
            this.#setText('[data-role="call-status"]', state.callPreparationLabel || callStatusLabel(state.callState, this.#elapsed(state.callStartedAt), state.callDirection));
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

    #positionOrb(settings) {
        if (!this.#orb || this.#drag?.moved) return;
        const top = getOrbTop(settings?.dockY, window.innerHeight, this.#orb.offsetHeight || 48);
        this.#orb.style.top = Math.round(top) + 'px';
        this.#orb.style.bottom = 'auto';
        if (settings?.dockSide === 'left') {
            this.#orb.style.left = '-33px';
            this.#orb.style.right = 'auto';
        } else {
            this.#orb.style.right = '-33px';
            this.#orb.style.left = 'auto';
        }
    }

    #wakeOrb(delay = 1700) {
        if (!this.#orb) return;
        window.clearTimeout(this.#orbWakeTimer);
        this.#orb.dataset.awake = 'true';
        this.#orbWakeTimer = window.setTimeout(() => {
            if (this.#orb && !this.#drag) this.#orb.dataset.awake = 'false';
        }, delay);
    }

    dispose() {
        window.clearInterval(this.#clockTimer);
        window.clearTimeout(this.#toastTimer);
        window.clearTimeout(this.#orbWakeTimer);
        this.#unsubscribe?.();
        this.#removeOrbWindowListeners();
        this.#audioMenu.dispose();
        if (this.#resizeHandler) window.removeEventListener('resize', this.#resizeHandler);
        this.#launcher?.remove();
        this.#wandLauncher?.remove();
        this.#orb?.remove();
        this.#root?.remove();
        this.#orb = null;
        this.#root = null;
    }
}
