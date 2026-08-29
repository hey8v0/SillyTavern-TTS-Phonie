export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function initials(value) {
    const first = Array.from(String(value || 'P').trim().replace(/^[@#\s]+/u, ''))[0] || 'P';
    return first.toLocaleUpperCase();
}

export function clamp(value, minimum, maximum) {
    return Math.min(Math.max(Number(value) || 0, minimum), maximum);
}

export function formatClock(timestamp = Date.now()) {
    return new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(new Date(timestamp));
}

export function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024 * 1024) return (value / 1024).toFixed(value < 10240 ? 1 : 0) + ' KB';
    return (value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 2 : 1) + ' MB';
}

export function formatDuration(startedAt, endedAt) {
    if (!startedAt || !endedAt) return '00:00';
    const total = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
    const minutes = Math.floor(total / 60).toString().padStart(2, '0');
    const seconds = (total % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

/** 模拟打字延迟：短消息快，长消息慢，范围约 320–2600ms。 */
export function typingDelay(text) {
    const length = Array.from(String(text || '')).length;
    return clamp(280 + length * 22, 320, 2600);
}

/** 把逗号分隔的表情包条目拆成 name / url。 */
export function parseStickerImport(value) {
    const entries = [];
    for (const item of String(value || '').split(',')) {
        const trimmed = item.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/(https?:\/\/)/i);
        if (!match) continue;
        const index = match.index;
        const name = trimmed.slice(0, index).trim();
        const url = trimmed.slice(index).trim();
        if (name && /^https?:\/\//i.test(url)) entries.push({ name: name.slice(0, 80), url: url.slice(0, 2000) });
    }
    return entries;
}
