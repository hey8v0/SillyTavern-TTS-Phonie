import {
    APPS,
    CALL_STATES,
    DOCK_APP_IDS,
    ENGINES,
    ISLAND_STATES,
    MESSAGE_KINDS,
    PROMPT_ROLES,
    PROMPT_WORKFLOWS,
    SCREENS,
    THEMES,
    THEME_OPTIONS,
    THEME_PALETTES,
} from '../core/constants.js';
import { icon } from '../core/icons.js';
import { virtualPhoneNumber } from '../core/id.js';
import { escapeHtml, formatBytes, formatClock, formatDuration, initials } from './dom.js';

const ISLAND_COPY = Object.freeze({
    [ISLAND_STATES.GENERATING]: '正在生成',
    [ISLAND_STATES.SYNTHESIZING]: '正在合成',
    [ISLAND_STATES.PREPARING_CALL]: '准备来电',
    [ISLAND_STATES.RINGING]: '来电响铃',
    [ISLAND_STATES.CONNECTED]: '通话中',
});

function appIconMarkup(app, extraClass = '') {
    return `<span class="phonie-app-icon ${extraClass}" style="--app-color:${app.color}">${icon(app.icon)}</span>`;
}

function appTileMarkup(app) {
    return `<button class="phonie-app-tile" type="button" data-action="navigate" data-target-screen="${app.id}" aria-label="打开 ${escapeHtml(app.name)}">
        ${appIconMarkup(app)}
        <span class="phonie-app-label">${escapeHtml(app.name)}</span>
    </button>`;
}

function dockTileMarkup(app) {
    return `<button class="phonie-dock-tile" type="button" data-action="navigate" data-target-screen="${app.id}" aria-label="打开 ${escapeHtml(app.name)}">
        ${appIconMarkup(app)}
    </button>`;
}

function appBarMarkup(title, backTarget = SCREENS.HOME) {
    return `<header class="phonie-appbar">
        <button class="phonie-icon-btn" type="button" data-action="navigate" data-target-screen="${backTarget}" aria-label="返回">${icon('back')}</button>
        <h1 class="phonie-appbar__title">${escapeHtml(title)}</h1>
        <span class="phonie-appbar__side" aria-hidden="true"></span>
    </header>`;
}

export class PhoneView {
    #store;
    #actions;
    #root = null;
    #orb = null;
    #launcher = null;
    #wandLauncher = null;
    #unsubscribe = null;
    #drag = null;
    #orbMoveHandler = null;
    #orbEndHandler = null;
    #suppressOrbClick = false;
    #resizeHandler = null;
    #signatures = {};

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
        root.dataset.screen = SCREENS.HOME;
        root.innerHTML = this.#shellMarkup();

