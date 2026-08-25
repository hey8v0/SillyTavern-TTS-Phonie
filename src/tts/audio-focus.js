export class AudioFocusController {
    #audio;
    #sources = new Map();
    #urls = new Set();
    #listeners = new Set();
    #current = null;

    constructor() {
        this.#audio = new Audio();
        this.#audio.preload = 'metadata';
        this.#audio.addEventListener('play', () => this.#emit('playing'));
        this.#audio.addEventListener('pause', () => {
            if (!this.#audio.ended) this.#emit('paused');
        });
        this.#audio.addEventListener('ended', () => this.#emit('ended'));
        this.#audio.addEventListener('error', () => this.#emit('error'));
        this.#audio.addEventListener('timeupdate', () => this.#emit('progress'));
    }

    setSource(key, source) {
        if (!key || !(source instanceof Blob || typeof source === 'string')) return false;
        const previous = this.#sources.get(key);
        if (previous?.objectUrl) {
            URL.revokeObjectURL(previous.objectUrl);
            this.#urls.delete(previous.objectUrl);
        }
        const objectUrl = source instanceof Blob ? URL.createObjectURL(source) : source;
        if (source instanceof Blob) this.#urls.add(objectUrl);
        this.#sources.set(key, { source, objectUrl });
        return true;
    }

    hasSource(key) {
        return this.#sources.has(key);
    }

    getSource(key) {
        return this.#sources.get(key)?.source ?? null;
    }

    async play(key, owner = {}) {
        const entry = this.#sources.get(key);
        if (!entry) return false;
        if (this.#current?.key === key && !this.#audio.paused) {
            this.#audio.pause();
            return true;
        }

        this.#audio.pause();
        this.#current = { key, ...owner };
        this.#audio.src = entry.objectUrl;
        this.#audio.currentTime = 0;
        await this.#audio.play();
        return true;
    }

    stop() {
        this.#audio.pause();
        this.#audio.currentTime = 0;
        this.#current = null;
        this.#emit('stopped');
    }

    subscribe(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    #emit(state) {
        const detail = {
            state,
            current: this.#current ? { ...this.#current } : null,
            currentTime: this.#audio.currentTime || 0,
            duration: Number.isFinite(this.#audio.duration) ? this.#audio.duration : 0,
        };
        for (const listener of this.#listeners) listener(detail);
        if (['ended', 'error', 'stopped'].includes(state)) this.#current = null;
    }

    dispose() {
        this.stop();
        for (const url of this.#urls) URL.revokeObjectURL(url);
        this.#urls.clear();
        this.#sources.clear();
        this.#listeners.clear();
        this.#audio.removeAttribute('src');
    }
}
