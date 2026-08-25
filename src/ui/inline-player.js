import { createSpeechPlan } from '../dialogue/speech-plan.js';
import { makeAudioCacheKey } from '../storage/audio-cache.js';
import { escapeHtml, icon } from './dom.js';

function formatDuration(value) {
    if (!Number.isFinite(value) || value <= 0) return '--:--';
    const minutes = Math.floor(value / 60).toString().padStart(2, '0');
    const seconds = Math.floor(value % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

export class InlinePlayerManager {
    #bridge;
    #settings;
    #cache;
    #audioFocus;
    #entries = new Map();
    #unsubscribeAudio = null;

    constructor({ bridge, settings, cache, audioFocus }) {
        this.#bridge = bridge;
        this.#settings = settings;
        this.#cache = cache;
        this.#audioFocus = audioFocus;
        this.#unsubscribeAudio = audioFocus.subscribe((detail) => this.#handleFocus(detail));
    }

    updateSettings(settings) {
        this.#settings = settings;
        if (!settings.autoDecorateMessages) {
            this.reset();
            return;
        }
        for (const entry of this.#entries.values()) {
            entry.element.dataset.theme = settings.theme;
            const translation = entry.element.querySelector('.phoen-inline-translation');
            if (translation) translation.hidden = !settings.showTranslation;
        }
    }

    async decorateAll() {
        const messages = this.#bridge.getMessages();
        const start = Math.max(0, messages.length - 40);
        for (let messageId = start; messageId < messages.length; messageId += 1) {
            try {
                await this.decorateMessage(messageId);
            } catch (error) {
                console.warn(`[Phoen] Could not decorate message ${messageId}.`, error);
            }
        }
    }

    async decorateMessage(messageId) {
        if (!this.#settings.autoDecorateMessages) return;
        const message = this.#bridge.getMessage(messageId);
        if (!message || message.is_user || message.is_system) return;

        const host = document.querySelector(`#chat .mes[mesid="${Number(messageId)}"]`);
        const textElement = host?.querySelector('.mes_text');
        if (!(textElement instanceof HTMLElement)) return;

        const existing = host.querySelector('.phoen-inline-player');
        if (existing) existing.remove();

        let translationText = message.extra?.phoen?.translation || message.extra?.display_text || '';
        if (translationText === message.mes) translationText = '';
        const plan = createSpeechPlan({
            messageId: Number(messageId),
            characterName: message.name || this.#bridge.getContact().name,
            sourceText: message.mes,
            translationText,
            preferredLanguage: this.#settings.sourceLanguage,
        });
        if (!plan.speakText) return;

        const cacheKey = makeAudioCacheKey({
            chatId: this.#bridge.getChatId(),
            messageId,
            text: plan.speakText,
            provider: this.#bridge.getProviderLabel(),
        });
        const element = document.createElement('div');
        element.className = 'phoen-inline-player';
        element.dataset.messageId = String(messageId);
        element.dataset.theme = this.#settings.theme;
        element.innerHTML = `
            <button class="phoen-inline-button" type="button" aria-label="播放角色语音">${icon('play')}</button>
            <div class="phoen-inline-copy">
                <p class="phoen-inline-source" lang="${escapeHtml(plan.language)}">${escapeHtml(plan.speakText)}</p>
                <p class="phoen-inline-translation" lang="${escapeHtml(this.#settings.targetLanguage)}" ${this.#settings.showTranslation ? '' : 'hidden'}>${escapeHtml(plan.translationText || '等待译文')}</p>
            </div>
            <span class="phoen-inline-time">--:--</span>`;
        textElement.insertAdjacentElement('afterend', element);

        const entry = { messageId: Number(messageId), element, plan, cacheKey, chatId: this.#bridge.getChatId() };
        this.#entries.set(Number(messageId), entry);
        element.querySelector('button')?.addEventListener('click', () => this.#play(entry));

        const cached = await this.#cache.get(cacheKey);
        if (cached instanceof Blob) this.#audioFocus.setSource(`inline:${messageId}`, cached);

        if (!translationText && this.#settings.autoTranslate) {
            this.#translateEntry(entry, message);
        }
    }

    async #translateEntry(entry, message) {
        const translated = await this.#bridge.translate(entry.plan.sourceText, this.#settings.targetLanguage);
        if (!translated || this.#bridge.getChatId() !== entry.chatId || !entry.element.isConnected) return;
        message.extra = message.extra || {};
        message.extra.phoen = { ...(message.extra.phoen || {}), translation: translated };
        entry.plan = createSpeechPlan({ ...entry.plan, translationText: translated });
        const element = entry.element.querySelector('.phoen-inline-translation');
        if (element) element.textContent = translated;
        await this.#bridge.saveMessageExtra();
    }

    async #play(entry) {
        const key = `inline:${entry.messageId}`;
        if (this.#audioFocus.hasSource(key)) {
            this.#bridge.stopSpeech();
            await this.#audioFocus.play(key, { owner: 'inline', messageId: entry.messageId });
            return;
        }
        await this.#bridge.speakMessage(entry.messageId);
    }

    async handleAudioReady(event) {
        const messageId = Number(event?.messageId);
        if (!Number.isInteger(messageId) || !this.#entries.has(messageId)) return false;
        const entry = this.#entries.get(messageId);
        const source = event.audio;
        if (!(source instanceof Blob || typeof source === 'string')) return false;
        this.#audioFocus.setSource(`inline:${messageId}`, source);
        if (source instanceof Blob) await this.#cache.put(entry.cacheKey, source);
        return true;
    }

    setCorePlaying(messageId, playing) {
        const entry = this.#entries.get(Number(messageId));
        if (!entry) return;
        const button = entry.element.querySelector('.phoen-inline-button');
        if (button) button.innerHTML = icon(playing ? 'pause' : 'play');
    }

    #handleFocus(detail) {
        for (const entry of this.#entries.values()) {
            const active = detail.current?.owner === 'inline' && detail.current?.messageId === entry.messageId && detail.state === 'playing';
            const button = entry.element.querySelector('.phoen-inline-button');
            if (button) button.innerHTML = icon(active ? 'pause' : 'play');
            if (active || detail.current?.messageId === entry.messageId) {
                const time = entry.element.querySelector('.phoen-inline-time');
                if (time) time.textContent = formatDuration(detail.duration);
            }
        }
    }

    removeMessage(messageId) {
        const entry = this.#entries.get(Number(messageId));
        entry?.element.remove();
        this.#entries.delete(Number(messageId));
    }

    reset() {
        for (const entry of this.#entries.values()) entry.element.remove();
        this.#entries.clear();
    }

    dispose() {
        this.#unsubscribeAudio?.();
        this.reset();
    }
}
