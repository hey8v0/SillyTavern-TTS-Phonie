import { detectLanguage, extractDialogue, segmentSpeech } from './segmenter.js';

export function createSpeechPlan({
    messageId,
    characterName,
    sourceText,
    translationText = '',
    preferredLanguage = 'ja-JP',
    includeNarration = true,
}) {
    const speakText = extractDialogue(sourceText, { includeNarration });
    const detectedLanguage = detectLanguage(speakText);
    const language = detectedLanguage === 'und' ? preferredLanguage : detectedLanguage;

    return Object.freeze({
        messageId,
        characterName: String(characterName || ''),
        sourceText: String(sourceText || '').trim(),
        translationText: String(translationText || '').trim(),
        speakText,
        language,
        segments: segmentSpeech(speakText, { locale: language }),
    });
}
