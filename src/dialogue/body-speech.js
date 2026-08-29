/**
 * 正文语音标签解析：
 *   「{可见译文}」[TTS:{角色}:{情绪}:{原语言文本}]
 * 解析器只把前三个冒号当作字段分隔，剩余内容属于文本。
 * 兼容旧版 [TTSVoice:…] 标签（读取时不区分，输出一律按 TTS 处理）。
 */

const BODY_TAG_PATTERN_SOURCE = String.raw`\[(?:TTSVoice|TTS):([^:\]]*):([^:\]]*):([^\]]*)\]`;
const BODY_TAG_PATTERN_SINGLE = new RegExp(BODY_TAG_PATTERN_SOURCE);

function escapeAttr(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

export function parseBodySpeechTags(text) {
    const segments = [];
    const pattern = new RegExp(BODY_TAG_PATTERN_SOURCE, 'g');
    let match;
    let lastIndex = 0;
    const source = String(text || '');
    while ((match = pattern.exec(source)) !== null) {
        const before = source.slice(lastIndex, match.index);
        if (before) segments.push({ type: 'narration', text: before });
        segments.push({
            type: 'speech',
            speaker: match[1].trim(),
            emotion: match[2].trim(),
            sourceText: match[3].trim(),
        });
        lastIndex = pattern.lastIndex;
    }
    const tail = source.slice(lastIndex);
    if (tail) segments.push({ type: 'narration', text: tail });
    return segments;
}

export function hasBodySpeechTag(text) {
    return BODY_TAG_PATTERN_SINGLE.test(String(text || ''));
}

const PLAY_ICON = '<svg class="is-play" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4.5v15l13-7.5z"/></svg>';
const PAUSE_ICON = '<svg class="is-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1.2"/><rect x="14" y="4.5" width="4" height="15" rx="1.2"/></svg>';

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

/** 渲染后删除控制标签，保留可见译文并插入播放控件。 */
export function decorateBodyText(text, { enabled = true } = {}) {
    const source = String(text || '');
    if (!enabled || !hasBodySpeechTag(source)) return null;
    const pattern = new RegExp(BODY_TAG_PATTERN_SOURCE, 'g');
    const html = source.replace(pattern, (whole, speaker, emotion, sourceText) => {
        const label = escapeAttr(speaker || '角色');
        return `<button type="button" class="phonie-body-speech" data-speaker="${escapeAttr(speaker)}" data-emotion="${escapeAttr(emotion)}" data-text="${escapeAttr(sourceText)}" title="播放 ${label} 的语音" aria-label="播放 ${label} 的语音">${PLAY_ICON}${PAUSE_ICON}<span>${label}</span></button>`;
    });
    return html;
}

/**
 * 把文本里的 [TTS:…] 标签拆成「文本节点 + 播放按钮 + 文本节点」的文档片段，
 * 用于对已渲染的 .mes_text 做手术式替换，避免整体 innerHTML 覆盖破坏其他插件/正则的 DOM 效果。
 */
export function decorateTextNodeFragment(source) {
    const fragment = document.createDocumentFragment();
    const pattern = new RegExp(BODY_TAG_PATTERN_SOURCE, 'g');
    let lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
        if (match.index > lastIndex) {
            fragment.append(document.createTextNode(source.slice(lastIndex, match.index)));
        }
        const speaker = match[1].trim();
        const emotion = match[2].trim();
        const sourceText = match[3].trim();
        const label = speaker || '角色';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'phonie-body-speech';
        button.dataset.speaker = speaker;
        button.dataset.emotion = emotion;
        button.dataset.text = sourceText;
        button.title = `播放 ${label} 的语音`;
        button.setAttribute('aria-label', button.title);
        button.innerHTML = PLAY_ICON + PAUSE_ICON + `<span>${escapeHtml(label)}</span>`;
        fragment.append(button);
        lastIndex = pattern.lastIndex;
    }
    if (lastIndex < source.length) {
        fragment.append(document.createTextNode(source.slice(lastIndex)));
    }
    return fragment;
}
