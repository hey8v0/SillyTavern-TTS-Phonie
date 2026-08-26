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
                        <span><strong>模型来源</strong><small>跟随主模型、连接配置或自定义 OpenAI</small></span>
                        <select data-setting="generationMode" data-role="generation-mode-select">
                            <option value="tavern">跟随酒馆主模型</option>
                            <option value="profile">连接管理器配置</option>
                            <option value="custom">自定义 OpenAI</option>
                        </select>
                    </label>
                    <label class="phonie-control-field" data-generation-source="profile">
                        <span><strong>连接配置</strong><small>密钥继续由酒馆管理</small></span>
                        <select data-setting="generationProfileId" data-role="generation-profile-select"></select>
                    </label>
                    <label class="phonie-control-field">
                        <span><strong>回复上限</strong><small>手机私信与电话的最大生成长度</small></span>
                        <input type="number" min="80" max="1200" step="20" inputmode="numeric" data-setting="phoneResponseLength">
                    </label>
                </section>
                <section class="phonie-custom-openai" data-generation-source="custom">
                    <div class="phonie-pane-heading"><span>OpenAI 兼容接口</span><small>密钥存入酒馆安全密钥槽</small></div>
                    <div class="phonie-control-card">
                        <label class="phonie-control-field phonie-control-field--stacked">
                            <span><strong>接口地址</strong><small>例如 https://example.com/v1</small></span>
                            <input type="url" inputmode="url" autocomplete="url" data-setting="customOpenAIEndpoint" placeholder="https://example.com/v1">
                        </label>
                        <label class="phonie-control-field phonie-control-field--stacked">
                            <span><strong>API 密钥</strong><small>不会写入插件设置、聊天记录或备份</small></span>
                            <input type="password" autocomplete="new-password" data-role="custom-openai-key" placeholder="输入后保存到酒馆">
                        </label>
                        <div class="phonie-custom-openai__actions">
                            <button type="button" data-action="save-custom-key">保存密钥</button>
                            <button type="button" data-action="refresh-custom-models">拉取并测试模型</button>
                        </div>
                        <label class="phonie-control-field phonie-control-field--stacked">
                            <span><strong>模型</strong><small data-role="custom-openai-status">请先保存密钥并拉取模型</small></span>
                            <select data-setting="customOpenAIModel" data-role="custom-model-select"></select>
                        </label>
                        <label class="phonie-control-field">
                            <span><strong>温度</strong><small>0–2</small></span>
                            <input type="number" min="0" max="2" step="0.1" inputmode="decimal" data-setting="customOpenAITemperature">
                        </label>
                        <label class="phonie-control-field">
                            <span><strong>最大令牌</strong><small>80–65536</small></span>
                            <input type="number" min="80" max="65536" step="128" inputmode="numeric" data-setting="customOpenAIMaxTokens">
                        </label>
                    </div>
                </section>
                <div class="phonie-pane-heading" data-generation-source="profile"><span>可用连接</span><small>来自 SillyTavern Connection Manager</small></div>
                <div class="phonie-profile-list" data-role="generation-profile-list" data-generation-source="profile"></div>
                <section class="phonie-route-note">
                    ${icon('signal')}
                    <p><strong>语音仍跟随酒馆 TTS</strong><span data-role="model-tts-provider">TTS 未配置</span></p>
                </section>
            </div>
        </section>
        <section class="phonie-screen phonie-prompts-screen" data-screen="${SCREENS.PROMPTS}" aria-label="提示词预设">
            <div class="phonie-app-pane phonie-prompt-pane">
                <p class="phonie-prompt-intro" data-role="prompt-intro">条目按顺序注入。每条可选择 system、user 或 assistant，并统一设置插入深度。</p>
                <section class="phonie-preset-toolbar">
                    <label><span>工作流</span><select data-setting="promptWorkflowKind"><option value="body">正文 TTS</option><option value="phone">手机私信与电话</option></select></label>
                    <label><span>预设名称</span><input type="text" maxlength="80" data-prompt-preset-field="name"></label>
                    <label><span>插入深度</span><input type="number" min="0" max="20" inputmode="numeric" data-prompt-preset-field="insertionDepth"></label>
                    <div class="phonie-preset-actions">
                        <button type="button" data-action="reset-prompt-preset">${icon('reset')}<span>恢复默认</span></button>
                        <button type="button" data-action="add-prompt-entry">${icon('plus')}<span>添加条目</span></button>
                    </div>
                </section>
                <label class="phonie-prompt-master" data-role="body-prompt-master">
                    <span><strong>生成正文时注入</strong><small>每次发送、重写、续写和滑动前都会重新注入</small></span>
                    <span class="phonie-switch"><input type="checkbox" data-setting="bodyPromptEnabled"><span class="phonie-switch__track" aria-hidden="true"></span></span>
                </label>
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
