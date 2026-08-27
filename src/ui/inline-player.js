import {
    BODY_TTS_TAG_PATTERN,
    formatSpeechForProvider,
    parseBodySpeechSegments,
} from '../dialogue/body-speech.js';
import { makeAudioCacheKey } from '../storage/audio-cache.js';
import { AudioActionMenu, downloadAudioSource } from './audio-action-menu.js';
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
    #audioMenu = new AudioActionMenu();

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

        for (let index = 0; index < segments.length; index += 1) {
            if (!buttons[index]) continue;
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
            this.#entries.set(entryKey, entry);
            buttons[index]?.addEventListener('click', () => this.#play(entry));
            this.#audioMenu.bind(buttons[index], {
                download: () => this.#download(entry),
                regenerate: () => this.#regenerate(entry),
            });
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
        while (walker.nextNode()) {
            if (!walker.currentNode.parentElement?.closest('.phonie-inline-button--body')) nodes.push(walker.currentNode);
        }
        const combined = nodes.map((node) => node.nodeValue || '').join('');
        const matches = [];
        BODY_TTS_TAG_PATTERN.lastIndex = 0;
        let match;
        while ((match = BODY_TTS_TAG_PATTERN.exec(combined)) && matches.length < segments.length) {
            matches.push({ start: match.index, end: BODY_TTS_TAG_PATTERN.lastIndex, segment: segments[matches.length] });
        }
        BODY_TTS_TAG_PATTERN.lastIndex = 0;
        const locate = (absolute) => {
            let offset = 0;
            for (const node of nodes) {
                const length = (node.nodeValue || '').length;
                if (absolute <= offset + length) return { node, offset: Math.max(0, absolute - offset) };
                offset += length;
            }
            return null;
        };
        const mapped = matches.map((item) => ({
            ...item,
            startPoint: locate(item.start),
            endPoint: locate(item.end),
        }));
        const buttons = Array(segments.length).fill(null);
        for (let index = mapped.length - 1; index >= 0; index -= 1) {
            const item = mapped[index];
            const start = item.startPoint;
            const end = item.endPoint;
            if (!start || !end) continue;
            const button = this.#createButton(item.segment);
            const range = document.createRange();
            range.setStart(start.node, start.offset);
            range.setEnd(end.node, end.offset);
            range.deleteContents();
            range.insertNode(button);
            range.detach?.();
            buttons[index] = button;
        }
        return buttons;
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

    async #download(entry) {
        if (!this.#audioFocus.hasSource(entry.audioKey)) await this.#play(entry);
        downloadAudioSource(
            this.#audioFocus.getSource(entry.audioKey),
            `${entry.segment.speaker || '角色'}-${entry.messageId}-${entry.index + 1}`,
        );
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
        this.#audioMenu.dispose();
        this.reset();
    }
}
