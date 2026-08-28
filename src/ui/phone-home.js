import { SCREENS } from '../core/constants.js';
import { escapeHtml, icon } from './dom.js';

export const HOME_APPS = Object.freeze([
    { id: 'chat', label: '私信', detailRole: 'home-chat-count', screen: SCREENS.CHAT, icon: 'message', tone: 'aqua' },
    { id: 'call', label: '电话', detailRole: 'home-call-count', screen: SCREENS.CALL, icon: 'phone', tone: 'verdant' },
    { id: 'voice', label: '声线', detailRole: 'home-voice-count', screen: SCREENS.VOICE, icon: 'wave', tone: 'amber' },
    { id: 'group', label: '群聊', detailRole: 'home-group-count', screen: SCREENS.CHARACTER, icon: 'person', tone: 'violet' },
    { id: 'engine', label: '模型', detail: '生成连接', screen: SCREENS.MODEL, icon: 'spark', tone: 'blue' },
    { id: 'character', label: '通讯录', detail: '私信与声线', screen: SCREENS.CHARACTER, icon: 'person', tone: 'rose' },
    { id: 'format', label: '预设', detail: '提示词编排', screen: SCREENS.PROMPTS, icon: 'layers', tone: 'silver' },
    { id: 'settings', label: '设置', detail: '手机与编排', screen: SCREENS.SETTINGS, icon: 'settings', tone: 'graphite' },
    { id: 'guide', label: '说明', detail: '使用指南', screen: SCREENS.GUIDE, icon: 'book', tone: 'cobalt' },
    { id: 'novelai', label: '绘图', detail: 'NovelAI', screen: SCREENS.NOVELAI, icon: 'image', tone: 'coral' },
]);

