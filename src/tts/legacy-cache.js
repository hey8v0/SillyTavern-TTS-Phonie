const DB_NAME = 'tts-voice-hub-cache';
const DB_VERSION = 1;
const STORE_NAME = 'audio';
const MAX_ENTRIES = 160;

let databasePromise;

function openDatabase() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (databasePromise) return databasePromise;

    databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
            store.createIndex('createdAt', 'createdAt');
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
