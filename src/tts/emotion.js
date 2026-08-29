/**
 * MiniMax 情绪归一化：来自交接包验证过的情绪映射表。
 * 客户端与 MiniMax 服务插件使用同一套映射，保证跨层一致。
 */

export const MINIMAX_EMOTIONS = Object.freeze([
    'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm', 'fluent', 'neutral',
]);

const EMOTION_NAMES = new Map([
    ['开心', 'happy'], ['快乐', 'happy'], ['happy', 'happy'],
    ['悲伤', 'sad'], ['难过', 'sad'], ['sad', 'sad'],
    ['生气', 'angry'], ['愤怒', 'angry'], ['angry', 'angry'],
    ['害怕', 'fearful'], ['恐惧', 'fearful'], ['fearful', 'fearful'],
    ['厌恶', 'disgusted'], ['disgusted', 'disgusted'],
    ['惊讶', 'surprised'], ['surprised', 'surprised'],
    ['平静', 'neutral'], ['中性', 'neutral'], ['neutral', 'neutral'],
    ['冷静', 'calm'], ['calm', 'calm'],
    ['流利', 'fluent'], ['fluent', 'fluent'],
]);

/** 把任意情绪描述归一化为 MiniMax 支持的标准情绪，无法识别时返回空串（交给服务端去除）。 */
export function normalizeEmotion(value) {
    return EMOTION_NAMES.get(String(value || '').trim().toLowerCase()) || '';
}

/** MiniMax Sound Tags：生成朗读台词时允许植入的英文圆括号标签，visibleText 不显示。 */
export const SOUND_TAGS = Object.freeze([
    '(laughs)', '(chuckle)', '(humming)',
    '(breath)', '(inhale)', '(exhale)', '(pant)', '(gasps)', '(sighs)',
    '(sniffs)', '(snorts)', '(coughs)', '(clear-throat)', '(groans)', '(emm)', '(lip-smacking)', '(sneezes)', '(burps)',
]);

export function stripSoundTags(text) {
    const tags = SOUND_TAGS.map((tag) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`\\s*(${tags.join('|')})\\s*`, 'g');
    return String(text || '').replace(pattern, ' ').replace(/\s{2,}/g, ' ').trim();
}
