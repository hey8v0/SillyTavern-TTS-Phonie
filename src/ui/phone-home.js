import { SCREENS } from '../core/constants.js';
import { escapeHtml, icon } from './dom.js';

export const HOME_APPS = Object.freeze([
    { id: 'chat', label: '私信', detailRole: 'home-chat-count', screen: SCREENS.CHAT, icon: 'message', tone: 'aqua' },
    { id: 'call', label: '电话', detailRole: 'home-call-count', screen: SCREENS.CALL, icon: 'phone', tone: 'verdant' },
    { id: 'voice', label: '声线', detailRole: 'home-voice-count', screen: SCREENS.VOICE, icon: 'wave', tone: 'amber' },
    { id: 'trace', label: '轨迹', detailRole: 'home-trace-count', screen: SCREENS.TRACE, icon: 'headphones', tone: 'violet' },
    { id: 'engine', label: '模型', detail: '生成连接', screen: SCREENS.MODEL, icon: 'spark', tone: 'blue' },
    { id: 'character', label: '角色', detail: '声线路由', screen: SCREENS.CHARACTER, icon: 'person', tone: 'rose' },
    { id: 'format', label: '预设', detail: '提示词编排', screen: SCREENS.PROMPTS, icon: 'layers', tone: 'silver' },
    { id: 'settings', label: '设置', detail: '手机与编排', screen: SCREENS.SETTINGS, icon: 'settings', tone: 'graphite' },
    { id: 'guide', label: '说明', detail: '使用指南', screen: SCREENS.GUIDE, icon: 'book', tone: 'cobalt' },
]);

export const DOCK_ITEMS = Object.freeze([
    { label: '主页', screen: SCREENS.HOME, icon: 'home' },
    { label: '私信', screen: SCREENS.CHAT, icon: 'message' },
    { label: '电话', screen: SCREENS.CALL, icon: 'phone' },
    { label: '轨迹', screen: SCREENS.TRACE, icon: 'headphones' },
    { label: '设置', screen: SCREENS.SETTINGS, icon: 'sliders' },
]);

function appMarkup(app) {
    const detail = app.detailRole
        ? `<span class="phonie-app-tile__detail" data-role="${escapeHtml(app.detailRole)}"></span>`
        : `<span class="phonie-app-tile__detail">${escapeHtml(app.detail)}</span>`;
    return `
        <button class="phonie-app-tile" type="button" data-action="navigate" data-target-screen="${escapeHtml(app.screen)}" data-app="${escapeHtml(app.id)}">
            <span class="phonie-app-tile__icon" data-tone="${escapeHtml(app.tone)}">${icon(app.icon)}</span>
            <span class="phonie-app-tile__label">${escapeHtml(app.label)}</span>
            ${detail}
        </button>`;
}

export function homeScreenMarkup() {
    const primaryApps = HOME_APPS.slice(0, 8);
    const secondaryApps = HOME_APPS.slice(8);
    return `
        <section class="phonie-screen phonie-home-screen" data-screen="${SCREENS.HOME}" aria-label="手机桌面">
            <div class="phonie-home-content">
                <section class="phonie-time-widget" aria-label="当前聊天概览">
                    <div class="phonie-time-widget__clock">
                        <strong data-role="home-clock">--:--</strong>
                        <span data-role="home-date"></span>
                    </div>
                    <div class="phonie-time-widget__context">
                        <span>当前频道</span>
                        <strong data-role="home-contact">Character</strong>
                        <small data-role="home-message-summary">0 条手机消息</small>
                    </div>
                </section>
                <div class="phonie-home-pages" data-role="home-pages" aria-label="Phonie 应用分页">
                    <div class="phonie-app-grid" data-home-page="0" aria-label="常用应用">
                        ${primaryApps.map(appMarkup).join('')}
                    </div>
                    <div class="phonie-app-grid phonie-app-grid--secondary" data-home-page="1" aria-label="更多应用">
                        ${secondaryApps.map(appMarkup).join('')}
                    </div>
                </div>
                <div class="phonie-page-rail" aria-label="桌面分页"><button type="button" data-action="set-home-page" data-page="0" aria-current="true" aria-label="第一页"></button><button type="button" data-action="set-home-page" data-page="1" aria-current="false" aria-label="第二页"></button></div>
                <button class="phonie-service-card" type="button" data-action="navigate" data-target-screen="${SCREENS.VOICE}">
                    <span class="phonie-service-card__mark">${icon('signal')}</span>
                    <span class="phonie-service-card__copy">
                        <small>语音服务</small>
                        <strong><span data-role="home-contact-service">Character</span><b aria-hidden="true"></b><span data-role="home-provider">TTS 未配置</span></strong>
                    </span>
                    <span class="phonie-service-card__status" aria-hidden="true"></span>
                </button>
            </div>
        </section>`;
}

