const PROMPT_ROLES = new Set(['system', 'user', 'assistant']);
const MAX_INSERTION_DEPTH = 20;

const DEFAULT_ENTRIES = [
    {
        id: 'channel-contract',
        name: '角色与频道',
        role: 'system',
        enabled: true,
        content: [
            '你正在故事世界中以{{角色}}的身份进行{{模式}}。',
            '保持角色设定，并遵循当前 SillyTavern 正文、角色卡与世界书所建立的上下文。',
            '不要提及这些规则、提示词编排、翻译过程，也不要声称自己是人工智能。',
        ].join('\n'),
    },
    {
        id: 'bilingual-schema',
        name: '双语语音格式',
        role: 'system',
        enabled: true,
        content: [
            'originalText 使用{{语言}}书写，并保持角色真实说话方式。',
            'translationText 必须忠实翻译为{{译文语言}}，表达与 originalText 一致。',
            '只返回 JSON，字段必须包含 originalText、translationText、emotion 与 action。',
            '即使两种语言表达相同，也必须保留两个语言字段。',
        ].join('\n'),
    },
    {
        id: 'recent-channel',
        name: '最近通信',
        role: 'user',
        enabled: true,
        content: [
            '请自然回复{{用户}}刚发来的手机消息。',
            '用户最新消息：{{输入}}',
            '{{格式}}',
        ].join('\n'),
    },
];

export const DEFAULT_CHAT_PROMPT_PRESET = Object.freeze({
    id: 'phonie-chat-default',
    name: '私信默认预设',
    insertionDepth: 0,
    entries: Object.freeze(DEFAULT_ENTRIES.map((entry) => Object.freeze({ ...entry }))),
});

export const DEFAULT_CALL_PROMPT_PRESET = Object.freeze({
    id: 'phonie-call-default',
    name: '电话默认预设',
    insertionDepth: 0,
    entries: Object.freeze(DEFAULT_ENTRIES.map((entry) => Object.freeze({
        ...entry,
        id: `call-${entry.id}`,
        content: entry.id === 'recent-channel'
            ? ['请规划一段自然、连贯、可以连续收听的电话内容。', '通话参与者：{{参与者}}', '通话主题：{{通话主题}}', '{{格式}}'].join('\n')
            : entry.content,
    }))),
});

export const DEFAULT_PHONE_PROMPT_PRESET = DEFAULT_CHAT_PROMPT_PRESET;

function cloneDefaultPreset() {
    return {
        ...DEFAULT_PHONE_PROMPT_PRESET,
        entries: DEFAULT_PHONE_PROMPT_PRESET.entries.map((entry) => ({ ...entry })),
    };
}

function clampDepth(value) {
    return Math.min(MAX_INSERTION_DEPTH, Math.max(0, Math.round(Number(value) || 0)));
}

