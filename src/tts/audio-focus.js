export class AudioFocusController {
    #audio;
    #sources = new Map();
    #urls = new Set();
    #listeners = new Set();
    #current = null;
    #context = null;
    #analyser = null;
    #frequencyData = null;
    #levelFrame = 0;

    constructor() {
        this.#audio = new Audio();
        this.#audio.preload = 'metadata';
        this.#audio.addEventListener('play', () => {
            this.#startLevelLoop();
            this.#emit('playing');
        });
        this.#audio.addEventListener('pause', () => {
            this.#stopLevelLoop();
            if (!this.#audio.ended) this.#emit('paused');
        });
        this.#audio.addEventListener('ended', () => {
            this.#stopLevelLoop();
            this.#emit('ended');
        });
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

    deleteSource(key) {
        const entry = this.#sources.get(key);
        if (!entry) return false;
        if (this.#current?.key === key) this.stop();
        if (entry.objectUrl && this.#urls.has(entry.objectUrl)) {
            URL.revokeObjectURL(entry.objectUrl);
            this.#urls.delete(entry.objectUrl);
        }
        this.#sources.delete(key);
        return true;
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
        await this.#ensureAnalyser();
        await this.#audio.play();
        return true;
    }

    stop() {
        this.#audio.pause();
        this.#audio.currentTime = 0;
        this.#current = null;
        this.#emit('stopped');
    }

    setMuted(muted) {
        this.#audio.muted = Boolean(muted);
    }

    setVolume(volume) {
        this.#audio.volume = Math.min(1, Math.max(0, Number(volume) || 0));
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
            level: this.#readLevel(),
        };
        for (const listener of this.#listeners) listener(detail);
        if (['ended', 'error', 'stopped'].includes(state)) this.#current = null;
    }

    async #ensureAnalyser() {
        if (this.#analyser) {
            if (this.#context?.state === 'suspended') await this.#context.resume().catch(() => {});
            return;
        }
        const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContextClass) return;
        try {
            this.#context = new AudioContextClass();
            const source = this.#context.createMediaElementSource(this.#audio);
            this.#analyser = this.#context.createAnalyser();
            this.#analyser.fftSize = 128;
            this.#analyser.smoothingTimeConstant = 0.72;
            this.#frequencyData = new Uint8Array(this.#analyser.frequencyBinCount);
            source.connect(this.#analyser);
            this.#analyser.connect(this.#context.destination);
            if (this.#context.state === 'suspended') await this.#context.resume().catch(() => {});
        } catch (error) {
            console.debug('[Phonie] Audio analyser unavailable; using motion fallback.', error);
            this.#context = null;
            this.#analyser = null;
            this.#frequencyData = null;
        }
    }

    #readLevel() {
        if (!this.#analyser || !this.#frequencyData) {
            return this.#audio.paused ? 0 : 0.34;
        }
        this.#analyser.getByteFrequencyData(this.#frequencyData);
        const audibleBins = this.#frequencyData.subarray(0, Math.max(8, Math.floor(this.#frequencyData.length * 0.72)));
        const average = audibleBins.reduce((sum, value) => sum + value, 0) / Math.max(1, audibleBins.length);
        return Math.min(1, Math.max(0.06, average / 148));
    }

    #startLevelLoop() {
        this.#stopLevelLoop();
        const tick = () => {
            if (this.#audio.paused || this.#audio.ended) return;
            this.#emit('progress');
            this.#levelFrame = requestAnimationFrame(tick);
        };
        this.#levelFrame = requestAnimationFrame(tick);
    }

    #stopLevelLoop() {
        if (this.#levelFrame) cancelAnimationFrame(this.#levelFrame);
        this.#levelFrame = 0;
    }

    dispose() {
        this.stop();
        this.#stopLevelLoop();
        for (const url of this.#urls) URL.revokeObjectURL(url);
        this.#urls.clear();
        this.#sources.clear();
        this.#listeners.clear();
        this.#audio.removeAttribute('src');
        this.#context?.close?.().catch(() => {});
        this.#context = null;
        this.#analyser = null;
        this.#frequencyData = null;
    }
}
