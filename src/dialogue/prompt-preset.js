const PROMPT_ROLES = new Set(['system', 'user', 'assistant']);
const MAX_INSERTION_DEPTH = 20;

const MINI_MAX_ADAPTATION = `#### 规则 1：全局情绪映射表（Emotion 规范）
规定模型在语音消息的“情绪”位置，必须从 MiniMax 支持的标准情绪中选择最契合的一项：["happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm", "fluent"]

#### 规则 2：台词内语气词标签植入规范（Sound Tags）
根据角色的语气和上下文，在真正需要的位置自然植入英文小写圆括号标签：(laughs)、(chuckle)、(humming)、(breath)、(inhale)、(exhale)、(pant)、(gasps)、(sighs)、(sniffs)、(snorts)、(coughs)、(clear-throat)、(groans)、(emm)、(lip-smacking)、(sneezes)、(burps)。
微小停顿可使用 <#0.3#>。标签直接内嵌在朗读文本中，放在语意转折或句首句尾，并与标点或停顿自然配合；没有必要时不要滥用。`;

const CHAT_ENTRIES = [
    {
        id: 'chat-character',
        name: '手机私信与群聊角色',
        role: 'system',
        enabled: true,
        content: [
            '[最高优先级：手机私信 / 多人群聊]',
            '你正在通过手机与 {{用户}} 聊天。当前主角色：{{角色}}；当前模式：{{模式}}；可发言角色：{{参与者}}。{{用户}} 永远是聊天另一端的用户，不能由你代写。',
            '',
            '[角色与语境]',
            '严格遵守角色卡、当前剧情、知识边界、关系变化与已激活世界书。把它们当作记忆与事实自然使用，不复述设定，不突然改变身份或称呼。',
            '',
            '[线上聊天规则]',
            '1. 只写角色真正发送出去的消息。禁止动作、神态、心理、环境、镜头与第三人称旁白，不写“回复：”前缀。',
            '2. 先回应 {{用户}} 的最新消息；若有引用消息，理解引用关系后自然承接。',
            '3. 像真实即时通讯：短句、口语化、有停顿与消息颗粒感。一个角色可以连续发送多条短消息，不把全部内容挤成长篇独白。',
            '4. 保持角色自主性，可以追问、转移话题或表达态度，但不能替 {{用户}} 行动、发言或下结论。',
            '5. 多人群聊时 speaker 只能使用参与者列表中的精确角色名；允许一人连发或多人自然接话，不强迫每位角色每轮出现。',
            '6. 可以按语境使用文字或语音。用户明确要求语音时必须发语音；朗读台词要适合 TTS。实际消息语言遵循 {{语言}}。',
        ].join('\n'),
    },
    {
        id: 'chat-minimax-adaptation',
        name: 'MiniMax 适配',
        role: 'system',
        enabled: true,
        content: MINI_MAX_ADAPTATION,
    },
    {
        id: 'chat-format',
        name: '多消息与输出协议',
        role: 'system',
        enabled: true,
        content: [
            '一次回复可以连续发送多条独立手机消息。originalText 使用 {{语言}}，translationText 使用 {{译文语言}}，两者语义必须一致。',
            '只返回 JSON，不解释规则，不输出代码块。',
            '{{格式}}',
        ].join('\n'),
    },
    {
        id: 'chat-context',
        name: '聊天记录与待回复消息',
        role: 'user',
        enabled: true,
        content: [
            '最近手机记录：{{历史}}',
            '用户待回复消息：{{输入}}',
            '{{格式}}',
        ].join('\n'),
    },
];

export const DEFAULT_CHAT_PROMPT_PRESET = Object.freeze({
    id: 'phonie-chat-default',
    name: '聊天默认预设',
    insertionDepth: 0,
    entries: Object.freeze(CHAT_ENTRIES.map((entry) => Object.freeze({ ...entry }))),
});

const SINGLE_CALL_ENTRIES = [
    {
        id: 'call-director', name: '单人电话导演', role: 'system', enabled: true,
        content: [
            '你是单人语音电话导演。请根据当前聊天，让 {{角色}} 发起一通像真实电话或电话留言的完整对话。',
            '保持角色人设、关系与当前剧情，不替 {{用户}} 说话，不复述整段聊天。',
            '台词要口语化、有停顿感，围绕一至三个自然话题展开，每句都适合直接交给 TTS 朗读。',
        ].join('\n'),
    },
    { id: 'call-minimax-adaptation', name: 'MiniMax 适配', role: 'system', enabled: true, content: MINI_MAX_ADAPTATION },
    {
        id: 'call-format', name: '单人电话输出协议', role: 'system', enabled: true,
        content: '每段 speaker 必须是 {{角色}}；originalText 使用 {{语言}}，translationText 使用 {{译文语言}}，两者语义一致。只返回 JSON。\n{{格式}}',
    },
    {
        id: 'call-context', name: '单人电话任务与上下文', role: 'user', enabled: true,
        content: '通话主题：{{通话主题}}\n编排方式：{{编排方式}}\n剧情上下文：{{上下文}}\n{{格式}}',
    },
];

