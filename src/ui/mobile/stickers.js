function clean(value) {
    return String(value || '').trim();
}

function stableHash(value) {
    let hash = 0x811c9dc5;
    for (const character of value) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

export function stickerId(sticker) {
    const signature = `${clean(sticker?.url).toLowerCase()}\n${clean(sticker?.name).toLowerCase()}`;
    return `sticker-${stableHash(signature)}`;
}

export function parseStickerBatchText(batchText) {
    const source = String(batchText || '');
    const result = [];
    const matcher = /([^,，\n\r]*?)(https?:\/\/[^\s,，\n\r]+)/giu;
    let match;
    while ((match = matcher.exec(source))) {
        const url = clean(match[2]).replace(/[，,]+$/u, '');
        const rawName = clean(match[1]).replace(/^[，,;；\s]+|[，,;；\s]+$/gu, '');
        if (!url) continue;
        result.push({ name: rawName || `表情包 ${result.length + 1}`, url });
    }
    return result;
}

export function normalizeStickerLibrary(stickers = []) {
    const seen = new Set();
    const normalized = [];
    for (const source of stickers || []) {
        const url = clean(source?.url);
        if (!url) continue;
        const item = {
            ...source,
            name: clean(source?.name) || '未命名',
            url,
            status: ['unchecked', 'checking', 'ready', 'failed', 'unreachable'].includes(source?.status)
                ? source.status
                : 'unchecked',
            error: clean(source?.error),
        };
        item.id = clean(source?.id) || stickerId(item);
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        normalized.push(item);
    }
    return normalized;
}

export function resolveSticker(library = [], reference = {}) {
    const stickers = normalizeStickerLibrary(library);
    const id = clean(reference?.id || reference?.stickerId);
    const url = clean(reference?.url || reference?.stickerUrl);
    const name = clean(reference?.name || reference?.stickerName).toLocaleLowerCase();
    return stickers.find(sticker => id && sticker.id === id)
        || stickers.find(sticker => url && sticker.url === url)
        || stickers.find(sticker => name && sticker.name.toLocaleLowerCase() === name)
        || null;
}

export function markStickerStatus(stickers, id, status, error = '') {
    return normalizeStickerLibrary(stickers).map(sticker => (
        sticker.id === id ? { ...sticker, status, error: clean(error) } : sticker
    ));
}
