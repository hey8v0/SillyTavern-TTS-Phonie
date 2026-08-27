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

export function makeInlineAudioSourceKey(cacheKey) {
    return `inline:${String(cacheKey || '')}`;
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
        const chatId = this.#bridge.getChatId();
        const descriptors = segments.map((segment, index) => {
            const speaker = segment.speaker || this.#bridge.getContact().name;
            const providerLabel = this.#providerCenter.getLabelForSpeaker(speaker);
            const spokenText = formatSpeechForProvider(segment, providerLabel);
            const cacheKey = makeAudioCacheKey({
                chatId,
                messageId: `${id}-${index}`,
                text: `${segment.emotion}:${spokenText}`,
                provider: this.#providerCenter.getCacheSignature(speaker),
            });
            return { segment, spokenText, cacheKey, audioKey: makeInlineAudioSourceKey(cacheKey) };
        });
        const liveEntries = [...this.#entries.values()]
            .filter((entry) => entry.messageId === id)
            .sort((a, b) => a.index - b.index);
        const unchanged = descriptors.length
            && liveEntries.length === descriptors.length
            && liveEntries.every((entry, index) => (
                entry.element?.isConnected
                && entry.cacheKey === descriptors[index].cacheKey
            ));
        if (unchanged) return;
        this.#dropMessageEntries(id, { restore: false });
        textElement.querySelectorAll('.phonie-inline-button--body, .phonie-inline-button--regenerate, .phonie-inline-actions').forEach((element) => element.remove());
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
            const { segment, spokenText, cacheKey, audioKey } = descriptors[index];
            const entryKey = `${id}:${index}`;
            const entry = {
                key: entryKey,
                audioKey,
                messageId: id,
                index,
                element: buttons[index],
                segment,
                spokenText,
                cacheKey,
                chatId,
            };
            const regenerate = this.#createRegenerateButton(segment);
            buttons[index]?.after(regenerate);
            entry.regenerateElement = regenerate;
            this.#entries.set(entryKey, entry);
            buttons[index]?.addEventListener('click', () => this.#play(entry));
            regenerate.addEventListener('click', () => this.#regenerate(entry));
            const cached = await this.#cache.get(cacheKey);
            if (cached instanceof Blob) this.#audioFocus.setSource(audioKey, cached);
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
        button.dataset.audioState = 'idle';
        button.setAttribute('aria-label', `播放${segment.speaker || '角色'}这句原声`);
        button.title = `${segment.speaker || '角色'} · ${segment.rawEmotion || segment.emotion}`;
        button.innerHTML = `<span class='phonie-inline-button__icon'>${icon('play')}</span><span class='phonie-inline-button__wave' aria-hidden='true'><i></i><i></i><i></i><i></i></span>`;
        return button;
    }

    #createRegenerateButton(segment) {
        const button = document.createElement('button');
        button.className = 'phonie-inline-button phonie-inline-button--regenerate';
        button.type = 'button';
        button.setAttribute('aria-label', `重新生成${segment.speaker || '角色'}这句原声`);
        button.title = '用当前声线路由重新生成';
        button.innerHTML = icon('reset');
        return button;
    }

    #setButtonState(entry, state) {
        const button = entry?.element;
        if (!(button instanceof HTMLElement)) return;
        button.dataset.audioState = state;
        const slot = button.querySelector('.phonie-inline-button__icon');
        if (slot) slot.innerHTML = icon(state === 'playing' ? 'pause' : 'play');
        button.setAttribute('aria-pressed', String(state === 'playing'));
        const labels = { generating: '正在生成这句原声', playing: '暂停这句原声', paused: '继续播放这句原声', error: '语音生成失败，点击重试' };
        button.setAttribute('aria-label', labels[state] || `播放${entry.segment.speaker || '角色'}这句原声`);
    }

    async #play(entry) {
        const audioKey = entry.audioKey;
        if (this.#audioFocus.hasSource(audioKey)) {
            await this.#audioFocus.play(audioKey, {
                owner: 'inline',
                messageId: entry.messageId,
                segmentIndex: entry.index,
                entryKey: entry.key,
            });
            return;
        }
        this.#setButtonState(entry, 'generating');
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
            this.#setButtonState(entry, 'error');
            window.setTimeout(() => this.#setButtonState(entry, 'idle'), 1200);
            throw error;
        }
    }

    async #regenerate(entry) {
        this.#audioFocus.stop();
        this.#audioFocus.deleteSource(entry.audioKey);
        await this.#cache.delete(entry.cacheKey);
        await this.#play(entry);
    }

    #handleFocus(detail) {
        for (const entry of this.#entries.values()) {
            const matched = detail.current?.owner === 'inline' && detail.current?.entryKey === entry.key;
            if (matched) {
                this.#setButtonState(entry, detail.state === 'playing' ? 'playing' : detail.state === 'paused' ? 'paused' : 'idle');
            } else if (entry.element?.dataset.audioState !== 'generating') {
                this.#setButtonState(entry, 'idle');
            }
        }
    }

    #dropMessageEntries(messageId, { restore = true } = {}) {
        for (const [key, entry] of this.#entries) {
            if (entry.messageId !== Number(messageId)) continue;
            if (restore && entry.element?.isConnected) entry.element.replaceWith(document.createTextNode(entry.segment.rawTag));
            entry.regenerateElement?.remove();
            this.#audioFocus.deleteSource(entry.audioKey);
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