export const DOCK_ITEMS = Object.freeze([
    { label: '主页', screen: SCREENS.HOME, icon: 'home' },
    { label: '私信', screen: SCREENS.CHAT, icon: 'message' },
    { label: '电话', screen: SCREENS.CALL, icon: 'phone' },
    { label: '群聊', screen: SCREENS.CHARACTER, icon: 'person' },
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

const HOME_RAIN_LINES = Object.freeze([
    ['8%', '-1.7s', '44%'],
    ['19%', '-4.2s', '57%'],
    ['31%', '-.8s', '39%'],
    ['44%', '-5.1s', '63%'],
    ['57%', '-2.6s', '49%'],
    ['69%', '-6.3s', '58%'],
    ['82%', '-3.4s', '42%'],
    ['93%', '-.2s', '54%'],
]);

function homeRainMarkup() {
    return HOME_RAIN_LINES.map(([x, delay, length], index) => (
        `<i style="--rain-x:${x};--rain-delay:${delay};--rain-length:${length};--rain-index:${index}"></i>`
    )).join('');
}

export function homeScreenMarkup() {
    const primaryApps = HOME_APPS.slice(0, 8);
    const secondaryApps = HOME_APPS.slice(8);
    return `
        <section class="phonie-screen phonie-home-screen" data-screen="${SCREENS.HOME}" aria-label="手机桌面">
            <div class="phonie-home-rain" aria-hidden="true">${homeRainMarkup()}</div>
            <div class="phonie-home-content">
                <section class="phonie-time-widget" aria-label="当前聊天概览">
                    <div class="phonie-time-widget__clock">
                        <strong data-role="home-clock">--:--</strong>
                        <span data-role="home-date"></span>
                    </div>
                    <div class="phonie-time-widget__context">
                        <small>当前频道</small>
                        <strong data-role="home-contact">Character</strong>
                        <span data-role="home-message-summary">0 条手机消息</span>
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
                <button class="phonie-service-card" type="button" data-action="navigate" data-target-screen="${SCREENS.MODEL}">
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
                    <span><small>已保存声线</small><strong data-role="voice-provider">角色声线路由</strong></span>
                    <i data-role="voice-language">ja-JP</i>
                </section>
                <div class="phonie-pane-heading"><span>角色与复刻声线</span><small data-role="voice-route-count">0 条</small></div>
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
        <section class="phonie-screen phonie-character-screen" data-screen="${SCREENS.CHARACTER}" aria-label="通讯录">
            <div class="phonie-app-pane">
                <div class="phonie-pane-heading"><span>通讯录</span><small data-role="character-directory-count">0 位联系人</small></div>
                <label class="phonie-character-search">
                    ${icon('person')}
                    <input type="search" data-role="character-search" placeholder="搜索有声联系人" autocomplete="off">
                </label>
                <div class="phonie-character-add"><input type="text" maxlength="80" data-role="manual-character-name" placeholder="手动添加说话人"><button type="button" data-action="add-manual-character">${icon('plus')}<span>添加</span></button></div>
                <button class="phonie-contact-group-launch" type="button" data-action="open-group-chat">${icon('message')}<span>打开所选群聊</span></button>
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
                    <div class="phonie-route-editor__actions"><button type="button" data-action="save-character-route">保存角色声线路由</button><button type="button" data-action="delete-character-route">${icon('trash')}<span>删除路由</span></button></div>
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
        </section>
        <section class="phonie-screen phonie-novelai-screen" data-screen="${SCREENS.NOVELAI}" aria-label="NovelAI 文生图">
            <div class="phonie-app-pane phonie-novelai-pane">
                <section class="phonie-novelai-hero"><span>${icon('image')}</span><div><small>NovelAI Diffusion</small><strong>角色影像工坊</strong></div><i data-role="novelai-status">待命</i></section>
                <section class="phonie-novelai-presetbar">
                    <select data-role="novelai-preset-select" aria-label="选择绘图提示词预设"><option value="">未选择预设</option></select>
                    <button type="button" data-action="save-novelai-preset">${icon('check')}<span>保存</span></button>
                    <button type="button" data-action="delete-novelai-preset" aria-label="删除当前绘图预设">${icon('trash')}</button>
                </section>
                <label class="phonie-novelai-field"><span>画面意图</span><textarea rows="3" maxlength="3000" data-role="novelai-idea" placeholder="例如：角色在雨后的东京街头分享一张随手拍，柔和街灯，生活感"></textarea></label>
                <button class="phonie-novelai-taggen" type="button" data-action="generate-novelai-tags">${icon('spark')}<span>让当前模型整理画面提示词</span></button>
                <label class="phonie-novelai-field"><span>正面提示词</span><textarea rows="5" maxlength="6000" data-role="novelai-prompt" placeholder="自然语言描述与主体、构图、光线 Tag"></textarea></label>
                <label class="phonie-novelai-field"><span>画师串与风格 Tag</span><textarea rows="3" maxlength="3000" data-role="novelai-artist-tags" data-setting="novelAiArtistTags" placeholder="artist:xxx, style:xxx, cinematic lighting"></textarea></label>
                <details class="phonie-novelai-options"><summary>${icon('sliders')}<span>生成参数</span>${icon('chevron')}</summary><div>
                    <label><span>模型</span><select data-setting="novelAiModel"><option value="nai-diffusion-5-full">V5 Full · 最新</option><option value="nai-diffusion-5-curated">V5 Curated</option><option value="nai-diffusion-4-5-full">V4.5 Full</option><option value="nai-diffusion-4-5-curated">V4.5 Curated</option><option value="nai-diffusion-4-full">V4 Full</option><option value="nai-diffusion-3">Anime V3</option><option value="nai-diffusion-furry-3">Furry V3</option></select></label>
                    <label><span>尺寸</span><select data-role="novelai-size"><option value="832x1216">竖图 · 832×1216</option><option value="1216x832">横图 · 1216×832</option><option value="1024x1024">方图 · 1024×1024</option></select></label>
                    <label><span>负面提示词</span><textarea rows="3" data-setting="novelAiNegativePrompt"></textarea></label>
                    <label><span>AI 提示词指令</span><textarea rows="5" maxlength="6000" data-setting="novelAiTagInstruction"></textarea></label>
                    <div class="phonie-novelai-numbers"><label><span>步数</span><input type="number" min="1" max="50" data-setting="novelAiSteps"></label><label><span>引导</span><input type="number" min="1" max="10" step="0.1" data-setting="novelAiScale"></label></div>
                    <label><span>Persistent API Token</span><div class="phonie-novelai-secret"><input type="password" autocomplete="new-password" data-role="novelai-token" placeholder="保存后不会回显"><button type="button" data-action="save-novelai-token">安全保存</button></div></label>
                </div></details>
                <button class="phonie-novelai-generate" type="button" data-action="generate-novelai-image">${icon('spark')}<span>生成图片</span></button>
                <figure class="phonie-novelai-result" data-role="novelai-result" hidden><img alt="NovelAI 生成结果"><figcaption><button type="button" data-action="download-novelai-image">${icon('download')}<span>下载</span></button><button type="button" data-action="send-novelai-image">${icon('send')}<span>作为角色发送</span></button></figcaption></figure>
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