export const DEFAULT_CALL_PROMPT_PRESET = Object.freeze({
    id: 'phonie-call-default',
    name: '单人电话默认预设',
    insertionDepth: 0,
    entries: Object.freeze(SINGLE_CALL_ENTRIES.map((entry) => Object.freeze({ ...entry }))),
});

const GROUP_CALL_ENTRIES = [
    {
        id: 'group-call-director', name: '多人电话导演', role: 'system', enabled: true,
        content: [
            '你是多人语音电话导演。请根据当前剧情，为参与者 {{参与者}} 编排一通可以连续收听的多人电话。',
            '只允许参与者列表中的角色发言，speaker 必须精确使用角色名；绝对不要替 {{用户}} 说话。',
            '允许同一角色连续说几句，也允许多人自然插话、回应和转移话题；不要机械轮流，不要求每个人每轮都出现。',
            '保持每个人的角色卡、知识边界、关系和说话习惯。台词口语化，带真实电话的停顿与衔接，并适合 TTS 连续播放。',
        ].join('\n'),
    },
    { id: 'group-call-minimax-adaptation', name: 'MiniMax 适配', role: 'system', enabled: true, content: MINI_MAX_ADAPTATION },
    {
        id: 'group-call-format', name: '多人电话输出协议', role: 'system', enabled: true,
        content: '输出完整 JSON 电话脚本。每段都包含 speaker、originalText、translationText 与 emotion；speaker 只能取自 {{参与者}}。originalText 使用 {{语言}}，translationText 使用 {{译文语言}}。\n{{格式}}',
    },
    {
        id: 'group-call-context', name: '多人电话任务与上下文', role: 'user', enabled: true,
        content: '参与者：{{参与者}}\n通话主题：{{通话主题}}\n编排方式：{{编排方式}}\n剧情上下文：{{上下文}}\n{{格式}}',
    },
];

export const DEFAULT_GROUP_CALL_PROMPT_PRESET = Object.freeze({
    id: 'phonie-group-call-default',
    name: '多人电话默认预设',
    insertionDepth: 0,
    entries: Object.freeze(GROUP_CALL_ENTRIES.map((entry) => Object.freeze({ ...entry }))),
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
    const defaultByKind = {
        body: DEFAULT_PHONE_PROMPT_PRESET,
        chat: DEFAULT_CHAT_PROMPT_PRESET,
        call_single: DEFAULT_CALL_PROMPT_PRESET,
        call_group: DEFAULT_GROUP_CALL_PROMPT_PRESET,
    };
    const result = {};
    for (const kind of ['body', 'chat', 'call_single', 'call_group']) {
        const seen = new Set();
        const sourceEntries = kind === 'chat' && !Array.isArray(source.chat)
            ? source.phone
            : kind === 'call_single' && !Array.isArray(source.call_single)
                ? source.call
                : kind === 'call_group' && !Array.isArray(source.call_group)
                    ? source.groupCall || source.call
                    : source[kind];
        const entries = Array.isArray(sourceEntries) ? sourceEntries : [];
        const fallback = normalizePhonePromptPreset(fallbacks[kind] || defaultByKind[kind]);
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
    const normalizedKind = kind === 'phone' ? 'chat' : kind === 'call' ? 'call_single' : kind;
    const safeKind = ['body', 'chat', 'call_single', 'call_group'].includes(normalizedKind) ? normalizedKind : 'chat';
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
    const normalizedKind = kind === 'phone' ? 'chat' : kind === 'call' ? 'call_single' : kind;
    const safeKind = ['body', 'chat', 'call_single', 'call_group'].includes(normalizedKind) ? normalizedKind : 'chat';
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
        const normalizedKind = requested === 'phone' ? 'chat' : requested === 'call' ? 'call_single' : requested;
        const kind = ['body', 'chat', 'call_single', 'call_group'].includes(normalizedKind) ? normalizedKind : 'chat';
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