        const orb = document.createElement('button');
        orb.id = 'phonie-orb';
        orb.className = 'phonie-orb';
        orb.type = 'button';
        orb.setAttribute('aria-label', '打开 Phonie');
        orb.setAttribute('aria-controls', 'phonie-phone');
        orb.innerHTML = `${icon('qq')}<span class="phonie-orb__wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;
        document.body.append(root, orb);

        this.#root = root;
        this.#orb = orb;
        this.#bindEvents();
        this.#bindOrbGestures();
        this.#mountSettingsLauncher();
        this.#mountWandLauncher();
        this.#resizeHandler = () => this.#fitPhone();
        window.addEventListener('resize', this.#resizeHandler);
        this.#fitPhone();
        this.#unsubscribe = this.#store.subscribe((state) => this.render(state));
        this.render(this.#store.getState());
    }

    #shellMarkup() {
        const dock = DOCK_APP_IDS.map((id) => APPS.find((app) => app.id === id)).filter(Boolean).map(dockTileMarkup).join('');
        return `
            <div class="phonie-scrim" data-action="close" aria-hidden="true"></div>
            <section class="phonie-phone" id="phonie-phone" aria-label="Phonie 声纹手机" aria-hidden="true">
                <span class="phonie-hardware-key phonie-hardware-key--action" aria-hidden="true"></span>
                <span class="phonie-hardware-key phonie-hardware-key--volume-up" aria-hidden="true"></span>
                <span class="phonie-hardware-key phonie-hardware-key--volume-down" aria-hidden="true"></span>
                <span class="phonie-hardware-key phonie-hardware-key--power" aria-hidden="true"></span>
                <div class="phonie-frame">
                    <div class="phonie-screen-glass">
                        <div class="phonie-wallpaper" data-role="wallpaper" aria-hidden="true"></div>
                        <div class="phonie-wallpaper-veil" aria-hidden="true"></div>
                        <header class="phonie-statusbar">
                            <time class="phonie-statusbar__time" data-role="clock">09:41</time>
                            <div class="phonie-statusbar__right">
                                <span class="phonie-statusbar__network" data-role="network">在线</span>
                                <span class="phonie-statusbar__wifi" data-role="wifi" hidden>${icon('wifi')}</span>
                                <span class="phonie-battery">
                                    <span class="phonie-battery__track"><span class="phonie-battery__fill" data-role="battery-fill"></span></span>
                                    <span class="phonie-battery__nub" aria-hidden="true"></span>
                                    <span class="phonie-battery__bolt" data-role="charging" hidden>${icon('bolt')}</span>
                                </span>
                                <span class="phonie-statusbar__battery-label" data-role="battery-label"></span>
                            </div>
                        </header>
                        <div class="phonie-island" data-role="island" data-state="idle" data-action="resume-active" role="button" tabindex="0" aria-label="灵动岛">
                            <span class="phonie-island__sensor" aria-hidden="true"></span>
                            <span class="phonie-island__label" data-role="island-label"></span>
                            <span class="phonie-island__wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
                        </div>
                        <main class="phonie-screens">
                            ${this.#homeMarkup()}
                            ${this.#qqMarkup()}
                            ${this.#chatMarkup()}
                            ${this.#phoneMarkup()}
                            ${this.#contactsMarkup()}
                            ${this.#traceMarkup()}
                            ${this.#enginesMarkup()}
                            ${this.#engineDetailMarkup()}
                            ${this.#drawingMarkup()}
                            ${this.#themesMarkup()}
                            ${this.#settingsMarkup()}
                            ${this.#settingsModelMarkup()}
                            ${this.#settingsDisplayMarkup()}
                            ${this.#settingsPromptsMarkup()}
                            ${this.#settingsBodyTtsMarkup()}
                            ${this.#settingsQqMarkup()}
                            ${this.#settingsStickersMarkup()}
                            ${this.#settingsCacheMarkup()}
                        </main>
                        <div class="phonie-call-overlay" data-role="call-overlay" hidden>${this.#callOverlayMarkup()}</div>
                        <nav class="phonie-dock" data-role="dock" aria-label="应用底栏">${dock}</nav>
                        <div class="phonie-home-indicator" aria-hidden="true"></div>
                        <div class="phonie-toast" data-role="toast" role="status" aria-live="polite" data-visible="false"></div>
                    </div>
                </div>
            </section>`;
    }

    // ---- 各屏幕静态结构 ---------------------------------------------------
    #homeMarkup() {
        const tiles = APPS.map(appTileMarkup).join('');
        return `<section class="phonie-screen phonie-screen--home" data-screen="${SCREENS.HOME}"><div class="phonie-home"><div class="phonie-app-grid">${tiles}</div></div></section>`;
    }

    #qqMarkup() {
        return `<section class="phonie-screen" data-screen="${SCREENS.QQ}">
            ${appBarMarkup('QQ')}
            <div class="phonie-app-content">
                <div class="phonie-section-head"><span>好友</span><button class="phonie-mini-btn" type="button" data-action="toggle-add-friend">${icon('plus')}<span>添加</span></button></div>
                <div class="phonie-list-block" data-role="friend-list"></div>
                <div class="phonie-section-head"><span>群聊</span><button class="phonie-mini-btn" type="button" data-action="toggle-create-group">${icon('plus')}<span>建群</span></button></div>
                <div class="phonie-list-block" data-role="group-list"></div>
                <div class="phonie-sheet" data-role="add-friend-sheet" hidden>
                    <p class="phonie-sheet-title">添加好友</p>
                    <select data-role="add-friend-select"></select>
                    <button class="phonie-primary-btn" type="button" data-action="confirm-add-friend">${icon('check')}<span>添加</span></button>
                </div>
                <div class="phonie-sheet" data-role="create-group-sheet" hidden>
                    <p class="phonie-sheet-title">创建群聊</p>
                    <input type="text" data-role="group-name" maxlength="80" placeholder="群名">
                    <div data-role="group-member-picker"></div>
                    <button class="phonie-primary-btn" type="button" data-action="confirm-create-group">${icon('check')}<span>创建</span></button>
                </div>
            </div>
        </section>`;
    }

    #chatMarkup() {
        return `<section class="phonie-screen" data-screen="${SCREENS.CHAT}">
            <header class="phonie-appbar">
                <button class="phonie-icon-btn" type="button" data-action="navigate" data-target-screen="${SCREENS.QQ}" aria-label="返回">${icon('back')}</button>
                <span class="phonie-chat-title"><b data-role="chat-title">好友</b><small data-role="chat-subtitle">正在输入…</small></span>
                <button class="phonie-icon-btn" type="button" data-action="toggle-chat-settings" aria-label="聊天设置">${icon('sliders')}</button>
            </header>
            <div class="phonie-chat-settings" data-role="chat-settings" hidden>
                <button type="button" data-action="clear-chat">清空当前聊天</button>
                <button type="button" data-action="remove-current-friend">删除好友</button>
            </div>
            <div class="phonie-chat-list" data-role="message-list"></div>
            <div class="phonie-chat-tools" data-role="chat-tools" hidden>
                <button type="button" data-action="send-kind" data-kind="text">${icon('message')}<span>文字</span></button>
                <button type="button" data-action="send-kind" data-kind="voice">${icon('headphones')}<span>语音</span></button>
                <button type="button" data-action="send-kind" data-kind="image">${icon('image')}<span>图片</span></button>
                <button type="button" data-action="send-kind" data-kind="transfer">${icon('wallet')}<span>转账</span></button>
                <div class="phonie-chat-stickers" data-role="chat-stickers"></div>
            </div>
            <form class="phonie-composer" data-form="chat">
                <button class="phonie-icon-btn" type="button" data-action="toggle-chat-tools" aria-label="更多">${icon('plus')}</button>
                <textarea rows="1" maxlength="1600" data-role="chat-input" placeholder="发消息"></textarea>
                <button class="phonie-icon-btn phonie-send-btn" type="submit" data-role="chat-send" aria-label="发送">${icon('send')}</button>
            </form>
        </section>`;
    }

    #phoneMarkup() {
        const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
        return `<section class="phonie-screen" data-screen="${SCREENS.PHONE}">
            ${appBarMarkup('电话')}
            <div class="phonie-app-content phonie-phone-app">
                <div class="phonie-dial-display" data-role="dial-display">输入号码或从通讯录选择</div>
                <label class="phonie-contact-picker-label"><span>通讯录（可多选）</span><select class="phonie-contact-picker" data-role="call-contact-picker" multiple size="3"></select></label>
                <div class="phonie-dialpad">${digits.map((digit) => `<button type="button" data-action="dial-digit" data-digit="${digit}"><b>${digit}</b></button>`).join('')}</div>
                <div class="phonie-dial-actions">
                    <button class="phonie-icon-btn phonie-dial-backspace" type="button" data-action="dial-backspace" aria-label="删除">${icon('back')}</button>
                    <button class="phonie-call-launch" type="button" data-action="start-call">${icon('phone')}<span>拨打</span></button>
                </div>
                <details class="phonie-call-plan">
                    <summary>${icon('spark')}<span>通话内容</span>${icon('chevron')}</summary>
                    <label><span>方式</span><select data-role="call-strategy"><option value="context">延续酒馆上下文</option><option value="topic">自定义主题</option></select></label>
                    <label data-role="call-topic-row" hidden><span>主题</span><textarea rows="2" data-role="call-topic" placeholder="想聊什么"></textarea></label>
                    <label><span>长度</span><select data-role="call-length"><option value="short">短来电 · 4–6 句</option><option value="normal" selected>普通 · 7–10 句</option><option value="long">长来电 · 12–18 句</option></select></label>
                </details>
            </div>
        </section>`;
    }

    #callOverlayMarkup() {
        return `<div class="phonie-call-screen">
            <div class="phonie-call-topline"><button type="button" data-action="minimize-call" aria-label="收起">${icon('back')}</button><span data-role="call-direction-label">通话</span><i></i></div>
            <div class="phonie-call-ripples" aria-hidden="true"><i></i><i></i><i></i></div>
            <div class="phonie-contact-mark" data-role="call-mark"><span data-role="call-initials">P</span></div>
            <div class="phonie-call-participants" data-role="call-participant-orbit" hidden></div>
            <div class="phonie-call-identity"><h2 data-role="call-contact">Character</h2><p data-role="call-status">等待</p></div>
            <div class="phonie-call-live-wave" data-role="call-live-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
            <div class="phonie-call-captions" data-role="call-captions" hidden>
                <p class="phonie-call-caption-source" data-role="call-caption-source"></p>
                <p class="phonie-call-caption-translation" data-role="call-caption-translation"></p>
            </div>
            <div class="phonie-call-incoming-actions" data-role="call-incoming-actions" hidden>
                <button type="button" data-action="decline-call"><i class="phonie-call-btn phonie-call-btn--decline">${icon('endCall')}</i><span>拒接</span></button>
                <button type="button" data-action="accept-call"><i class="phonie-call-btn phonie-call-btn--accept">${icon('phone')}</i><span>接听</span></button>
            </div>
            <button class="phonie-call-end" type="button" data-action="end-call" data-role="call-end" hidden>${icon('endCall')}<span>挂断</span></button>
        </div>`;
    }

    #contactsMarkup() {
        return `<section class="phonie-screen" data-screen="${SCREENS.CONTACTS}">
            ${appBarMarkup('通讯录')}
            <div class="phonie-app-content">
                <div class="phonie-inline-add"><input type="text" maxlength="80" data-role="manual-contact-name" placeholder="添加联系人"><button class="phonie-primary-btn" type="button" data-action="add-manual-contact">${icon('plus')}<span>添加</span></button></div>
                <div class="phonie-list-block" data-role="contact-directory"></div>
                <div class="phonie-sheet" data-role="contact-route-sheet" hidden>
                    <p class="phonie-sheet-title">声线绑定</p>
                    <div data-role="route-editor"></div>
                    <button class="phonie-primary-btn" type="button" data-action="save-contact-route">${icon('check')}<span>保存</span></button>
                </div>
            </div>
        </section>`;
    }

    #traceMarkup() {
        return `<section class="phonie-screen" data-screen="${SCREENS.TRACE}">
            ${appBarMarkup('追踪')}
            <div class="phonie-app-content"><div class="phonie-list-block" data-role="trace-list"></div></div>
        </section>`;
    }

    #enginesMarkup() {
        return `<section class="phonie-screen" data-screen="${SCREENS.ENGINES}">
            ${appBarMarkup('引擎')}
            <div class="phonie-app-content"><div class="phonie-engine-list" data-role="engine-list"></div></div>
        </section>`;
    }

    #engineDetailMarkup() {
        return `<section class="phonie-screen" data-screen="${SCREENS.ENGINE_DETAIL}">
            ${appBarMarkup('引擎设置', SCREENS.ENGINES)}
            <div class="phonie-app-content"><div data-role="engine-detail"></div></div>
        </section>`;
    }

    #drawingMarkup() {
        return `<section class="phonie-screen" data-screen="${SCREENS.DRAWING}">
            ${appBarMarkup('绘画')}
            <div class="phonie-app-content">
                <div class="phonie-draw-preview" data-role="draw-preview"><span>${icon('draw')}</span><small>生成图片将显示在这里</small></div>
                <div class="phonie-settings-card phonie-draw-card">
                    <label class="phonie-field"><span>画面意图</span><textarea rows="2" data-role="novelai-idea" placeholder="描述角色此刻想分享的画面"></textarea></label>
                    <button class="phonie-primary-btn" type="button" data-action="generate-novelai-tags">${icon('spark')}<span>生成动态 Tag</span></button>
                    <label class="phonie-field"><span>前置固定正面词</span><textarea rows="2" data-novelai-setting="prefix"></textarea></label>
                    <label class="phonie-field"><span>动态正面 Tag</span><textarea rows="3" data-role="novelai-tags"></textarea></label>
                    <label class="phonie-field"><span>后置固定正面词</span><textarea rows="2" data-novelai-setting="suffix"></textarea></label>
                    <label class="phonie-field"><span>固定负面词</span><textarea rows="2" data-novelai-setting="negative"></textarea></label>
                    <div class="phonie-field-grid">
                        <label class="phonie-field"><span>模型</span><select data-novelai-setting="model"><option value="nai-diffusion-5-full">NAI Diffusion V5</option><option value="nai-diffusion-4-full">NAI Diffusion V4</option></select></label>
                        <label class="phonie-field"><span>尺寸</span><select data-novelai-setting="size"><option value="832x1216">竖图 832×1216</option><option value="1216x832">横图 1216×832</option><option value="1024x1024">方图 1024×1024</option></select></label>
                        <label class="phonie-field"><span>Sampler</span><select data-novelai-setting="sampler"><option value="k_euler_ancestral">Euler Ancestral</option><option value="k_euler">Euler</option><option value="k_dpmpp_2m">DPM++ 2M</option></select></label>
                        <label class="phonie-field"><span>Scheduler</span><select data-novelai-setting="scheduler"><option value="karras">Karras</option><option value="native">Native</option><option value="exponential">Exponential</option></select></label>
                        <label class="phonie-field"><span>Seed</span><input type="number" data-novelai-setting="seed"></label>
                        <label class="phonie-field"><span>Steps（最多 28）</span><input type="number" min="1" max="28" data-novelai-setting="steps"></label>
                        <label class="phonie-field"><span>Prompt Guidance</span><input type="number" min="0" max="10" step="0.1" data-novelai-setting="scale"></label>
                        <label class="phonie-field"><span>Guidance Rescale</span><input type="number" min="0" max="1" step="0.05" data-novelai-setting="guidanceRescale"></label>
                    </div>
                    <label class="phonie-switch-row"><span>Decrisper</span><input type="checkbox" data-novelai-setting="decrisper"></label>
                    <button class="phonie-primary-btn phonie-generate-btn" type="button" data-action="generate-novelai-image">${icon('image')}<span>生成一张图片</span></button>
                </div>
                <p class="phonie-novelai-status" data-role="novelai-status"></p>
            </div>
        </section>`;
    }

    #themesMarkup() {
        const tiles = THEME_OPTIONS.map((option) => `<button class="phonie-theme-tile" type="button" data-action="set-theme" data-theme="${option.id}">
            <span class="phonie-theme-tile__swatch" data-theme-swatch="${option.id}" aria-hidden="true"></span>
            <span class="phonie-theme-tile__meta"><strong>${escapeHtml(option.name)}</strong><small>${escapeHtml(option.hint)}</small></span>
            ${icon('chevron')}
        </button>`).join('');
        const colors = [['base', '60% 主背景'], ['panel', '30% 重点面板'], ['accent', '7% 激活色'], ['glow', '3% 高光']]
            .map(([key, label]) => `<label class="phonie-field"><span>${label}</span><input type="color" data-custom-color="${key}"></label>`).join('');
        return `<section class="phonie-screen" data-screen="${SCREENS.THEMES}">
            ${appBarMarkup('主题')}
            <div class="phonie-app-content">
                <div class="phonie-theme-list">${tiles}</div>
                <div class="phonie-settings-card" data-role="custom-theme-editor" hidden>
                    <p class="phonie-list-caption">自定义配色</p>
                    ${colors}
                    <label class="phonie-field"><span>壁纸 URL</span><input type="url" data-role="wallpaper-url" placeholder="https://…"></label>
                    <label class="phonie-field"><span>上传壁纸</span><input type="file" accept="image/*" data-role="wallpaper-file"></label>
                </div>
            </div>
        </section>`;
    }

    #settingsMarkup() {
        const pages = [
            [SCREENS.SETTINGS_MODEL, '模型来源', '酒馆主 API 与 OpenAI 兼容预设', 'spark'],
            [SCREENS.SETTINGS_DISPLAY, '显示与语言', '入口、字幕与译文语言', 'sliders'],
            [SCREENS.SETTINGS_PROMPTS, '全部提示词', '五种工作流与可用变量', 'layers'],
            [SCREENS.SETTINGS_BODY_TTS, '正文 TTS', '解析、提示词与后台渲染', 'headphones'],
            [SCREENS.SETTINGS_QQ, 'QQ 与主动来电', '回复节奏与联系人冷却', 'message'],
            [SCREENS.SETTINGS_STICKERS, '表情包', '批量导入与全局管理', 'image'],
            [SCREENS.SETTINGS_CACHE, '语音缓存', '占用、引用与清理', 'trash'],
        ];
        const rows = pages.map(([screen, title, detail, glyph]) => `<button class="phonie-settings-row" type="button" data-action="navigate" data-target-screen="${screen}">
            <span class="phonie-settings-row__glyph">${icon(glyph)}</span>
            <span class="phonie-settings-row__meta"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></span>
            ${icon('chevron')}
        </button>`).join('');
        return `<section class="phonie-screen" data-screen="${SCREENS.SETTINGS}">
            ${appBarMarkup('设置')}
            <div class="phonie-app-content"><div class="phonie-settings-list">${rows}</div><p class="phonie-settings-foot">Phonie 1.0 · 声纹手机</p></div>
        </section>`;
    }

    #settingsModelMarkup() {
        return `<section class="phonie-screen" data-screen="${SCREENS.SETTINGS_MODEL}">
            ${appBarMarkup('模型来源', SCREENS.SETTINGS)}
            <div class="phonie-app-content">
                <div class="phonie-settings-card">
                    <label class="phonie-field"><span>生成来源</span><select data-setting="generationMode"><option value="tavern">跟随酒馆主 API</option><option value="custom">自定义 OpenAI 兼容</option></select></label>
                </div>
                <div data-role="openai-profile-list"></div>
            </div>
        </section>`;
    }

    #settingsDisplayMarkup() {
        return `<section class="phonie-screen" data-screen="${SCREENS.SETTINGS_DISPLAY}">
            ${appBarMarkup('显示与语言', SCREENS.SETTINGS)}
            <div class="phonie-app-content">
                <div class="phonie-settings-card">
                    <label class="phonie-field"><span>打开入口</span><select data-setting="launcherMode"><option value="orb">悬浮球</option><option value="wand">酒馆魔棒菜单</option><option value="both">两者都显示</option></select></label>
                    <label class="phonie-field"><span>原文语言</span><input data-setting="sourceLanguage" placeholder="zh-CN"></label>
                    <label class="phonie-field"><span>译文语言</span><input data-setting="targetLanguage" placeholder="zh-CN"></label>
                    <label class="phonie-switch-row"><span>显示译文</span><input type="checkbox" data-setting="showTranslation"></label>
                </div>
            </div>
        </section>`;
    }

    #settingsPromptsMarkup() {
        const workflows = PROMPT_WORKFLOWS.map((workflow) => `<option value="${workflow.id}">${escapeHtml(workflow.name)}</option>`).join('');
        return `<section class="phonie-screen" data-screen="${SCREENS.SETTINGS_PROMPTS}">
            ${appBarMarkup('全部提示词', SCREENS.SETTINGS)}
            <div class="phonie-app-content">
                <select class="phonie-prompt-workflow" data-role="prompt-workflow">${workflows}</select>
                <div data-role="prompt-editor"></div>
            </div>
        </section>`;
    }

    #settingsBodyTtsMarkup() {
        return `<section class="phonie-screen" data-screen="${SCREENS.SETTINGS_BODY_TTS}">
            ${appBarMarkup('正文 TTS', SCREENS.SETTINGS)}
            <div class="phonie-app-content">
                <div class="phonie-settings-card">
                    <label class="phonie-switch-row"><span>正文语音总开关</span><input type="checkbox" data-setting="bodyTtsEnabled"></label>
                    <label class="phonie-switch-row"><span>内置正文 TTS 提示词</span><input type="checkbox" data-setting="bodyPromptEnabled"></label>
                    <label class="phonie-switch-row"><span>自动渲染正文 TTS</span><input type="checkbox" data-setting="autoRenderBodyTts"></label>
                </div>
            </div>
        </section>`;
    }

    #settingsQqMarkup() {
        return `<section class="phonie-screen" data-screen="${SCREENS.SETTINGS_QQ}">
            ${appBarMarkup('QQ 与主动来电', SCREENS.SETTINGS)}
            <div class="phonie-app-content">
                <div class="phonie-settings-card">
                    <label class="phonie-switch-row"><span>允许单聊主动来电</span><input type="checkbox" data-proactive="enabled"></label>
                    <label class="phonie-field"><span>联系人冷却（分钟，0–1440）</span><input type="number" min="0" max="1440" data-proactive="cooldownMinutes"></label>
                </div>
            </div>
        </section>`;
    }

    #settingsStickersMarkup() {
        return `<section class="phonie-screen" data-screen="${SCREENS.SETTINGS_STICKERS}">
            ${appBarMarkup('表情包', SCREENS.SETTINGS)}
            <div class="phonie-app-content">
                <label class="phonie-field"><span>批量导入（名字URL,名字URL）</span><textarea rows="4" data-role="sticker-import" placeholder="开心https://a.png,生气https://b.gif"></textarea></label>
                <div class="phonie-button-row"><button class="phonie-primary-btn" type="button" data-action="import-stickers">${icon('plus')}<span>导入</span></button><button class="phonie-danger-btn phonie-danger-btn--soft" type="button" data-action="clear-stickers">${icon('trash')}<span>清空</span></button></div>
                <div class="phonie-sticker-grid" data-role="sticker-list"></div>
            </div>
        </section>`;
    }

    #settingsCacheMarkup() {
        return `<section class="phonie-screen" data-screen="${SCREENS.SETTINGS_CACHE}">
            ${appBarMarkup('语音缓存', SCREENS.SETTINGS)}
            <div class="phonie-app-content">
                <div class="phonie-settings-card"><p class="phonie-cache-stats" data-role="cache-stats">正在统计…</p><button class="phonie-danger-btn" type="button" data-action="clear-cache">${icon('trash')}<span>删除缓存</span></button></div>
            </div>
        </section>`;
    }

    // ---- 事件绑定 ---------------------------------------------------------
    #bindEvents() {
        this.#root.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
            if (!(target instanceof HTMLElement)) return;
            const action = target.dataset.action;
            if (action === 'navigate') return this.#actions.navigate?.(target.dataset.targetScreen);
            if (action === 'close') return this.#actions.close?.();
            if (action === 'open') return this.#actions.open?.();
            if (action === 'set-theme') return this.#actions.setTheme?.(target.dataset.theme);
            if (action === 'dial-digit') return this.#appendDialDigit(target.dataset.digit);
            if (action === 'dial-backspace') return this.#actions.dialBackspace?.();
            if (action === 'resume-active') return this.#actions.resumeActive?.();
            if (action === 'send-kind') return this.#actions.setComposerKind?.(target.dataset.kind);
            if (action === 'toggle-chat-tools') return this.#actions.toggleChatTools?.();
            if (action === 'toggle-chat-settings') return this.#actions.toggleChatSettings?.();
            if (action === 'clear-chat') return this.#actions.clearChat?.();
            if (action === 'remove-current-friend') return this.#actions.removeCurrentFriend?.();
            if (action === 'recall-message') return this.#actions.recallMessage?.(target.dataset.id);
            if (action === 'send-sticker') return this.#actions.sendSticker?.(target.dataset.name);
            if (action === 'toggle-add-friend') return this.#actions.toggleAddFriend?.();
            if (action === 'toggle-create-group') return this.#actions.toggleCreateGroup?.();
            if (action === 'confirm-add-friend') return this.#actions.confirmAddFriend?.();
            if (action === 'confirm-create-group') return this.#actions.confirmCreateGroup?.();
            if (action === 'start-call') return this.#actions.startCall?.();
            if (action === 'accept-call') return this.#actions.acceptCall?.();
            if (action === 'decline-call') return this.#actions.declineCall?.();
            if (action === 'end-call') return this.#actions.endCall?.();
            if (action === 'minimize-call') return this.#actions.minimizeCall?.();
            if (action === 'add-manual-contact') return this.#actions.addManualContact?.();
            if (action === 'save-contact-route') return this.#actions.saveContactRoute?.();
            if (action === 'generate-novelai-tags') return this.#actions.generateNovelAiTags?.();
            if (action === 'generate-novelai-image') return this.#actions.generateNovelAiImage?.();
            if (action === 'import-stickers') return this.#actions.importStickers?.();
            if (action === 'clear-cache') return this.#actions.clearCache?.();
            if (action === 'open-chat') return this.#actions.openChat?.(target.dataset.id);
            if (action === 'open-group') return this.#actions.openGroup?.(target.dataset.id);
            if (action === 'play-message-audio') return this.#actions.playMessageAudio?.(target.dataset.id);
            if (action === 'replay-call') return this.#actions.replayCall?.(target.dataset.id);
            if (action === 'rerender-call') return this.#actions.rerenderCall?.(target.dataset.id);
            if (action === 'favorite-call') return this.#actions.favoriteCall?.(target.dataset.id);
            if (action === 'delete-call') return this.#actions.deleteCall?.(target.dataset.id);
            if (action === 'delete-contact') return this.#actions.deleteContact?.(target.dataset.id);
            if (action === 'open-contact-route') return this.#actions.openContactRoute?.(target.dataset.id);
            if (action === 'open-engine') return this.#actions.openEngine?.(target.dataset.id);
            if (action === 'set-provider') return this.#actions.setProvider?.(target.dataset.id);
            if (action === 'check-provider') return this.#actions.checkProvider?.(target.dataset.id);
            if (action === 'sync-resources') return this.#actions.syncResources?.(target.dataset.id);
            if (action === 'add-openai-profile') return this.#actions.addOpenAIProfile?.();
            if (action === 'activate-openai-profile') return this.#actions.activateOpenAIProfile?.(target.dataset.id);
            if (action === 'delete-openai-profile') return this.#actions.deleteOpenAIProfile?.(target.dataset.id);
            if (action === 'toggle-secret') return this.#actions.toggleSecret?.(target.dataset.id);
            if (action === 'add-prompt-preset') return this.#actions.addPromptPreset?.();
            if (action === 'delete-prompt-preset') return this.#actions.deletePromptPreset?.();
            if (action === 'add-prompt-entry') return this.#actions.addPromptEntry?.();
            if (action === 'move-prompt-entry') return this.#actions.movePromptEntry?.(target.dataset.entry, target.dataset.dir);
            if (action === 'remove-prompt-entry') return this.#actions.removePromptEntry?.(target.dataset.entry);
            if (action === 'remove-sticker') return this.#actions.removeSticker?.(target.dataset.name);
            if (action === 'clear-stickers') return this.#actions.clearStickers?.();
        });

        this.#root.addEventListener('submit', (event) => {
            const form = event.target instanceof HTMLFormElement ? event.target : null;
            if (!form || form.dataset.form !== 'chat') return;
            event.preventDefault();
            this.#actions.sendChat?.();
        });

        this.#root.addEventListener('change', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            if (target.dataset.setting) return this.#actions.updateSetting?.(target.dataset.setting, target.type === 'checkbox' ? target.checked : target.value);
            if (target.dataset.proactive) return this.#actions.updateProactive?.(target.dataset.proactive, target.type === 'checkbox' ? target.checked : Number(target.value));
            if (target.dataset.role === 'call-strategy') return this.#actions.updateCallStrategy?.(target.value);
            if (target.dataset.role === 'call-contact-picker') return this.#actions.updateCallContacts?.([...target.selectedOptions].map((option) => option.value));
            if (target.dataset.customColor) return this.#actions.updateCustomColor?.(target.dataset.customColor, target.value);
            if (target.dataset.role === 'prompt-workflow') return this.#actions.selectPromptWorkflow?.(target.value);
            if (target.dataset.role === 'prompt-preset') return this.#actions.selectPromptPreset?.(target.value);
            if (target.dataset.role === 'prompt-preset-name') return this.#actions.renamePromptPreset?.(target.value);
            if (target.dataset.engineSecret) return this.#actions.saveEngineSecret?.(target.dataset.engineSecret, target.value);
            if (target.dataset.openaiSecret) return this.#actions.saveOpenAISecret?.(target.dataset.id, target.value);
            if (target.dataset.engineField) return this.#actions.updateEngineField?.(target.dataset.engineField, target.value);
            if (target.dataset.openaiField) return this.#actions.updateOpenAIProfile?.(target.dataset.id, target.dataset.openaiField, target.value);
            if (target.dataset.promptField) return this.#actions.updatePromptEntryField?.(target.dataset.entry, target.dataset.promptField, target.type === 'checkbox' ? target.checked : target.value);
            if (target.dataset.groupMember) return this.#actions.toggleGroupMember?.(target.dataset.groupMember, target.checked);
            if (target.dataset.role === 'wallpaper-url') return this.#actions.updateWallpaperUrl?.(target.value);
            if (target.dataset.role === 'wallpaper-file') return this.#actions.uploadWallpaper?.(target.files?.[0]);
            if (target.dataset.role === 'call-length') return this.#actions.updateCallLength?.(target.value);
            if (target.dataset.role === 'route-engine') return this.#actions.updateRouteEngine?.(target.value);
            if (target.dataset.role === 'route-voice') return this.#actions.updateRouteVoice?.(target.value);
            if (target.dataset.novelaiSetting) return this.#actions.updateNovelAiSetting?.(target.dataset.novelaiSetting, target.type === 'checkbox' ? target.checked : target.value);
        });

        this.#root.addEventListener('input', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            if (target.dataset.role === 'chat-input') return this.#actions.updateComposerText?.(target.value);
            if (target.dataset.role === 'novelai-tags') return this.#actions.updateNovelAiTags?.(target.value);
            if (target.dataset.promptField === 'content') return this.#actions.updatePromptEntryField?.(target.dataset.entry, 'content', target.value);
            if (target.dataset.promptField === 'name') return this.#actions.updatePromptEntryField?.(target.dataset.entry, 'name', target.value);
            if (target.dataset.openaiField) return this.#actions.updateOpenAIProfile?.(target.dataset.id, target.dataset.openaiField, target.value);
        });

        this.#root.addEventListener('keydown', (event) => {
            if (!(event.target instanceof HTMLElement)) return;
            if (event.target.dataset.role === 'chat-input' && event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                this.#actions.sendChat?.();
            }
        });
    }

    #appendDialDigit(digit) {
        this.#actions.dialDigit?.(digit);
    }

    #bindOrbGestures() {
        const orb = this.#orb;
        orb?.addEventListener('click', (event) => {
            if (this.#suppressOrbClick) {
                event.preventDefault();
                return;
            }
            this.#actions.open?.();
        });
        orb?.addEventListener('pointerdown', (event) => this.#startOrbDrag(event));
    }

    #startOrbDrag(event) {
        if (!event || (event.pointerType !== 'mouse' && event.pointerType !== 'touch' && event.pointerType !== 'pen')) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        const orb = this.#orb;
        if (!(orb instanceof HTMLElement)) return;
        this.#suppressOrbClick = false;
        const rect = orb.getBoundingClientRect();
        this.#drag = { startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, orb, moved: false };
        orb.setPointerCapture?.(event.pointerId);
        this.#orbMoveHandler = (moveEvent) => this.#moveOrb(moveEvent);
        this.#orbEndHandler = (endEvent) => this.#endOrbDrag(endEvent);
        window.addEventListener('pointermove', this.#orbMoveHandler, { capture: true, passive: false });
        window.addEventListener('pointerup', this.#orbEndHandler, true);
        window.addEventListener('pointercancel', this.#orbEndHandler, true);
    }

    #moveOrb(event) {
        const drag = this.#drag;
        if (!drag) return;
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6) drag.moved = true;
        if (!drag.moved) return;
        const maxX = Math.max(0, window.innerWidth - drag.orb.offsetWidth);
        const maxY = Math.max(0, window.innerHeight - drag.orb.offsetHeight);
        drag.orb.dataset.dragging = 'true';
        drag.orb.style.left = Math.min(maxX, Math.max(0, event.clientX - drag.offsetX)) + 'px';
        drag.orb.style.top = Math.min(maxY, Math.max(0, event.clientY - drag.offsetY)) + 'px';
        drag.orb.style.right = 'auto';
        drag.orb.style.bottom = 'auto';
    }

    #endOrbDrag() {
        const drag = this.#drag;
        this.#drag = null;
        this.#removeOrbWindowListeners();
        if (!drag) return;
        if (drag.moved) {
            this.#suppressOrbClick = true;
            const side = drag.orb.offsetLeft + drag.orb.offsetWidth / 2 < window.innerWidth / 2 ? 'left' : 'right';
            const dockY = Math.min(1, Math.max(0, drag.orb.offsetTop / Math.max(1, window.innerHeight - drag.orb.offsetHeight)));
            this.#actions.updateDock?.({ dockSide: side, dockY });
            drag.orb.dataset.dragging = 'false';
            drag.orb.style.left = '';
            drag.orb.style.top = '';
            window.setTimeout(() => { this.#suppressOrbClick = false; }, 420);
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

    #fitPhone() {
        if (!this.#root) return;
        const fit = Math.min((window.innerWidth - 16) / 390, (window.innerHeight - 16) / 844);
        const scale = Math.min(1.12, Math.max(0.55, fit));
        this.#root.style.setProperty('--phonie-scale', scale.toFixed(4));
    }

    // ---- 启动器 -----------------------------------------------------------
    #mountSettingsLauncher() {
        const container = document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
        if (!container) return window.setTimeout(() => { if (this.#root?.isConnected && !this.#launcher) this.#mountSettingsLauncher(); }, 700);
        if (document.getElementById('phonie-settings-launcher')) return;
        const launcher = document.createElement('div');
        launcher.id = 'phonie-settings-launcher';
        launcher.className = 'extension_container phonie-settings-launcher';
        launcher.innerHTML = `<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>Phonie 声纹手机</b><div class="inline-drawer-icon down">${icon('chevron', 'phonie-icon phonie-launcher-chevron')}</div></div><div class="inline-drawer-content"><label for="phonie-launcher-mode">打开入口</label><select id="phonie-launcher-mode" class="text_pole" data-launcher-setting="launcherMode"><option value="orb">悬浮球</option><option value="wand">酒馆魔棒菜单</option><option value="both">两者都显示</option></select><button class="menu_button" type="button" data-launcher-action="open"><span>打开手机</span></button></div></div>`;
        launcher.querySelector('[data-launcher-action="open"]')?.addEventListener('click', () => this.#actions.open?.());
        launcher.querySelector('[data-launcher-setting="launcherMode"]')?.addEventListener('change', (event) => this.#actions.updateSetting?.('launcherMode', event.currentTarget.value));
        container.append(launcher);
        this.#launcher = launcher;
    }

    #mountWandLauncher() {
        if (this.#wandLauncher?.isConnected) return;
        const container = document.getElementById('extensionsMenu');
        if (!container) return window.setTimeout(() => { if (this.#root?.isConnected && !this.#wandLauncher?.isConnected) this.#mountWandLauncher(); }, 700);
        document.getElementById('phonie-wand-menu-item')?.remove();
        const item = document.createElement('div');
        item.id = 'phonie-wand-menu-item';
        item.className = 'list-group-item flex-container flexGap5';
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.innerHTML = `<div class="extensionsMenuExtensionButton">${icon('phone', 'phonie-icon phonie-menu-icon')}</div><span>Phonie 手机</span>`;
        const open = () => this.#actions.open?.();
        item.addEventListener('click', open);
        item.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
        container.append(item);
        this.#wandLauncher = item;
    }

    // ---- 渲染 -------------------------------------------------------------
    render(state) {
        if (!this.#root) return;
        this.#root.dataset.open = String(Boolean(state.open));
        this.#root.dataset.theme = state.settings?.theme || THEMES.DAY;
        this.#applyTheme(state);
        this.#applyStatusBar(state.deviceStatus);
        this.#applyIsland(state);
        this.#applyScreen(state);
        this.#applyContact(state);
        this.#applyToast(state);
        this.#applyCall(state);
        this.#syncComposer(state);
        this.#renderDynamic(state);
        if (this.#orb) {
            this.#orb.hidden = state.open || state.settings?.launcherMode === 'wand';
            if (!this.#drag?.moved) this.#positionOrb(state.settings);
        }
        const wandVisible = ['wand', 'both'].includes(state.settings?.launcherMode);
        if (this.#wandLauncher) this.#wandLauncher.hidden = !wandVisible;
    }

    #applyTheme(state) {
        const phone = this.#root.querySelector('.phonie-phone');
        if (!(phone instanceof HTMLElement)) return;
        const settings = state.settings || {};
        const theme = settings.theme || THEMES.DAY;
        let palette;
        if (theme === THEMES.CUSTOM) palette = { ...THEME_PALETTES[THEMES.DAY], ...(settings.customTheme?.colors || {}) };
        else if (theme === THEMES.TAVERN) palette = state.tavernScheme === 'light' ? THEME_PALETTES[THEMES.DAY] : THEME_PALETTES[THEMES.NIGHT];
        else palette = THEME_PALETTES[theme] || THEME_PALETTES[THEMES.DAY];
        for (const [key, value] of Object.entries(palette)) phone.style.setProperty(key, value);
        const wallpaper = this.#root.querySelector('[data-role="wallpaper"]');
        if (wallpaper instanceof HTMLElement) {
            const customUrl = theme === THEMES.CUSTOM && (settings.customTheme?.wallpaperUrl || state.themeAssetUrls?.wallpaper);
            wallpaper.style.backgroundImage = customUrl ? `url(${JSON.stringify(String(customUrl))})` : '';
            wallpaper.dataset.hasImage = customUrl ? 'true' : 'false';
        }
        phone.dataset.scheme = palette['--phonie-scheme'] || 'light';
    }

    #applyStatusBar(deviceStatus) {
        const clock = this.#root.querySelector('[data-role="clock"]');
        if (clock) clock.textContent = deviceStatus?.time || '--:--';
        const network = deviceStatus?.network;
        const networkEl = this.#root.querySelector('[data-role="network"]');
        const wifiEl = this.#root.querySelector('[data-role="wifi"]');
        if (networkEl) networkEl.textContent = network?.kind === 'wifi' ? '' : (network?.label || '未知');
        if (wifiEl) wifiEl.hidden = network?.kind !== 'wifi';
        const battery = deviceStatus?.battery;
        const fill = this.#root.querySelector('[data-role="battery-fill"]');
        const label = this.#root.querySelector('[data-role="battery-label"]');
        const charging = this.#root.querySelector('[data-role="charging"]');
        if (fill instanceof HTMLElement) {
            fill.style.width = battery?.available ? `${battery.percent}%` : '0%';
            fill.dataset.unknown = battery?.available ? 'false' : 'true';
        }
        if (label) label.textContent = battery?.available ? `${battery.percent}%` : '';
        if (charging instanceof HTMLElement) charging.hidden = !battery?.charging;
    }

    #applyIsland(state) {
        const island = this.#root.querySelector('[data-role="island"]');
        const label = this.#root.querySelector('[data-role="island-label"]');
        if (!(island instanceof HTMLElement)) return;
        const islandState = state.islandState || ISLAND_STATES.IDLE;
        island.dataset.state = islandState;
        if (label) label.textContent = ISLAND_COPY[islandState] || '';
    }

    #applyScreen(state) {
        const screen = state.screen || SCREENS.HOME;
        this.#root.dataset.screen = screen;
        for (const section of this.#root.querySelectorAll('.phonie-screen')) {
            section.classList.toggle('is-active', section.dataset.screen === screen);
        }
        const dock = this.#root.querySelector('[data-role="dock"]');
        if (dock) dock.hidden = screen !== SCREENS.HOME || state.callActive;
    }

    #applyContact(state) {
        const contact = state.contact || { name: 'Character' };
        for (const role of ['qq', 'contacts']) {
            const nameEl = this.#root.querySelector(`[data-role="${role}-name"]`);
            const initialsEl = this.#root.querySelector(`[data-role="${role}-initials"]`);
            const avatarEl = this.#root.querySelector(`[data-role="${role}-avatar"]`);
            if (nameEl) nameEl.textContent = contact.name;
            if (initialsEl) initialsEl.textContent = initials(contact.name);
            if (avatarEl instanceof HTMLElement) avatarEl.style.backgroundImage = contact.avatarUrl ? `url('${escapeHtml(contact.avatarUrl)}')` : '';
        }
        const chatTitle = this.#root.querySelector('[data-role="chat-title"]');
        if (chatTitle) chatTitle.textContent = (state.chatParticipants && state.chatParticipants.length > 1)
            ? state.chatParticipants.map((entry) => entry.name).join('、')
            : (state.chatParticipants?.[0]?.name || contact.name);
        const chatSettings = this.#root.querySelector('[data-role="chat-settings"]');
        if (chatSettings instanceof HTMLElement) chatSettings.hidden = !state.chatSettingsOpen;
    }

    #applyToast(state) {
        const toast = this.#root.querySelector('[data-role="toast"]');
        if (!(toast instanceof HTMLElement)) return;
        toast.dataset.visible = state.toast?.text ? 'true' : 'false';
        if (state.toast?.text) toast.textContent = state.toast.text;
    }

    #syncComposer(state) {
        const send = this.#root.querySelector('[data-role="chat-send"]');
        if (send instanceof HTMLElement) {
            send.dataset.pending = String(state.pendingUserMessageIds?.length > 0 && !String(state.composerText || '').trim());
            send.disabled = Boolean(state.generating);
        }
        const input = this.#root.querySelector('[data-role="chat-input"]');
        if (input instanceof HTMLTextAreaElement && input !== document.activeElement && input.value !== String(state.composerText || '')) {
            input.value = String(state.composerText || '');
        }
    }

    #applyCall(state) {
        const overlay = this.#root.querySelector('[data-role="call-overlay"]');
        if (!(overlay instanceof HTMLElement)) return;
        const active = Boolean(state.callActive);
        overlay.hidden = !active;
        if (!active) return;
        const status = this.#root.querySelector('[data-role="call-status"]');
        const contact = this.#root.querySelector('[data-role="call-contact"]');
        const mark = this.#root.querySelector('[data-role="call-mark"]');
        const initialsEl = this.#root.querySelector('[data-role="call-initials"]');
        const incoming = this.#root.querySelector('[data-role="call-incoming-actions"]');
        const end = this.#root.querySelector('[data-role="call-end"]');
        const captions = this.#root.querySelector('[data-role="call-captions"]');
        const source = this.#root.querySelector('[data-role="call-caption-source"]');
        const translation = this.#root.querySelector('[data-role="call-caption-translation"]');
        const directionLabel = this.#root.querySelector('[data-role="call-direction-label"]');
        const participantOrbit = this.#root.querySelector('[data-role="call-participant-orbit"]');

        const participants = state.callParticipants || [];
        const primary = participants[0] || state.contact;
        if (contact) contact.textContent = participants.length > 1 ? participants.map((entry) => entry.name).join('、') : primary.name;
        if (initialsEl) initialsEl.textContent = initials(primary.name);
        if (mark instanceof HTMLElement) mark.style.backgroundImage = primary.avatarUrl ? `url('${escapeHtml(primary.avatarUrl)}')` : '';
        if (directionLabel) directionLabel.textContent = state.callDirection === 'incoming' ? '来电' : '拨出';
        if (incoming instanceof HTMLElement) incoming.hidden = !(state.callState === CALL_STATES.RINGING && state.callDirection === 'incoming');
        if (end instanceof HTMLElement) end.hidden = !(state.callState === CALL_STATES.CONNECTED || state.callState === CALL_STATES.SPEAKING || (state.callDirection === 'outgoing' && [CALL_STATES.DIALING, CALL_STATES.GENERATING].includes(state.callState)));
        if (captions instanceof HTMLElement) captions.hidden = !state.callCaption?.source;
        if (source) source.textContent = state.callCaption?.source || '';
        if (translation) {
            translation.hidden = !state.callCaption?.translation || state.settings?.sourceLanguage?.toLowerCase().startsWith('zh');
            translation.textContent = state.callCaption?.translation || '';
        }
        const statusLabels = {
            [CALL_STATES.DIALING]: '正在拨号…',
            [CALL_STATES.RINGING]: '对方正在响铃',
            [CALL_STATES.GENERATING]: '正在编排对话',
            [CALL_STATES.SPEAKING]: '通话中',
            [CALL_STATES.CONNECTED]: state.callDuration ? `通话中 ${state.callDuration}` : '通话中',
            [CALL_STATES.ENDED]: '通话已结束',
            [CALL_STATES.ERROR]: '通话连接异常',
        };
        if (status) status.textContent = statusLabels[state.callState] || '通话中';

        if (participantOrbit instanceof HTMLElement) {
            participantOrbit.hidden = participants.length < 2;
            const signature = participants.map((entry) => entry.id).join('|') + '|' + (state.callSpeaker || '');
            if (participantOrbit.dataset.signature !== signature) {
                participantOrbit.dataset.signature = signature;
                participantOrbit.innerHTML = participants.map((entry) => `<span class="phonie-participant-avatar" data-active="${entry.name === state.callSpeaker ? 'true' : 'false'}">${initials(entry.name)}</span>`).join('');
            } else {
                for (const span of participantOrbit.querySelectorAll('.phonie-participant-avatar')) {
                    span.dataset.active = span.textContent === initials(state.callSpeaker || '') ? 'true' : 'false';
                }
            }
        }
    }

    #renderDynamic(state) {
        this.#renderFriendList(state);
        this.#renderGroupList(state);
        this.#renderMessageList(state);
        this.#renderChatStickers(state);
        this.#renderContactDirectory(state);
        this.#renderTraceList(state);
        this.#renderEngineList(state);
        this.#renderEngineDetail(state);
        this.#renderStickerList(state);
        this.#renderOpenAIPresets(state);
        this.#renderPromptEditor(state);
        this.#renderCallPicker(state);
        this.#renderGroupPicker(state);
        this.#renderAddFriendSelect(state);
        this.#renderRouteEditor(state);
        this.#renderNovelAiStatus(state);
        this.#renderCacheStats(state);
        this.#syncFormValues(state);
    }

    #renderFriendList(state) {
        const container = this.#root.querySelector('[data-role="friend-list"]');
        if (!container) return;
        const hidden = new Set(state.temporarilyDeletedCharacterIds || []);
        const friends = (state.characters || []).filter((character) => !hidden.has(character.id) && ((state.settings?.qqFriends || []).includes(character.id) || character.current || character.id === state.contact?.id));
        const signature = friends.map((character) => character.id).join('|');
        if (this.#signatures.friends === signature) return;
        this.#signatures.friends = signature;
        container.innerHTML = friends.length
            ? friends.map((character) => `<button class="phonie-contact-row" type="button" data-action="open-chat" data-id="${escapeHtml(character.id)}"><span class="phonie-contact-avatar" style="${character.avatarUrl ? `background-image:url('${escapeHtml(character.avatarUrl)}')` : ''}">${initials(character.name)}</span><span class="phonie-contact-meta"><strong>${escapeHtml(character.name)}</strong><small>${character.current ? '当前角色' : '好友'}</small></span></button>`).join('')
            : `<p class="phonie-empty-hint">暂无好友</p>`;
    }

    #renderGroupList(state) {
        const container = this.#root.querySelector('[data-role="group-list"]');
        if (!container) return;
        const groups = state.settings?.qqGroups || [];
        const signature = groups.map((group) => group.id).join('|');
        if (this.#signatures.groups === signature) return;
        this.#signatures.groups = signature;
        container.innerHTML = groups.length
            ? groups.map((group) => `<button class="phonie-contact-row" type="button" data-action="open-group" data-id="${escapeHtml(group.id)}"><span class="phonie-contact-avatar phonie-group-avatar">${icon('contacts')}</span><span class="phonie-contact-meta"><strong>${escapeHtml(group.name)}</strong><small>${group.memberIds.length} 人</small></span></button>`).join('')
            : `<p class="phonie-empty-hint">还没有群聊</p>`;
    }

    #renderChatStickers(state) {
        const container = this.#root.querySelector('[data-role="chat-stickers"]');
        if (!container) return;
        const stickers = state.settings?.stickers || [];
        const signature = stickers.map((sticker) => `${sticker.name}:${sticker.url}`).join('|');
        if (this.#signatures.chatStickers === signature) return;
        this.#signatures.chatStickers = signature;
        container.innerHTML = stickers.slice(0, 16).map((sticker) => `<button type="button" data-action="send-sticker" data-name="${escapeHtml(sticker.name)}" title="${escapeHtml(sticker.name)}"><img src="${escapeHtml(sticker.url)}" alt="${escapeHtml(sticker.name)}" loading="lazy"></button>`).join('');
    }

    #renderMessageList(state) {
        const container = this.#root.querySelector('[data-role="message-list"]');
        if (!container) return;
        const signature = (state.messages || []).map((message) => `${message.id}:${message.kind}:${message.audioStatus}`).join('|');
        if (this.#signatures.messages === signature) return;
        this.#signatures.messages = signature;
        const html = (state.messages || []).map((message) => this.#messageMarkup(message, state)).join('');
        container.innerHTML = html;
        container.scrollTop = container.scrollHeight;
    }

    #messageMarkup(message, state) {
        const outgoing = message.direction === 'outgoing';
        const avatar = outgoing ? '' : state.contact?.avatarUrl;
        const initialsText = outgoing ? initials(state.userName || 'U') : initials(message.author || 'C');
        const avatarStyle = avatar ? `background-image:url('${escapeHtml(avatar)}')` : '';
        const recalled = message.kind === MESSAGE_KINDS.RECALLED;
        let body = '';
        if (recalled) {
            body = `<p class="phonie-message__recalled">消息已撤回</p>`;
        } else if (message.kind === MESSAGE_KINDS.TRANSFER) {
            body = `<div class="phonie-money-card">${icon('wallet')}<span><small>转账</small><strong>¥ ${Number(message.amount || 0).toFixed(2)}</strong><i>${escapeHtml(message.note || '')}</i></span></div>`;
        } else if (message.kind === MESSAGE_KINDS.IMAGE) {
            body = message.imageUrl
                ? `<img class="phonie-message__image" src="${escapeHtml(message.imageUrl)}" alt="图片">`
                : `<div class="phonie-message__image-ph"><span>${message.imageStatus === 'error' ? '生成失败' : '图片生成中…'}</span><small>${escapeHtml(message.imageDescription || '')}</small></div>`;
        } else if (message.kind === MESSAGE_KINDS.STICKER) {
            body = message.imageUrl
                ? `<img class="phonie-message__sticker-image" src="${escapeHtml(message.imageUrl)}" alt="${escapeHtml(message.stickerName || '表情包')}">`
                : `<div class="phonie-message__sticker">${escapeHtml(message.stickerName || '表情包')}</div>`;
        } else if (message.kind === MESSAGE_KINDS.VOICE) {
            body = `<button class="phonie-voice-bubble" type="button" data-action="play-message-audio" data-id="${escapeHtml(message.id)}">${icon(message.isPlaying ? 'pause' : 'play')}<span class="phonie-voice-wave"><i></i><i></i><i></i><i></i><i></i></span></button>`;
            if (!outgoing) body += `<p class="phonie-message__source">${escapeHtml(message.originalText)}</p>`;
        } else {
            body = `<p class="phonie-message__source">${escapeHtml(message.originalText)}</p>`;
            if (state.settings?.showTranslation && message.translatedText && message.translatedText !== message.originalText) {
                body += `<p class="phonie-message__translation">${escapeHtml(message.translatedText)}</p>`;
            }
        }
        const controls = outgoing && !recalled ? `<button class="phonie-message__recall" type="button" data-action="recall-message" data-id="${escapeHtml(message.id)}">撤回</button>` : '';
        return `<div class="phonie-message phonie-message--${outgoing ? 'out' : 'in'}"><span class="phonie-message__avatar" style="${avatarStyle}">${initialsText}</span><div class="phonie-message__stack"><div class="phonie-message__body">${body}</div>${controls}</div></div>`;
    }

    #renderContactDirectory(state) {
        const container = this.#root.querySelector('[data-role="contact-directory"]');
        if (!container) return;
        const signature = (state.characters || []).map((character) => character.id).join('|');
        if (this.#signatures.contacts === signature) return;
        this.#signatures.contacts = signature;
        container.innerHTML = (state.characters || []).map((character) => `<div class="phonie-contact-row">
            <button class="phonie-contact-main" type="button" data-action="open-contact-route" data-id="${escapeHtml(character.id)}">
                <span class="phonie-contact-avatar" style="${character.avatarUrl ? `background-image:url('${escapeHtml(character.avatarUrl)}')` : ''}">${initials(character.name)}</span>
                <span class="phonie-contact-meta"><strong>${escapeHtml(character.name)}</strong><small>${character.current ? '当前角色' : '联系人'} · ${virtualPhoneNumber(character.id)}</small></span>
            </button>
            <button class="phonie-icon-btn phonie-danger-mini" type="button" data-action="delete-contact" data-id="${escapeHtml(character.id)}" aria-label="删除">${icon('trash')}</button>
        </div>`).join('') || `<p class="phonie-empty-hint">还没有联系人</p>`;
    }

    #renderTraceList(state) {
        const container = this.#root.querySelector('[data-role="trace-list"]');
        if (!container) return;
        const favoriteIds = new Set((state.settings?.favoriteCalls || []).map((record) => record.id));
        const signature = (state.calls || []).map((record) => `${record.id}:${favoriteIds.has(record.id)}`).join('|');
        if (this.#signatures.trace === signature) return;
        this.#signatures.trace = signature;
        container.innerHTML = (state.calls || []).length
            ? (state.calls || []).slice().reverse().map((record) => `<div class="phonie-record-row">
                <span class="phonie-record-meta"><strong>${escapeHtml(record.contactName)}</strong><small>${record.direction === 'incoming' ? '来电' : '拨出'} · ${formatDuration(record.startedAt, record.endedAt)} · ${escapeHtml(record.title || record.outcome)}</small></span>
                <span class="phonie-record-actions"><button type="button" data-action="favorite-call" data-id="${escapeHtml(record.id)}" data-active="${favoriteIds.has(record.id)}" aria-label="收藏">${icon('star')}</button><button type="button" data-action="replay-call" data-id="${escapeHtml(record.id)}" aria-label="重播">${icon('play')}</button><button type="button" data-action="rerender-call" data-id="${escapeHtml(record.id)}" aria-label="按当前引擎重渲染">${icon('trace')}</button><button type="button" data-action="delete-call" data-id="${escapeHtml(record.id)}" aria-label="删除">${icon('trash')}</button></span>
            </div>`).join('')
            : `<p class="phonie-empty-hint">还没有通话记录</p>`;
    }

    #renderEngineList(state) {
        const container = this.#root.querySelector('[data-role="engine-list"]');
        if (!container) return;
        container.innerHTML = ENGINES.map((engine) => `<button class="phonie-engine-card" type="button" data-action="open-engine" data-id="${engine.id}" style="--engine-color:${engine.color}">
            <span class="phonie-engine-icon">${icon(engine.icon)}</span>
            <span class="phonie-engine-meta"><strong>${escapeHtml(engine.name)}</strong><small>${state.settings?.ttsActiveProvider === engine.id ? '当前引擎' : '点击配置'}</small></span>
            ${icon('chevron')}
        </button>`).join('');
    }

    #renderEngineDetail(state) {
        const container = this.#root.querySelector('[data-role="engine-detail"]');
        if (!container) return;
        const engine = ENGINES.find((entry) => entry.id === state.selectedEngineId);
        if (!engine) {
            container.innerHTML = '';
            return;
        }
        const healthy = Boolean(state.providerCheckResults?.[engine.id]);
        const signature = `${engine.id}:${healthy}`;
        if (this.#signatures.engineDetail === signature) return;
        this.#signatures.engineDetail = signature;
        const config = state.settings?.ttsProviderSettings?.[engine.id] || {};
        let fields = '';
        if (engine.kind === 'http-json') {
            fields = `<label class="phonie-field"><span>服务地址</span><input data-engine-field="baseUrl" value="${escapeHtml(config.baseUrl || '')}" placeholder="http://127.0.0.1:8000"></label><label class="phonie-field"><span>默认音色</span><input data-engine-field="voice" value="${escapeHtml(config.voice || '')}" placeholder="voice id"></label>`;
        } else if (engine.kind === 'rest') {
            fields = `<label class="phonie-field"><span>API Key</span><input type="password" autocomplete="off" data-engine-secret="elevenlabs" value="" placeholder="${config.secretId ? '已保存 · 输入可替换' : '输入 API Key'}"></label><label class="phonie-field"><span>音色 ID</span><input data-engine-field="voice" value="${escapeHtml(config.voice || '')}"></label>`;
        } else if (engine.kind === 'server-plugin') {
            const apiHost = String(config.apiHost || 'https://api.minimax.io');
            const hostOptions = ['https://api.minimax.io', 'https://api.minimaxi.com']
                .map((host) => `<option value="${host}" ${host === apiHost ? 'selected' : ''}>${host.includes('minimaxi') ? '大陆站' : '国际站'}</option>`)
                .join('');
            fields = `<label class="phonie-field"><span>服务区域</span><select data-engine-field="apiHost">${hostOptions}</select></label><label class="phonie-field"><span>语音模型</span><input data-engine-field="model" value="${escapeHtml(config.model || 'speech-2.8-hd')}" placeholder="speech-2.8-hd"></label><label class="phonie-field"><span>音色 ID</span><input data-engine-field="voice" value="${escapeHtml(config.voice || '')}" placeholder="voice_id"></label>`;
        } else {
            fields = `<label class="phonie-field"><span>语言</span><input data-engine-field="lang" value="${escapeHtml(config.lang || '')}" placeholder="zh-CN"></label>`;
        }
        const syncButton = engine.kind === 'server-plugin'
            ? `<button class="phonie-primary-btn phonie-secondary-btn" type="button" data-action="sync-resources" data-id="${engine.id}">${icon('refresh')}<span>同步模型与音色</span></button>`
            : '';
        container.innerHTML = `<div class="phonie-engine-hero" style="--engine-color:${engine.color}"><span class="phonie-engine-icon">${icon(engine.icon)}</span><span><small>语音引擎</small><strong>${escapeHtml(engine.name)}</strong></span></div><div class="phonie-settings-card">${fields}<p class="phonie-provider-status" data-healthy="${healthy}">${healthy ? '连接已验证，可以启用' : '启用前需要通过连接检测'}</p><div class="phonie-button-row"><button class="phonie-primary-btn phonie-secondary-btn" type="button" data-action="check-provider" data-id="${engine.id}">${icon('spark')}<span>连接检测</span></button>${syncButton}<button class="phonie-primary-btn" type="button" data-action="set-provider" data-id="${engine.id}">${icon('check')}<span>设为当前引擎</span></button></div></div>`;
    }

    #renderStickerList(state) {
        const container = this.#root.querySelector('[data-role="sticker-list"]');
        if (!container) return;
        const stickers = state.settings?.stickers || [];
        const signature = stickers.map((sticker) => sticker.name).join('|');
        if (this.#signatures.stickers === signature) return;
        this.#signatures.stickers = signature;
        container.innerHTML = stickers.map((sticker) => `<span class="phonie-sticker-item"><img src="${escapeHtml(sticker.url)}" alt="${escapeHtml(sticker.name)}" loading="lazy"><small>${escapeHtml(sticker.name)}</small><button type="button" data-action="remove-sticker" data-name="${escapeHtml(sticker.name)}" aria-label="删除 ${escapeHtml(sticker.name)}">${icon('close')}</button></span>`).join('') || `<p class="phonie-empty-hint">还没有表情包</p>`;
    }

    #renderOpenAIPresets(state) {
        const container = this.#root.querySelector('[data-role="openai-profile-list"]');
        if (!container) return;
        const presets = state.settings?.customOpenAIPresets || [];
        const signature = presets.map((preset) => preset.id + preset.name).join('|');
        if (this.#signatures.openai === signature) return;
        this.#signatures.openai = signature;
        container.innerHTML = `<button class="phonie-primary-btn phonie-secondary-btn" type="button" data-action="add-openai-profile">${icon('plus')}<span>新增预设</span></button>` + presets.map((preset) => `<div class="phonie-openai-card">
            <span class="phonie-openai-head"><strong>${escapeHtml(preset.name)}</strong>${state.settings?.activeCustomOpenAIPresetId === preset.id ? '<b>当前</b>' : ''}</span>
            <label class="phonie-field"><span>预设名称</span><input data-openai-field="name" data-id="${preset.id}" value="${escapeHtml(preset.name || '')}"></label>
            <label class="phonie-field"><span>API 地址</span><input data-openai-field="endpoint" data-id="${preset.id}" value="${escapeHtml(preset.endpoint || '')}"></label>
            <label class="phonie-field"><span>API Key</span><span class="phonie-secret-row"><input type="password" autocomplete="off" data-openai-secret="true" data-id="${preset.id}" value="" placeholder="${preset.secretId ? '已保存 · 输入可替换' : '输入 API Key'}"><button type="button" data-action="toggle-secret" data-id="${preset.id}" aria-label="显示或隐藏当前输入">${icon('eye')}</button></span></label>
            <label class="phonie-field"><span>模型</span><input data-openai-field="model" data-id="${preset.id}" value="${escapeHtml(preset.model || '')}"></label>
            <label class="phonie-field"><span>温度</span><input type="number" step="0.1" data-openai-field="temperature" data-id="${preset.id}" value="${preset.temperature ?? 0.7}"></label>
            <label class="phonie-field"><span>最大 Token（上限 30000）</span><input type="number" min="1" max="30000" data-openai-field="maxTokens" data-id="${preset.id}" value="${preset.maxTokens ?? 8192}"></label>
            <span class="phonie-inline-actions"><button type="button" data-action="activate-openai-profile" data-id="${preset.id}">启用</button><button type="button" data-action="delete-openai-profile" data-id="${preset.id}">删除</button></span>
        </div>`).join('');
    }

    #renderPromptEditor(state) {
        const container = this.#root.querySelector('[data-role="prompt-editor"]');
        if (!container) return;
        const kind = state.promptWorkflow || 'body';
        const preset = state.settings?.promptPresets?.[kind];
        if (!preset) return;
        const libraryPresets = Array.isArray(preset.presets) && preset.presets.length ? preset.presets : [preset];
        const signature = kind + '|' + preset.activePresetId + '|' + libraryPresets.map((item) => `${item.id}:${item.name}`).join('|') + '|' + preset.entries.map((entry) => entry.id).join('|');
        if (this.#signatures.prompt === signature) return;
        this.#signatures.prompt = signature;
        const presetOptions = libraryPresets.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === preset.activePresetId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
        const rows = preset.entries.map((entry) => `<div class="phonie-prompt-entry">
            <span class="phonie-prompt-entry__head"><input data-prompt-field="name" data-entry="${entry.id}" value="${escapeHtml(entry.name || '')}" placeholder="条目名"><span class="phonie-inline-actions"><button type="button" data-action="move-prompt-entry" data-entry="${entry.id}" data-dir="up" aria-label="上移条目">${icon('arrowUp')}</button><button type="button" data-action="move-prompt-entry" data-entry="${entry.id}" data-dir="down" aria-label="下移条目">${icon('arrowDown')}</button><button type="button" data-action="remove-prompt-entry" data-entry="${entry.id}" aria-label="删除条目">${icon('trash')}</button></span></span>
            <span class="phonie-prompt-entry__meta"><select data-prompt-field="role" data-entry="${entry.id}">${PROMPT_ROLES.map((role) => `<option value="${role}" ${entry.role === role ? 'selected' : ''}>${role}</option>`).join('')}</select><input type="number" min="0" max="20" data-prompt-field="depth" data-entry="${entry.id}" value="${entry.depth}"><label><input type="checkbox" data-prompt-field="enabled" data-entry="${entry.id}" ${entry.enabled ? 'checked' : ''}>启用</label></span>
            <textarea rows="3" data-prompt-field="content" data-entry="${entry.id}">${escapeHtml(entry.content)}</textarea>
        </div>`).join('');
        container.innerHTML = `<div class="phonie-prompt-presets">
            <label class="phonie-field"><span>当前预设</span><select data-role="prompt-preset">${presetOptions}</select></label>
            <label class="phonie-field"><span>预设名称</span><input maxlength="80" data-role="prompt-preset-name" value="${escapeHtml(preset.name || '')}"></label>
            <span class="phonie-button-row"><button class="phonie-primary-btn phonie-secondary-btn" type="button" data-action="add-prompt-preset">${icon('library')}<span>复制为新预设</span></button><button class="phonie-danger-btn phonie-danger-btn--soft" type="button" data-action="delete-prompt-preset" aria-label="删除当前预设">${icon('trash')}<span>删除预设</span></button></span>
        </div><button class="phonie-primary-btn phonie-secondary-btn" type="button" data-action="add-prompt-entry">${icon('plus')}<span>新增条目</span></button>${rows}`;
    }

    #renderCallPicker(state) {
        const select = this.#root.querySelector('[data-role="call-contact-picker"]');
        if (!(select instanceof HTMLSelectElement)) return;
        const selectedIds = new Set(state.selectedCallContactIds || []);
        const signature = (state.characters || []).map((character) => `${character.id}:${selectedIds.has(character.id)}`).join('|');
        if (this.#signatures.callPicker === signature) return;
        this.#signatures.callPicker = signature;
        const options = (state.characters || []).map((character) => `<option value="${escapeHtml(character.id)}" ${selectedIds.has(character.id) ? 'selected' : ''}>${escapeHtml(character.name)} · ${virtualPhoneNumber(character.id)}</option>`).join('');
        select.innerHTML = options;
    }

    #renderGroupPicker(state) {
        const container = this.#root.querySelector('[data-role="group-member-picker"]');
        if (!container) return;
        const friends = (state.characters || []).filter((character) => (state.settings?.qqFriends || []).includes(character.id));
        const signature = friends.map((character) => character.id).join('|');
        if (this.#signatures.groupPicker === signature) return;
        this.#signatures.groupPicker = signature;
        container.innerHTML = friends.length
            ? friends.map((character) => `<label class="phonie-check-row"><input type="checkbox" data-group-member="${escapeHtml(character.id)}"><span>${escapeHtml(character.name)}</span></label>`).join('')
            : `<p class="phonie-empty-hint">请先添加好友</p>`;
    }

    #renderAddFriendSelect(state) {
        const select = this.#root.querySelector('[data-role="add-friend-select"]');
        if (!(select instanceof HTMLSelectElement)) return;
        const candidates = (state.characters || []).filter((character) => !(state.settings?.qqFriends || []).includes(character.id));
        const signature = candidates.map((character) => character.id).join('|');
        if (this.#signatures.addFriend === signature) return;
        this.#signatures.addFriend = signature;
        select.innerHTML = candidates.length
            ? candidates.map((character) => `<option value="${escapeHtml(character.id)}">${escapeHtml(character.name)}</option>`).join('')
            : `<option value="">通讯录里没有可添加的联系人</option>`;
    }

    #renderRouteEditor(state) {
        const container = this.#root.querySelector('[data-role="route-editor"]');
        if (!container) return;
        const contact = (state.characters || []).find((character) => character.id === state.selectedCharacterId) || state.contact;
        if (!contact) {
            container.innerHTML = '';
            return;
        }
        const route = state.settings?.ttsCharacterRoutes?.[contact.id] || {};
        const engineOptions = ENGINES.map((engine) => `<option value="${engine.id}" ${(route.providerId || state.settings?.ttsActiveProvider) === engine.id ? 'selected' : ''}>${escapeHtml(engine.name)}</option>`).join('');
        container.innerHTML = `
            <p class="phonie-sheet-sub">${escapeHtml(contact.name)} 的声线</p>
            <label class="phonie-field"><span>引擎</span><select data-role="route-engine">${engineOptions}</select></label>
            <label class="phonie-field"><span>音色</span><input data-role="route-voice" value="${escapeHtml(route.voice || '')}" placeholder="音色 ID / 名字"></label>
            <label class="phonie-field"><span>原文语言</span><input data-role="route-lang" value="${escapeHtml(route.lang || '')}" placeholder="zh-CN"></label>`;
    }

    #renderNovelAiStatus(state) {
        const status = this.#root.querySelector('[data-role="novelai-status"]');
        if (status) status.textContent = state.novelStatus || '';
        const preview = this.#root.querySelector('[data-role="draw-preview"]');
        if (preview && state.novelImage) {
            preview.innerHTML = `<img src="${escapeHtml(state.novelImage)}" alt="生成图片">`;
        }
    }

    #renderCacheStats(state) {
        const stats = this.#root.querySelector('[data-role="cache-stats"]');
        if (!stats) return;
        const value = state.audioCacheStats;
        stats.textContent = value ? `${value.count} 段 · ${formatBytes(value.bytes)}` : '正在统计…';
    }

    #syncFormValues(state) {
        for (const input of this.#root.querySelectorAll('[data-setting]')) {
            if (input === document.activeElement) continue;
            const key = input.dataset.setting;
            const value = state.settings?.[key];
            if (input.type === 'checkbox') input.checked = Boolean(value);
            else if (input.value !== String(value ?? '')) input.value = String(value ?? '');
        }
        for (const input of this.#root.querySelectorAll('[data-proactive]')) {
            if (input === document.activeElement) continue;
            const key = input.dataset.proactive;
            const value = state.settings?.proactiveCalls?.[key];
            if (input.type === 'checkbox') input.checked = Boolean(value);
            else if (input.value !== String(value ?? '')) input.value = String(value ?? '');
        }
        for (const input of this.#root.querySelectorAll('[data-novelai-setting]')) {
            if (input === document.activeElement) continue;
            const value = state.settings?.novelAi?.[input.dataset.novelaiSetting];
            if (input.type === 'checkbox') input.checked = Boolean(value);
            else if (input.value !== String(value ?? '')) input.value = String(value ?? '');
        }
    }

    #positionOrb(settings) {
        const orb = this.#orb;
        if (!(orb instanceof HTMLElement)) return;
        const dockY = Math.min(1, Math.max(0, Number(settings?.dockY) || 0.5));
        const size = orb.offsetHeight || 54;
        const edge = 8;
        const range = Math.max(0, window.innerHeight - size - edge * 2);
        orb.style.top = Math.round(edge + dockY * range) + 'px';
        orb.style.bottom = 'auto';
        if (settings?.dockSide === 'left') {
            orb.style.left = '-12px';
            orb.style.right = 'auto';
        } else {
            orb.style.right = '-12px';
            orb.style.left = 'auto';
        }
    }

    dispose() {
        this.#unsubscribe?.();
        this.#removeOrbWindowListeners();
        if (this.#resizeHandler) window.removeEventListener('resize', this.#resizeHandler);
        this.#launcher?.remove();
        this.#wandLauncher?.remove();
        this.#orb?.remove();
        this.#root?.remove();
        this.#launcher = null;
        this.#wandLauncher = null;
        this.#orb = null;
        this.#root = null;
    }
}
