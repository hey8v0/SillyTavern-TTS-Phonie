import {
    BODY_TTS_TAG_PATTERN,
    formatSpeechForProvider,
    parseBodySpeechSegments,
} from '../dialogue/body-speech.js';
import { makeAudioCacheKey } from '../storage/audio-cache.js';
import { icon } from './dom.js';

function publicSegment(segment) {
    return {
        id: segment.id,
        speaker: segment.speaker,
        emotion: segment.emotion,
        rawEmotion: segment.rawEmotion,
        visibleText: segment.visibleText,
        speakText: segment.speakText,
        language: segment.language,
    };
}

export class InlinePlayerManager {
    #bridge;
    #settings;
    #cache;
    #audioFocus;
    #providerCenter;
    #entries = new Map();
    #unsubscribeAudio = null;

    constructor({ bridge, settings, cache, audioFocus, providerCenter }) {
        this.#bridge = bridge;
        this.#settings = settings;
        this.#cache = cache;
        this.#audioFocus = audioFocus;
        this.#providerCenter = providerCenter;
        this.#unsubscribeAudio = audioFocus.subscribe((detail) => this.#handleFocus(detail));
    }

    updateSettings(settings) {
        this.#settings = settings;
        if (!settings.autoDecorateMessages) this.reset();
    }

    async decorateAll() {
        const messages = this.#bridge.getMessages();
        const start = Math.max(0, messages.length - 40);
        for (let messageId = start; messageId < messages.length; messageId += 1) {
            try {
                await this.decorateMessage(messageId);
            } catch (error) {
                console.warn(`[Phonie] Could not decorate message ${messageId}.`, error);
            }
        }
    }

    async decorateMessage(messageId) {
        if (!this.#settings.autoDecorateMessages) return;
        const id = Number(messageId);
        const message = this.#bridge.getMessage(id);
        if (!message || message.is_user || message.is_system) return;

        const host = document.querySelector(`#chat .mes[mesid="${id}"]`);
        const textElement = host?.querySelector('.mes_text');
        if (!(textElement instanceof HTMLElement)) return;

        const segments = parseBodySpeechSegments(message.mes, {
            messageId: id,
            preferredLanguage: this.#settings.sourceLanguage,
        });
        const liveEntries = [...this.#entries.values()].filter((entry) => entry.messageId === id);
        if (segments.length && liveEntries.length === segments.length && liveEntries.every((entry) => entry.element?.isConnected)) return;
        this.#dropMessageEntries(id, { restore: false });
        textElement.querySelectorAll('.phonie-inline-button--body, .phonie-inline-actions').forEach((element) => element.remove());
        if (!segments.length) return;

        const buttons = this.#replaceTags(textElement, segments);
        for (let index = buttons.length; index < segments.length; index += 1) {
            const rangedButton = this.#createButton(segments[index]);
            if (this.#replaceAcrossTextNodes(textElement, segments[index].rawTag, rangedButton)) {
                buttons.push(rangedButton);
                continue;
            }
            let actions = textElement.querySelector('.phonie-inline-actions');
            if (!actions) {
                actions = document.createElement('span');
                actions.className = 'phonie-inline-actions';
                textElement.append(actions);
            }
            const button = this.#createButton(segments[index]);
            actions.append(button);
            buttons.push(button);
        }

        for (let index = 0; index < segments.length; index += 1) {
            const segment = segments[index];
            const entryKey = `${id}:${index}`;
            const providerLabel = this.#providerCenter.getLabelForSpeaker(segment.speaker || this.#bridge.getContact().name);
            const spokenText = formatSpeechForProvider(segment, providerLabel);
            const cacheKey = makeAudioCacheKey({
                chatId: this.#bridge.getChatId(),
                messageId: `${id}-${index}`,
                text: `${segment.emotion}:${spokenText}`,
                provider: this.#providerCenter.getCacheSignature(segment.speaker || this.#bridge.getContact().name),
            });
            const entry = {
                key: entryKey,
                messageId: id,
                index,
                element: buttons[index],
                segment,
                spokenText,
                cacheKey,
                chatId: this.#bridge.getChatId(),
            };
            this.#entries.set(entryKey, entry);
            buttons[index]?.addEventListener('click', () => this.#play(entry));
            const cached = await this.#cache.get(cacheKey);
            if (cached instanceof Blob) this.#audioFocus.setSource(`inline:${entryKey}`, cached);
        }

        const stored = segments.map(publicSegment);
        const current = message.extra?.phonie?.bodySpeech;
        if (JSON.stringify(current) !== JSON.stringify(stored)) {
            message.extra = message.extra || {};
            message.extra.phonie = { ...(message.extra.phonie || {}), bodySpeech: stored };
            await this.#bridge.saveMessageExtra();
        }
    }

    #replaceTags(textElement, segments) {
        const nodes = [];
        const walker = document.createTreeWalker(textElement, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) nodes.push(walker.currentNode);
        const buttons = [];

        for (const node of nodes) {
            if (buttons.length >= segments.length || node.parentElement?.closest('.phonie-inline-button--body')) continue;
            const text = node.nodeValue || '';
            BODY_TTS_TAG_PATTERN.lastIndex = 0;
            if (!BODY_TTS_TAG_PATTERN.test(text)) {
                BODY_TTS_TAG_PATTERN.lastIndex = 0;
                continue;
            }
            BODY_TTS_TAG_PATTERN.lastIndex = 0;
            const fragment = document.createDocumentFragment();
            let cursor = 0;
            let match;
            while ((match = BODY_TTS_TAG_PATTERN.exec(text)) && buttons.length < segments.length) {
                fragment.append(document.createTextNode(text.slice(cursor, match.index)));
                const button = this.#createButton(segments[buttons.length]);
                fragment.append(button);
                buttons.push(button);
                cursor = BODY_TTS_TAG_PATTERN.lastIndex;
            }
            fragment.append(document.createTextNode(text.slice(cursor)));
            node.replaceWith(fragment);
            BODY_TTS_TAG_PATTERN.lastIndex = 0;
        }
        return buttons;
    }

    #replaceAcrossTextNodes(root, needle, replacement) {
        const nodes = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            if (!walker.currentNode.parentElement?.closest('.phonie-inline-button--body')) nodes.push(walker.currentNode);
        }
        const combined = nodes.map((node) => node.nodeValue || '').join('');
        const startIndex = combined.indexOf(String(needle || ''));
        if (startIndex < 0) return false;
        const endIndex = startIndex + String(needle).length;
        let offset = 0;
        let startNode = null;
        let endNode = null;
        let startOffset = 0;
        let endOffset = 0;
        for (const node of nodes) {
            const length = (node.nodeValue || '').length;
            if (!startNode && startIndex >= offset && startIndex <= offset + length) {
                startNode = node;
                startOffset = startIndex - offset;
            }
            if (endIndex >= offset && endIndex <= offset + length) {
                endNode = node;
                endOffset = endIndex - offset;
                break;
            }
            offset += length;
        }
        if (!startNode || !endNode) return false;
        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        range.deleteContents();
        range.insertNode(replacement);
        range.detach?.();
        return true;
    }

