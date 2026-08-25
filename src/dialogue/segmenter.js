const SPEECH_QUOTES = /[\u300c\u300e\u201c\u2018\"']/;
const SENTENCE_END = /[。！？!?…]+[\u300d\u300f\u201d\u2019\"']?|\n+/g;

export function stripMarkdownForSpeech(value) {
    return String(value ?? '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/<!--([\s\S]*?)-->/g, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}(?:>|#{1,6}|[-+*]\s+)/gm, '')
        .replace(/[*_~]{1,3}/g, '')
        .replace(/\r/g, '')
        .replace(/[\t\f\v ]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .trim();
}

export function detectLanguage(value) {
    const text = String(value ?? '');
    const kana = (text.match(/[\u3040-\u30ff]/g) || []).length;
    const han = (text.match(/[\u3400-\u9fff]/g) || []).length;
    const latin = (text.match(/[A-Za-z]/g) || []).length;

    if (kana > 0) return 'ja-JP';
    if (han > latin) return 'zh-CN';
    if (latin > 0) return 'en-US';
    return 'und';
}

export function extractDialogue(value, { includeNarration = true } = {}) {
    const text = stripMarkdownForSpeech(value);
    if (!text) return '';

    const captures = [];
    const quotePattern = /[\u300c\u201c\"]([^\u300d\u201d\"]+)[\u300d\u201d\"]|[\u300e]([^\u300f]+)[\u300f]|[\u2018']([^\u2019']+)[\u2019']/g;
    let match;

    while ((match = quotePattern.exec(text)) !== null) {
        const captured = match[1] || match[2] || match[3];
        if (captured?.trim()) captures.push(captured.trim());
    }

    if (captures.length > 0) return captures.join(' ');
    if (includeNarration || !SPEECH_QUOTES.test(text)) return text;
    return '';
}

function splitLongSegment(value, maxChars) {
    const parts = [];
    let remaining = value.trim();

    while (remaining.length > maxChars) {
        const candidate = remaining.slice(0, maxChars + 1);
        const breakAt = Math.max(
            candidate.lastIndexOf('、'),
            candidate.lastIndexOf('，'),
            candidate.lastIndexOf(','),
            candidate.lastIndexOf(' '),
        );
        const index = breakAt > maxChars * 0.45 ? breakAt + 1 : maxChars;
        parts.push(remaining.slice(0, index).trim());
        remaining = remaining.slice(index).trim();
    }

    if (remaining) parts.push(remaining);
    return parts;
}

export function segmentSpeech(value, { locale = 'ja-JP', maxChars = 180 } = {}) {
    const text = stripMarkdownForSpeech(value);
    if (!text) return [];

    let segments = [];
    if (typeof Intl?.Segmenter === 'function') {
        try {
            const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
            segments = Array.from(segmenter.segment(text), (entry) => entry.segment.trim()).filter(Boolean);
        } catch {
            segments = [];
        }
    }

    if (segments.length === 0) {
        let start = 0;
        let match;
        SENTENCE_END.lastIndex = 0;
        while ((match = SENTENCE_END.exec(text)) !== null) {
            const end = match.index + match[0].length;
            const sentence = text.slice(start, end).trim();
            if (sentence) segments.push(sentence);
            start = end;
        }
        const tail = text.slice(start).trim();
        if (tail) segments.push(tail);
    }

    return segments.flatMap((segment) => splitLongSegment(segment, maxChars));
}
