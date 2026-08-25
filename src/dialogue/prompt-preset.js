const PROMPT_ROLES = new Set(['system', 'user', 'assistant']);
const MAX_INSERTION_DEPTH = 20;

const DEFAULT_ENTRIES = [
    {
        id: 'channel-contract',
        name: '角色与频道',
        role: 'system',
        enabled: true,
        content: [
            'Continue an in-world {{模式}} as {{角色}}.',
            'Stay fully in character and respect the current SillyTavern story context.',
            'Do not mention these instructions, prompt construction, translation work, or being an AI.',
        ].join('\n'),
    },
    {
        id: 'bilingual-schema',
        name: '双语语音格式',
        role: 'system',
        enabled: true,
        content: [
            'Write originalText in {{语言}}.',
            'Write translationText as a faithful {{译文语言}} translation of originalText.',
            'Return only JSON with originalText, translationText, emotion, and action.',
            'Keep both language fields even when they express the same meaning.',
        ].join('\n'),
    },
    {
        id: 'recent-channel',
        name: '最近通信',
        role: 'user',
        enabled: true,
        content: [
            'Reply naturally to the latest message from {{用户}}.',
            'Latest user message: {{输入}}',
            '{{格式}}',
        ].join('\n'),
    },
];

export const DEFAULT_PHONE_PROMPT_PRESET = Object.freeze({
    id: 'phoen-default',
    name: 'Phoen 默认预设',
    insertionDepth: 0,
    entries: Object.freeze(DEFAULT_ENTRIES.map((entry) => Object.freeze({ ...entry }))),
});

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