    #createButton(segment) {
        const button = document.createElement('button');
        button.className = 'phonie-inline-button phonie-inline-button--body';
        button.type = 'button';
        button.dataset.phonieBodySegment = String(segment.index);
        button.dataset.emotion = segment.emotion;
        button.setAttribute('aria-label', `播放${segment.speaker || '角色'}这句原声`);
        button.title = `${segment.speaker || '角色'} · ${segment.rawEmotion || segment.emotion}`;
        button.innerHTML = icon('play');
        return button;
    }

    async #play(entry) {
        const audioKey = `inline:${entry.key}`;
        if (this.#audioFocus.hasSource(audioKey)) {
            await this.#audioFocus.play(audioKey, {
                owner: 'inline',
                messageId: entry.messageId,
                segmentIndex: entry.index,
                entryKey: entry.key,
            });
            return;
        }
        entry.element.innerHTML = icon('pause');
        try {
            const result = await this.#providerCenter.synthesize({
                text: entry.spokenText,
                speaker: entry.segment.speaker || this.#bridge.getContact().name,
                emotion: entry.segment.emotion,
                language: entry.segment.language || this.#settings.sourceLanguage,
            });
            this.#audioFocus.setSource(audioKey, result.blob);
            await this.#cache.put(entry.cacheKey, result.blob);
            await this.#audioFocus.play(audioKey, {
                owner: 'inline',
                messageId: entry.messageId,
                segmentIndex: entry.index,
                entryKey: entry.key,
            });
        } catch (error) {
            entry.element.innerHTML = icon('play');
            throw error;
        }
    }

    #handleFocus(detail) {
        for (const entry of this.#entries.values()) {
            const active = detail.current?.owner === 'inline'
                && detail.current?.entryKey === entry.key
                && detail.state === 'playing';
            if (entry.element) entry.element.innerHTML = icon(active ? 'pause' : 'play');
        }
    }

    #dropMessageEntries(messageId, { restore = true } = {}) {
        for (const [key, entry] of this.#entries) {
            if (entry.messageId !== Number(messageId)) continue;
            if (restore && entry.element?.isConnected) entry.element.replaceWith(document.createTextNode(entry.segment.rawTag));
            this.#entries.delete(key);
        }
    }

    removeMessage(messageId) {
        this.#dropMessageEntries(messageId, { restore: false });
    }

    reset() {
        const messageIds = new Set([...this.#entries.values()].map((entry) => entry.messageId));
        for (const messageId of messageIds) this.#dropMessageEntries(messageId, { restore: true });
        document.querySelectorAll('.phonie-inline-actions').forEach((element) => element.remove());
    }

    dispose() {
        this.#unsubscribeAudio?.();
        this.reset();
    }
}
