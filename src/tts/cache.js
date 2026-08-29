const DB_NAME = 'phonie-v2-assets';
const DB_VERSION = 2;
const STORE_NAME = 'audio';
const IMAGE_STORE_NAME = 'images';
const MAX_ENTRIES = 160;

let databasePromise;

function openDatabase() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (databasePromise) return databasePromise;

    databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
                store.createIndex('createdAt', 'createdAt');
            }
            if (!database.objectStoreNames.contains(IMAGE_STORE_NAME)) {
                const imageStore = database.createObjectStore(IMAGE_STORE_NAME, { keyPath: 'key' });
                imageStore.createIndex('createdAt', 'createdAt');
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    }).catch(error => {
        console.warn('[TTS Cache] IndexedDB 不可用，将只使用内存缓存。', error);
        return null;
    });
    return databasePromise;
}

function transactionResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function get(key) {
    const database = await openDatabase();
    if (!database) return null;
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const record = await transactionResult(transaction.objectStore(STORE_NAME).get(key));
    return record?.blob instanceof Blob ? record.blob : null;
}

async function prune(database) {
    const countTransaction = database.transaction(STORE_NAME, 'readonly');
    const count = await transactionResult(countTransaction.objectStore(STORE_NAME).count());
    if (count <= MAX_ENTRIES) return;

    const removeCount = count - MAX_ENTRIES;
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const index = transaction.objectStore(STORE_NAME).index('createdAt');
    await new Promise((resolve, reject) => {
        let removed = 0;
        const cursorRequest = index.openCursor();
        cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor || removed >= removeCount) return resolve();
            cursor.delete();
            removed += 1;
            cursor.continue();
        };
        cursorRequest.onerror = () => reject(cursorRequest.error);
    });
}

async function put(key, blob, metadata = {}) {
    if (!(blob instanceof Blob)) return;
    const database = await openDatabase();
    if (!database) return;
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    await transactionResult(transaction.objectStore(STORE_NAME).put({
        key,
        blob,
        providerId: metadata.providerId || '',
        createdAt: Date.now(),
    }));
    await prune(database);
}

async function remove(key) {
    const database = await openDatabase();
    if (!database) return;
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    await transactionResult(transaction.objectStore(STORE_NAME).delete(key));
}

async function clear() {
    const database = await openDatabase();
    if (!database) return;
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    await transactionResult(transaction.objectStore(STORE_NAME).clear());
}

async function stats() {
    const database = await openDatabase();
    if (!database) return { count: 0, bytes: 0 };
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    return new Promise((resolve, reject) => {
        let count = 0;
        let bytes = 0;
        const request = store.openCursor();
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return resolve({ count, bytes });
            count += 1;
            bytes += Number(cursor.value?.blob?.size || 0);
            cursor.continue();
        };
        request.onerror = () => reject(request.error);
    });
}

export const TTS_AudioCache = { get, put, remove, clear, stats };

async function putImage(key, blob, metadata = {}) {
    if (!(blob instanceof Blob)) return;
    const database = await openDatabase();
    if (!database) return;
    const transaction = database.transaction(IMAGE_STORE_NAME, 'readwrite');
    await transactionResult(transaction.objectStore(IMAGE_STORE_NAME).put({
        key,
        blob,
        description: metadata.description || '',
        createdAt: Date.now(),
    }));
}

async function getImage(key) {
    const database = await openDatabase();
    if (!database) return null;
    const transaction = database.transaction(IMAGE_STORE_NAME, 'readonly');
    const record = await transactionResult(transaction.objectStore(IMAGE_STORE_NAME).get(key));
    return record?.blob instanceof Blob ? record.blob : null;
}

async function removeImage(key) {
    const database = await openDatabase();
    if (!database) return;
    const transaction = database.transaction(IMAGE_STORE_NAME, 'readwrite');
    await transactionResult(transaction.objectStore(IMAGE_STORE_NAME).delete(key));
}

async function listImages() {
    const database = await openDatabase();
    if (!database) return [];
    const transaction = database.transaction(IMAGE_STORE_NAME, 'readonly');
    const store = transaction.objectStore(IMAGE_STORE_NAME);
    return new Promise((resolve, reject) => {
        const items = [];
        const request = store.openCursor(null, 'prev');
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return resolve(items);
            const record = cursor.value || {};
            items.push({
                key: String(record.key || cursor.primaryKey),
                description: String(record.description || ''),
                createdAt: Number(record.createdAt) || Date.now(),
                blob: record.blob instanceof Blob ? record.blob : null,
            });
            cursor.continue();
        };
        request.onerror = () => reject(request.error);
    });
}

async function clearImages() {
    const database = await openDatabase();
    if (!database) return;
    const transaction = database.transaction(IMAGE_STORE_NAME, 'readwrite');
    await transactionResult(transaction.objectStore(IMAGE_STORE_NAME).clear());
}

export const TTS_ImageCache = { put: putImage, get: getImage, remove: removeImage, list: listImages, clear: clearImages };

/** 兼容导出：稳定缓存键与面向对象包装。 */
export function cacheKey({ text, provider, voice }) {
    return `${provider}:${voice}:${String(text || '').slice(0, 200)}`;
}

export class AudioCache {
    async get(key) { return get(key); }
    async put(key, blob) { return put(key, blob); }
    async delete(key) { return remove(key); }
    async getStats() { return stats(); }
    async clear() { return clear(); }
}
