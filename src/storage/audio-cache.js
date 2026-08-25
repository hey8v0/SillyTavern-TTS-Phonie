import { hashString } from '../core/id.js';

const DATABASE_NAME = 'phoen-audio';
const STORE_NAME = 'audio';
const DATABASE_VERSION = 1;

export function makeAudioCacheKey({ chatId, messageId, text, provider = 'tavern' }) {
    return [
        String(chatId || 'no-chat'),
        String(messageId ?? 'detached'),
        provider,
        hashString(text),
    ].join(':');
}

export class AudioCache {
    #databasePromise = null;
    #memory = new Map();

    async #open() {
        if (!globalThis.indexedDB) return null;
        if (this.#databasePromise) return this.#databasePromise;

        this.#databasePromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(STORE_NAME)) {
                    request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        }).catch((error) => {
            console.warn('[Phoen] IndexedDB cache unavailable.', error);
            return null;
        });

        return this.#databasePromise;
    }

    async get(key) {
        if (this.#memory.has(key)) return this.#memory.get(key);
        const database = await this.#open();
        if (!database) return null;

        return new Promise((resolve) => {
            const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
            request.onsuccess = () => {
                const value = request.result?.blob ?? null;
                if (value) this.#memory.set(key, value);
                resolve(value);
            };
            request.onerror = () => resolve(null);
        });
    }

    async put(key, blob) {
        if (!(blob instanceof Blob)) return;
        this.#memory.set(key, blob);
        const database = await this.#open();
        if (!database) return;

        await new Promise((resolve) => {
            const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put({
                key,
                blob,
                updatedAt: Date.now(),
            });
            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
        });
    }

    async clear() {
        this.#memory.clear();
        const database = await this.#open();
        if (!database) return;
        await new Promise((resolve) => {
            const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear();
            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
        });
    }
}
