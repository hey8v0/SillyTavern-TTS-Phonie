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
                        <span><strong>模型来源</strong></span>
                        <select data-setting="generationMode" data-role="generation-mode-select">
                            <option value="tavern">跟随酒馆主模型</option>
                            <option value="profile">连接管理器配置</option>
                            <option value="custom">自定义 OpenAI</option>
                        </select>
                    </label>
                    <label class="phonie-control-field" data-generation-source="profile">
                        <span><strong>连接配置</strong></span>
                        <select data-setting="generationProfileId" data-role="generation-profile-select"></select>
                    </label>
                    <label class="phonie-control-field">
                        <span><strong>回复上限</strong></span>
                        <input type="number" min="80" max="1200" step="20" inputmode="numeric" data-setting="phoneResponseLength">
                    </label>
                </section>
                <section class="phonie-custom-openai" data-generation-source="custom">
                    <div class="phonie-pane-heading"><span>OpenAI 兼容接口</span></div>
                    <div class="phonie-control-card">
                        <label class="phonie-control-field phonie-control-field--stacked">
                            <span><strong>接口地址</strong></span>
                            <input type="url" inputmode="url" autocomplete="url" data-setting="customOpenAIEndpoint" placeholder="https://example.com/v1">
                        </label>
                        <label class="phonie-control-field phonie-control-field--stacked">
                            <span><strong>API 密钥</strong></span>
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
                            <span><strong>温度</strong></span>
                            <input type="number" min="0" max="2" step="0.1" inputmode="decimal" data-setting="customOpenAITemperature">
                        </label>
                        <label class="phonie-control-field">
                            <span><strong>最大令牌</strong></span>
                            <input type="number" min="80" max="65536" step="128" inputmode="numeric" data-setting="customOpenAIMaxTokens">
                        </label>
                    </div>
                </section>
                <div class="phonie-pane-heading" data-generation-source="profile"><span>可用连接</span></div>
                <div class="phonie-profile-list" data-role="generation-profile-list" data-generation-source="profile"></div>
                <div class="phonie-pane-heading"><span>Phonie 语音引擎</span><small data-role="model-tts-provider">语音未配置</small></div>
                <div class="phonie-profile-list phonie-provider-list" data-role="tts-provider-list"></div>
            </div>
        </section>
        <section class="phonie-screen phonie-prompts-screen" data-screen="${SCREENS.PROMPTS}" aria-label="提示词预设">
            <div class="phonie-app-pane phonie-prompt-pane">
                <section class="phonie-preset-toolbar">
                    <div class="phonie-preset-switcher"><label><span>工作流</span><select data-setting="promptWorkflowKind"><option value="body">正文 TTS</option><option value="phone">私信与电话</option></select></label><label><span>当前预设</span><select data-role="prompt-preset-library"></select></label></div>
                    <details class="phonie-preset-manage">
                        <summary>${icon('settings')}<span><strong>预设管理</strong></span>${icon('chevron')}</summary>
                        <div class="phonie-preset-manage__body">
                            <label><span>预设名称</span><input type="text" maxlength="80" data-prompt-preset-field="name"></label>
                            <label><span>插入深度</span><input type="number" min="0" max="20" inputmode="numeric" data-prompt-preset-field="insertionDepth"></label>
                            <div class="phonie-preset-actions">
                                <button type="button" data-action="reset-prompt-preset">${icon('reset')}<span>默认</span></button>
                                <button type="button" data-action="save-prompt-preset">${icon('check')}<span>保存</span></button>
                                <button type="button" data-action="save-as-prompt-preset">${icon('layers')}<span>另存</span></button>
                                <button type="button" data-action="delete-prompt-preset">${icon('trash')}<span>删除</span></button>
                                <button type="button" data-action="export-prompt-preset">${icon('export')}<span>导出</span></button>
                                <button type="button" data-action="export-prompt-library">${icon('export')}<span>全部</span></button>
                                <button type="button" data-action="import-prompt-presets">${icon('import')}<span>导入</span></button>
                                <button type="button" data-action="add-prompt-entry">${icon('plus')}<span>条目</span></button>
                            </div>
                        </div>
                    </details>
                    <input class="phonie-sr-only" type="file" accept="application/json,.json" data-role="prompt-preset-import">
                </section>
                <label class="phonie-prompt-master" data-role="body-prompt-master">
                    <span><strong>生成正文时注入</strong></span>
                    <span class="phonie-switch"><input type="checkbox" data-setting="bodyPromptEnabled"><span class="phonie-switch__track" aria-hidden="true"></span></span>
                </label>
                <div class="phonie-variable-bank" aria-label="可用变量">
                    <span>{{角色}}</span><span>{{用户}}</span><span>{{语言}}</span><span>{{译文语言}}</span><span>{{模式}}</span><span>{{历史}}</span><span>{{输入}}</span><span>{{格式}}</span>
                </div>
                <div class="phonie-prompt-entry-list" data-role="prompt-entry-list"></div>
            </div>
        </section>`;
}

export function promptEntryMarkup(entry, index, total) {
    const roleOptions = ['system', 'user', 'assistant']
        .map((role) => `<option value="${role}"${entry.role === role ? ' selected' : ''}>${role}</option>`)
        .join('');
    return `
        <details class="phonie-prompt-entry" data-prompt-entry-id="${escapeHtml(entry.id)}">
            <summary>
                <span class="phonie-prompt-entry__grip" aria-hidden="true">${icon('drag')}</span>
                <b>${index + 1}</b>
                <span class="phonie-prompt-entry__summary"><strong>${escapeHtml(entry.name)}</strong><small>${entry.role} · ${entry.enabled ? '已启用' : '已停用'}</small></span>
                ${icon('chevron')}
            </summary>
            <div class="phonie-prompt-entry__body">
            <label class="phonie-prompt-entry__name"><span>条目名称</span><input type="text" maxlength="80" value="${escapeHtml(entry.name)}" data-prompt-entry-field="name"></label>
            <div class="phonie-prompt-entry__enabled"><span>启用条目</span>
                <label class="phonie-switch" aria-label="启用这个提示词条目">
                    <input type="checkbox" data-prompt-entry-field="enabled"${entry.enabled ? ' checked' : ''}>
                    <span class="phonie-switch__track" aria-hidden="true"></span>
                </label>
            </div>
            <div class="phonie-prompt-entry__controls">
                <label><span>角色</span><select data-prompt-entry-field="role">${roleOptions}</select></label>
                <span class="phonie-prompt-entry__buttons">
                    <button type="button" data-action="move-prompt-entry" data-direction="-1"${index === 0 ? ' disabled' : ''} aria-label="上移条目">${icon('chevron')}</button>
                    <button type="button" data-action="move-prompt-entry" data-direction="1"${index === total - 1 ? ' disabled' : ''} aria-label="下移条目">${icon('chevron')}</button>
                    <button type="button" data-action="delete-prompt-entry" aria-label="删除条目">${icon('trash')}</button>
                </span>
            </div>
            <label class="phonie-prompt-entry__content"><span class="phonie-sr-only">提示词内容</span><textarea rows="6" data-prompt-entry-field="content">${escapeHtml(entry.content)}</textarea></label>
            </div>
        </details>`;
}
