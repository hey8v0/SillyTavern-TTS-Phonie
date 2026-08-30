/**
 * Keep a usable display value even when a planner omits translation.
 * A missing translation must never discard an otherwise valid chat batch.
 */
export function normalizeChatTranslation(readable = '', translation = '') {
    const source = String(readable || '').trim().slice(0, 12000);
    const localized = String(translation || '').trim().slice(0, 12000);
    const placeholder = localized.replace(/[（）()【】\[\]：:。.!！?？\s]/g, '').toLocaleLowerCase('zh-CN');
    const isMissingPlaceholder = [
        '缺失翻译',
        '无翻译',
        '未提供翻译',
        'missingtranslation',
        'notranslation',
        'none',
        'null',
        'n/a',
    ].includes(placeholder);
    return localized && !isMissingPlaceholder ? localized : source;
}

/**
 * Restore the thread that started a generation only while the user has not
 * deliberately navigated to another conversation in the meantime.
 */
export function shouldRestoreGeneratedChat({ route, revisionAtStart, currentRevision } = {}) {
    return route === 'chat' && Number(revisionAtStart) === Number(currentRevision);
}