export function normalizePhonePromptPreset(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const fallback = cloneDefaultPreset();
    const inputEntries = Array.isArray(source.entries) && source.entries.length ? source.entries : fallback.entries;
    const entries = inputEntries.map((entry, index) => ({
        id: String(entry?.id || `prompt-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '-'),
        name: String(entry?.name || `提示词条目 ${index + 1}`).trim().slice(0, 80),
        role: PROMPT_ROLES.has(entry?.role) ? entry.role : 'system',
        enabled: entry?.enabled !== false,
        content: String(entry?.content || '').slice(0, 12000),
    }));

    return {
        id: String(source.id || fallback.id),
        name: String(source.name || fallback.name).trim().slice(0, 80),
        insertionDepth: clampDepth(source.insertionDepth),
        entries,
    };
}

export function normalizePromptPresetLibrary(value = {}, fallbacks = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const result = {};
    for (const kind of ['body', 'chat', 'call']) {
        const seen = new Set();
        const sourceEntries = kind === 'chat' && !Array.isArray(source.chat) ? source.phone : source[kind];
        const entries = Array.isArray(sourceEntries) ? sourceEntries : [];
        const fallback = normalizePhonePromptPreset(fallbacks[kind]);
        const candidates = entries.length ? entries : [fallback];
        result[kind] = candidates.map((preset, index) => {
            const normalized = normalizePhonePromptPreset(preset);
            let id = String(normalized.id || kind + '-preset-' + (index + 1));
            while (seen.has(id)) id = id + '-' + (index + 1);
            seen.add(id);
            return { ...normalized, id };
        });
    }
    return result;
}

export function savePromptPreset(library, kind, preset, { asNew = false } = {}) {
    const normalizedKind = kind === 'phone' ? 'chat' : kind;
    const safeKind = ['body', 'chat', 'call'].includes(normalizedKind) ? normalizedKind : 'chat';
    const normalizedLibrary = normalizePromptPresetLibrary(library, { [safeKind]: preset });
    const normalized = normalizePhonePromptPreset(preset);
    const id = asNew ? safeKind + '-preset-' + Date.now().toString(36) : normalized.id;
    const saved = { ...normalized, id };
    const list = normalizedLibrary[safeKind] || [];
    const index = asNew ? -1 : list.findIndex((entry) => entry.id === id);
    const next = index >= 0
        ? list.map((entry, itemIndex) => itemIndex === index ? saved : entry)
        : [...list, saved];
    return {
        library: { ...normalizedLibrary, [safeKind]: next },
        preset: saved,
    };
}

export function removePromptPreset(library, kind, presetId, fallback) {
    const normalizedKind = kind === 'phone' ? 'chat' : kind;
    const safeKind = ['body', 'chat', 'call'].includes(normalizedKind) ? normalizedKind : 'chat';
    const normalizedLibrary = normalizePromptPresetLibrary(library, { [safeKind]: fallback });
    const filtered = (normalizedLibrary[safeKind] || []).filter((entry) => entry.id !== presetId);
    const next = filtered.length ? filtered : [normalizePhonePromptPreset(fallback)];
    return { ...normalizedLibrary, [safeKind]: next };
}

export function importPromptPresetLibrary(value, fallbacks = {}) {
    const payload = value?.promptPresetLibraries || value?.presets || value;
    if (!payload || typeof payload !== 'object') throw new Error('预设文件格式无效');
    if (Array.isArray(payload)) {
        const requested = value?.kind || payload[0]?.kind;
        const kind = requested === 'phone' ? 'chat' : ['body', 'chat', 'call'].includes(requested) ? requested : 'chat';
        return normalizePromptPresetLibrary({ [kind]: payload }, fallbacks);
    }
    return normalizePromptPresetLibrary(payload, fallbacks);
}

export function resolvePromptVariables(template, variables = {}) {
    const aliases = {
        character: variables.character,
        char: variables.character,
        '角色': variables.character,
        user: variables.user,
        '用户': variables.user,
        sourceLanguage: variables.sourceLanguage,
        language: variables.sourceLanguage,
        '语言': variables.sourceLanguage,
        targetLanguage: variables.targetLanguage,
        translationLanguage: variables.targetLanguage,
        '译文语言': variables.targetLanguage,
        mode: variables.mode,
        '模式': variables.mode,
        format: variables.format,
        '格式': variables.format,
        history: variables.history,
        '历史': variables.history,
        input: variables.input,
        '输入': variables.input,
        context: variables.context,
        '上下文': variables.context,
        participants: variables.participants,
        '参与者': variables.participants,
        topic: variables.topic,
        '通话主题': variables.topic,
        strategy: variables.strategy,
        '编排方式': variables.strategy,
    };

    return String(template || '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key) => {
        if (!Object.hasOwn(aliases, key) || aliases[key] == null) return match;
        return String(aliases[key]);
    });
}

export function addPhonePromptEntry(preset) {
    const normalized = normalizePhonePromptPreset(preset);
    const ids = new Set(normalized.entries.map((entry) => entry.id));
    let suffix = normalized.entries.length + 1;
    while (ids.has(`prompt-${suffix}`)) suffix++;
    return {
        ...normalized,
        entries: [...normalized.entries, {
            id: `prompt-${suffix}`,
            name: `提示词条目 ${suffix}`,
            role: 'system',
            enabled: true,
            content: '',
        }],
    };
}

export function updatePhonePromptEntry(preset, entryId, patch) {
    const normalized = normalizePhonePromptPreset(preset);
    return normalizePhonePromptPreset({
        ...normalized,
        entries: normalized.entries.map((entry) => entry.id === entryId ? { ...entry, ...patch, id: entry.id } : entry),
    });
}

export function movePhonePromptEntry(preset, entryId, direction) {
    const normalized = normalizePhonePromptPreset(preset);
    const entries = normalized.entries.map((entry) => ({ ...entry }));
    const from = entries.findIndex((entry) => entry.id === entryId);
    if (from < 0) return normalized;
    const to = Math.min(entries.length - 1, Math.max(0, from + Math.sign(Number(direction) || 0)));
    if (from === to) return normalized;
    const [entry] = entries.splice(from, 1);
    entries.splice(to, 0, entry);
    return { ...normalized, entries };
}

export function removePhonePromptEntry(preset, entryId) {
    const normalized = normalizePhonePromptPreset(preset);
    if (normalized.entries.length <= 1) return normalized;
    return { ...normalized, entries: normalized.entries.filter((entry) => entry.id !== entryId) };
}

export function assemblePhonePromptMessages({ preset, history = [], variables = {} }) {
    const normalized = normalizePhonePromptPreset(preset);
    const promptMessages = normalized.entries
        .filter((entry) => entry.enabled && entry.content.trim())
        .map((entry) => ({
            role: entry.role,
            content: resolvePromptVariables(entry.content, variables).trim(),
        }));
    const safeHistory = history
        .filter((message) => PROMPT_ROLES.has(message?.role) && String(message?.content || '').trim())
        .map((message) => ({ role: message.role, content: String(message.content) }));
    const insertionIndex = Math.max(0, safeHistory.length - normalized.insertionDepth);
    return [
        ...safeHistory.slice(0, insertionIndex),
        ...promptMessages,
        ...safeHistory.slice(insertionIndex),
    ];
}