export function auxiliaryScreensMarkup() {
    return `
        <section class="phonie-screen phonie-voice-screen" data-screen="${SCREENS.VOICE}" aria-label="声线资料库">
            <div class="phonie-app-pane">
                <section class="phonie-voice-hero">
                    <span class="phonie-voice-hero__mark">${icon('signal')}</span>
                    <span><small>当前语音引擎</small><strong data-role="voice-provider">TTS 未配置</strong></span>
                    <i data-role="voice-language">ja-JP</i>
                </section>
                <div class="phonie-pane-heading"><span>Phonie 语音引擎</span></div>
                <div class="phonie-profile-list phonie-provider-list" data-role="tts-provider-list"></div>
                <div class="phonie-pane-heading"><span>最近声线</span></div>
                <div class="phonie-record-list" data-role="voice-library"></div>
            </div>
        </section>
        <section class="phonie-screen phonie-provider-screen" data-screen="${SCREENS.PROVIDER}" aria-label="语音供应商详情">
            <div class="phonie-app-pane">
                <div class="phonie-provider-detail" data-role="tts-provider-editor"></div>
            </div>
        </section>
        <section class="phonie-screen phonie-trace-screen" data-screen="${SCREENS.TRACE}" aria-label="通话轨迹">
            <div class="phonie-app-pane">
                <div class="phonie-pane-heading"><span>通话轨迹</span></div>
                <div class="phonie-record-list" data-role="trace-list"></div>
            </div>
        </section>
        <section class="phonie-screen phonie-character-screen" data-screen="${SCREENS.CHARACTER}" aria-label="角色声线">
            <div class="phonie-app-pane">
                <div class="phonie-pane-heading"><span>角色声线路由</span><small data-role="character-directory-count">0 位角色</small></div>
                <label class="phonie-character-search">
                    ${icon('person')}
                    <input type="search" data-role="character-search" placeholder="搜索正文说话人" autocomplete="off">
                </label>
                <div class="phonie-character-directory" data-role="character-directory"></div>
                <section class="phonie-character-card">
                    <span class="phonie-character-card__portrait" data-role="character-portrait"><b data-role="character-initials">P</b></span>
                    <small>当前声线对象</small>
                    <strong data-role="character-name">Character</strong>
                    <span data-role="character-provider">TTS 未配置</span>
                </section>
                <dl class="phonie-character-specs">
                    <div><dt>角色语言</dt><dd data-role="character-source-language">ja-JP</dd></div>
                    <div><dt>译文语言</dt><dd data-role="character-target-language">zh-CN</dd></div>
                    <div><dt>连续性</dt><dd data-role="character-continuity">开启</dd></div>
                </dl>
                <section class="phonie-route-editor">
                    <label><span>专属引擎</span><select data-role="character-provider-select"></select></label>
                    <label><span>备用引擎</span><select data-role="character-fallback-provider-select"></select></label>
                    <label><span>专属模型</span><select data-role="character-model-select"></select></label>
                    <label><span>账号音色</span><select data-role="character-voice-select"></select></label>
                    <label><span>自定义 Voice ID</span><input type="text" data-role="character-voice-id" placeholder="目录没有时手动填写"></label>
                    <label><span>台词语言</span><input type="text" data-role="character-text-language" placeholder="ja-JP"></label>
                    <label><span>参考音频</span><input type="text" data-role="character-reference-audio" placeholder="本地路径或音频 URL"></label>
                    <button type="button" data-action="save-character-route">保存角色声线路由</button>
                </section>
            </div>
        </section>
        <section class="phonie-screen phonie-guide-screen" data-screen="${SCREENS.GUIDE}" aria-label="使用说明">
            <div class="phonie-app-pane phonie-guide-pane">
                <section class="phonie-guide-card"><b>01</b><div><h2>私信</h2><p>连续发送消息。输入框留空并发送时，角色开始回复。</p></div></section>
                <section class="phonie-guide-card"><b>02</b><div><h2>正文语音</h2><p>正文保留原文和译文，播放键朗读角色台词。</p></div></section>
                <section class="phonie-guide-card"><b>03</b><div><h2>声线路由</h2><p>正文说话人首次出现后即可绑定声线。保存的路由会持续保留。</p></div></section>
                <section class="phonie-guide-card"><b>04</b><div><h2>电话</h2><p>从正文联系人拨号，或生成角色电话留言。通话读取当前上下文、摘要和已启用世界书。</p></div></section>
                <section class="phonie-guide-card"><b>05</b><div><h2>提示词</h2><p>正文、私信和电话工作流可分别保存、编辑、导入和导出。</p></div></section>
            </div>
        </section>`;
}

export function dockMarkup() {
    return `
        <nav class="phonie-dock" aria-label="Phonie 主导航">
            ${DOCK_ITEMS.map((item) => `
                <button class="phonie-dock-button" type="button" data-action="navigate" data-target-screen="${escapeHtml(item.screen)}">
                    ${icon(item.icon)}<span>${escapeHtml(item.label)}</span>
                </button>`).join('')}
        </nav>`;
}
