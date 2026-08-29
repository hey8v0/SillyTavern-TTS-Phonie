let counter = 0;

/** 生成短随机 ID。 */
export function createId(prefix = 'id') {
    counter += 1;
    return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 生成虚拟电话号码：不会指向真实号码的 +00 形式。 */
export function virtualPhoneNumber(contactId) {
    let hash = 0;
    const seed = String(contactId || '');
    for (let index = 0; index < seed.length; index += 1) {
        hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
    }
    const a = String(hash % 1000).padStart(3, '0');
    const b = String(Math.floor(hash / 1000) % 10000).padStart(4, '0');
    const c = String((hash * 7) % 10000).padStart(4, '0');
    return `+00 ${a} ${b} ${c}`;
}
