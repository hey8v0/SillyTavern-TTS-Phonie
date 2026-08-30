export const RESPONSE_MODE_OPTIONS = Object.freeze([
    { id: 'nonstream', label: '非流式（兼容性更好）' },
    { id: 'stream', label: '流式 SSE' },
]);

export function normalizeResponseMode(value) {
    return value === 'stream' ? 'stream' : 'nonstream';
}
