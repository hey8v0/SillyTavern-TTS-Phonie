import { createDefaultPromptPreset, createPromptEntry, PROMPT_ROLES, PROMPT_WORKFLOWS } from '../core/constants.js';

/** 公共变量：中英文别名映射到同一个值。 */
const ALIASES = Object.freeze({
    '{{char}}': ['{{char}}', '{{character}}', '{{角色}}'],
    '{{user}}': ['{{user}}', '{{用户}}'],
    '{{participants}}': ['{{participants}}', '{{参与者}}'],
    '{{context}}': ['{{context}}', '{{上下文}}'],
    '{{worldbook}}': ['{{worldbook}}', '{{世界书}}'],
    '{{storyHistory}}': ['{{storyHistory}}', '{{故事历史}}'],
    '{{qqHistory}}': ['{{qqHistory}}', '{{qq历史}}'],
    '{{pendingMessages}}': ['{{pendingMessages}}', '{{待回复消息}}'],
    '{{direction}}': ['{{direction}}', '{{方向}}'],
    '{{callLength}}': ['{{callLength}}', '{{电话长度}}'],
    '{{sourceLanguage}}': ['{{sourceLanguage}}', '{{原文语言}}'],
    '{{targetLanguage}}': ['{{targetLanguage}}', '{{译文语言}}'],
    '{{imageIntent}}': ['{{imageIntent}}', '{{画面意图}}'],
    '{{outputSchema}}': ['{{outputSchema}}', '{{输出结构}}'],
});

/** 未知变量：保留原样并在编辑器中标记，不能静默删除。 */
export function resolveVariables(content, vars) {
    let result = String(content || '');
    for (const [canonical, aliases] of Object.entries(ALIASES)) {
        const value = Object.prototype.hasOwnProperty.call(vars || {}, canonical)
            ? String(vars[canonical] ?? '')
            : canonical;
        for (const alias of aliases) {
            result = result.split(alias).join(value);
        }
    }
    return result;
}

export function normalizePromptEntry(entry) {
    const value = createPromptEntry(entry || {});
    value.depth = Math.min(20, Math.max(0, Number(entry?.depth) || 0));
    value.role = PROMPT_ROLES.includes(entry?.role) ? entry.role : 'system';
    value.enabled = entry?.enabled !== false;
    value.content = String(entry?.content || '');
    value.name = String(entry?.name || '').slice(0, 80);
    return value;
}

export function normalizePromptPreset(preset, kind = 'chat') {
    const entries = Array.isArray(preset?.entries) ? preset.entries : [];
    return {
        id: String(preset?.id || `preset-${kind}`),
        name: String(preset?.name || '默认').slice(0, 80),
        entries: entries.map(normalizePromptEntry),
    };
}

/** 兼容早期单预设结构，并规范为“当前预设 + 预设数组”的可持久化结构。 */
export function normalizePromptLibrary(value, kind = 'chat') {
    const fallback = createDefaultPromptPreset(kind);
    const sourcePresets = Array.isArray(value?.presets) && value.presets.length
        ? value.presets
        : [value?.entries ? value : fallback];
    const seen = new Set();
    const presets = sourcePresets.map((preset, index) => {
        const normalized = normalizePromptPreset(preset, kind);
        let id = normalized.id || `preset-${kind}-${index + 1}`;
        while (seen.has(id)) id = `${id}-${index + 1}`;
        seen.add(id);
        return { ...normalized, id };
    });
    const activePresetId = presets.some((preset) => preset.id === value?.activePresetId)
        ? value.activePresetId
        : presets[0].id;
    const active = presets.find((preset) => preset.id === activePresetId) || presets[0];
    return { ...active, activePresetId, presets };
}

/** 用新的当前预设同步更新预设库，同时保留兼容读取所需的顶层 entries。 */
export function updateActivePromptPreset(library, nextPreset, kind = 'chat') {
    const normalizedLibrary = normalizePromptLibrary(library, kind);
    const normalizedPreset = normalizePromptPreset(nextPreset, kind);
    const presets = normalizedLibrary.presets.map((preset) => (
        preset.id === normalizedLibrary.activePresetId
            ? { ...normalizedPreset, id: normalizedLibrary.activePresetId }
            : preset
    ));
    const active = presets.find((preset) => preset.id === normalizedLibrary.activePresetId) || presets[0];
    return { ...active, activePresetId: active.id, presets };
}

export function selectPromptPreset(library, presetId, kind = 'chat') {
    const normalized = normalizePromptLibrary(library, kind);
    const active = normalized.presets.find((preset) => preset.id === presetId);
    return active ? { ...active, activePresetId: active.id, presets: normalized.presets } : normalized;
}

export function addPromptPreset(library, { kind = 'chat', name = '新预设', duplicate = true } = {}) {
    const normalized = normalizePromptLibrary(library, kind);
    const base = duplicate ? normalizePromptPreset(normalized, kind) : createDefaultPromptPreset(kind);
    const id = `preset-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const preset = { ...base, id, name: String(name || '新预设').slice(0, 80) };
    const presets = [...normalized.presets, preset];
    return { ...preset, activePresetId: id, presets };
}

export function removePromptPreset(library, presetId, kind = 'chat') {
    const normalized = normalizePromptLibrary(library, kind);
    if (normalized.presets.length <= 1) return normalized;
    const presets = normalized.presets.filter((preset) => preset.id !== presetId);
    const active = normalized.activePresetId === presetId
        ? presets[0]
        : (presets.find((preset) => preset.id === normalized.activePresetId) || presets[0]);
    return { ...active, activePresetId: active.id, presets };
}

export function findUnresolvedVariables(content) {
    return [...new Set([...String(content || '').matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1].trim()).filter(Boolean))];
}

/**
 * 把预设条目按深度插入实际消息列表；不压平成一个字符串。
 * 条目按深度升序排列，深度相同时保持数组顺序。
 */
export function compilePresetMessages({ preset, vars, extra = [] }) {
    const entries = (preset?.entries || [])
        .filter((entry) => entry.enabled && entry.content)
        .map((entry, order) => ({ role: entry.role, content: resolveVariables(entry.content, vars), depth: entry.depth, order }))
        .sort((a, b) => b.depth - a.depth || a.order - b.order);
    const messages = extra.map((item) => ({ role: item.role, content: item.content }));
    for (const entry of entries) {
        const index = Math.max(0, messages.length - Math.min(20, Math.max(0, Number(entry.depth) || 0)));
        messages.splice(index, 0, { role: entry.role, content: entry.content });
    }
    return messages;
}

export function updatePromptEntry(preset, entryId, patch) {
    const entries = preset.entries.map((entry) => (entry.id === entryId ? normalizePromptEntry({ ...entry, ...patch }) : entry));
    return { ...preset, entries };
}

export function addPromptEntry(preset) {
    return { ...preset, entries: [...preset.entries, createPromptEntry()] };
}

export function removePromptEntry(preset, entryId) {
    return { ...preset, entries: preset.entries.filter((entry) => entry.id !== entryId) };
}

export function movePromptEntry(preset, entryId, direction) {
    const entries = [...preset.entries];
    const index = entries.findIndex((entry) => entry.id === entryId);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= entries.length) return preset;
    [entries[index], entries[target]] = [entries[target], entries[index]];
    return { ...preset, entries };
}

export function workflowList() {
    return PROMPT_WORKFLOWS;
}
