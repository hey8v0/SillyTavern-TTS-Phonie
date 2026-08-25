import { SCREENS } from '../core/constants.js';
import { escapeHtml, icon } from './dom.js';

export function systemSettingsScreensMarkup() {
    return `
        <section class="phonie-screen phonie-model-screen" data-screen="${SCREENS.MODEL}" aria-label="生成模型连接">
            <div class="phonie-app-pane phonie-system-pane">
                <section class="phonie-model-hero">
                    <span class="phonie-model-hero__mark">${icon('spark')}</span>
                    <span><small>手机回复模型</small><strong data-role="generation-target">跟随酒馆</strong><i data-role="generation-model">当前连接</i></span>
                </section>
                <section class="phonie-control-card">
                    <label class="phonie-control-field">
                        <span><strong>生成连接</strong><small>可选择酒馆连接配置；密钥仍由酒馆管理</small></span>
                        <select data-setting="generationProfileId" data-role="generation-profile-select"></select>
                    </label>
                    <label class="phonie-control-field">
                        <span><strong>回复上限</strong><small>手机私信与电话的最大生成长度</small></span>
                        <input type="number" min="80" max="1200" step="20" inputmode="numeric" data-setting="phoneResponseLength">
                    </label>
                </section>
                <div class="phonie-pane-heading"><span>可用连接</span><small>来自 SillyTavern Connection Manager</small></div>
                <div class="phonie-profile-list" data-role="generation-profile-list"></div>
                <section class="phonie-route-note">
                    ${icon('signal')}
                    <p><strong>语音仍跟随酒馆 TTS</strong><span data-role="model-tts-provider">TTS 未配置</span></p>
                </section>
            </div>
        </section>
        <section class="phonie-screen phonie-prompts-screen" data-screen="${SCREENS.PROMPTS}" aria-label="提示词预设">
            <div class="phonie-app-pane phonie-prompt-pane">
                <p class="phonie-prompt-intro">条目按顺序发送。每条可选择 system、user 或 assistant；全局深度从最近一条手机消息向前计算。</p>
                <section class="phonie-preset-toolbar">
                    <label><span>预设名称</span><input type="text" maxlength="80" data-prompt-preset-field="name"></label>
                    <label><span>插入深度</span><input type="number" min="0" max="20" inputmode="numeric" data-prompt-preset-field="insertionDepth"></label>
                    <div class="phonie-preset-actions">
                        <button type="button" data-action="reset-prompt-preset">${icon('reset')}<span>恢复默认</span></button>
                        <button type="button" data-action="add-prompt-entry">${icon('plus')}<span>添加条目</span></button>
                    </div>
                </section>
                <div class="phonie-variable-bank" aria-label="可用变量">
                    <span>{{角色}}</span><span>{{用户}}</span><span>{{语言}}</span><span>{{译文语言}}</span><span>{{模式}}</span><span>{{历史}}</span><span>{{输入}}</span><span>{{格式}}</span>
                </div>
                <div class="phonie-prompt-entry-list" data-role="prompt-entry-list"></div>
                <p class="phonie-prompt-autosave">修改会自动保存在 Phonie 扩展设置中。</p>
            </div>
        </section>`;
}

export function promptEntryMarkup(entry, index, total) {
    const roleOptions = ['system', 'user', 'assistant']
        .map((role) => `<option value="${role}"${entry.role === role ? ' selected' : ''}>${role}</option>`)
        .join('');
    return `
        <article class="phonie-prompt-entry" data-prompt-entry-id="${escapeHtml(entry.id)}">
            <header>
                <span class="phonie-prompt-entry__grip" aria-hidden="true">${icon('drag')}</span>
                <b>${index + 1}</b>
                <label><span class="phonie-sr-only">条目名称</span><input type="text" maxlength="80" value="${escapeHtml(entry.name)}" data-prompt-entry-field="name"></label>
                <label class="phonie-switch" aria-label="启用这个提示词条目">
                    <input type="checkbox" data-prompt-entry-field="enabled"${entry.enabled ? ' checked' : ''}>
                    <span class="phonie-switch__track" aria-hidden="true"></span>
                </label>
            </header>
            <div class="phonie-prompt-entry__controls">
                <label><span>角色</span><select data-prompt-entry-field="role">${roleOptions}</select></label>
                <span class="phonie-prompt-entry__buttons">
                    <button type="button" data-action="move-prompt-entry" data-direction="-1"${index === 0 ? ' disabled' : ''} aria-label="上移条目">${icon('chevron')}</button>
                    <button type="button" data-action="move-prompt-entry" data-direction="1"${index === total - 1 ? ' disabled' : ''} aria-label="下移条目">${icon('chevron')}</button>
                    <button type="button" data-action="delete-prompt-entry" aria-label="删除条目">${icon('trash')}</button>
                </span>
            </div>
            <label class="phonie-prompt-entry__content"><span class="phonie-sr-only">提示词内容</span><textarea rows="6" data-prompt-entry-field="content">${escapeHtml(entry.content)}</textarea></label>
        </article>`;
}
