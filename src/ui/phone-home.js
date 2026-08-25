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
        ? `<span class="phoen-app-tile__detail" data-role="${escapeHtml(app.detailRole)}"></span>`
        : `<span class="phoen-app-tile__detail">${escapeHtml(app.detail)}</span>`;
    return `
        <button class="phoen-app-tile" type="button" data-action="navigate" data-target-screen="${escapeHtml(app.screen)}" data-app="${escapeHtml(app.id)}">
            <span class="phoen-app-tile__icon" data-tone="${escapeHtml(app.tone)}">${icon(app.icon)}</span>
            <span class="phoen-app-tile__label">${escapeHtml(app.label)}</span>
            ${detail}
        </button>`;
}

export function homeScreenMarkup() {
    return `
        <section class="phoen-screen phoen-home-screen" data-screen="${SCREENS.HOME}" aria-label="手机桌面">
            <div class="phoen-home-content">
                <section class="phoen-time-widget" aria-label="当前聊天概览">
                    <div class="phoen-time-widget__clock">
                        <strong data-role="home-clock">--:--</strong>
                        <span data-role="home-date"></span>
                    </div>
                    <div class="phoen-time-widget__context">
                        <span>当前频道</span>
                        <strong data-role="home-contact">Character</strong>
                        <small data-role="home-message-summary">0 条手机消息</small>
                    </div>
                </section>
                <div class="phoen-app-grid" aria-label="Phoen 应用">
                    ${HOME_APPS.map(appMarkup).join('')}
                </div>
                <div class="phoen-page-rail" aria-hidden="true"><i></i><i></i></div>
                <button class="phoen-service-card" type="button" data-action="navigate" data-target-screen="${SCREENS.VOICE}">
                    <span class="phoen-service-card__mark">${icon('signal')}</span>
                    <span class="phoen-service-card__copy">
                        <small>语音服务</small>
                        <strong><span data-role="home-contact-service">Character</span><b aria-hidden="true"></b><span data-role="home-provider">TTS 未配置</span></strong>
                    </span>
                    <span class="phoen-service-card__status" aria-hidden="true"></span>
                </button>
            </div>
        </section>`;
}

export function auxiliaryScreensMarkup() {
    return `
        <section class="phoen-screen phoen-voice-screen" data-screen="${SCREENS.VOICE}" aria-label="声线资料库">
            <div class="phoen-app-pane">
                <section class="phoen-voice-hero">
                    <span class="phoen-voice-hero__mark">${icon('signal')}</span>
                    <span><small>当前语音引擎</small><strong data-role="voice-provider">TTS 未配置</strong></span>
                    <i data-role="voice-language">ja-JP</i>
                </section>
                <div class="phoen-pane-heading"><span>最近声线</span><small>手机与正文统一播放焦点</small></div>
                <div class="phoen-record-list" data-role="voice-library"></div>
            </div>
        </section>
        <section class="phoen-screen phoen-trace-screen" data-screen="${SCREENS.TRACE}" aria-label="通话轨迹">
            <div class="phoen-app-pane">
                <div class="phoen-pane-heading"><span>通话轨迹</span><small>只保存在当前聊天元数据</small></div>
                <div class="phoen-record-list" data-role="trace-list"></div>
            </div>
        </section>
        <section class="phoen-screen phoen-character-screen" data-screen="${SCREENS.CHARACTER}" aria-label="角色声线">
            <div class="phoen-app-pane">
                <section class="phoen-character-card">
                    <span class="phoen-character-card__portrait" data-role="character-portrait"><b data-role="character-initials">P</b></span>
                    <small>当前声线对象</small>
                    <strong data-role="character-name">Character</strong>
                    <span data-role="character-provider">TTS 未配置</span>
                </section>
                <dl class="phoen-character-specs">
                    <div><dt>角色语言</dt><dd data-role="character-source-language">ja-JP</dd></div>
                    <div><dt>译文语言</dt><dd data-role="character-target-language">zh-CN</dd></div>
                    <div><dt>连续性</dt><dd data-role="character-continuity">开启</dd></div>
                </dl>
            </div>
        </section>`;
}

export function dockMarkup() {
    return `
        <nav class="phoen-dock" aria-label="Phoen 主导航">
            ${DOCK_ITEMS.map((item) => `
                <button class="phoen-dock-button" type="button" data-action="navigate" data-target-screen="${escapeHtml(item.screen)}">
                    ${icon(item.icon)}<span>${escapeHtml(item.label)}</span>
                </button>`).join('')}
        </nav>`;
}
