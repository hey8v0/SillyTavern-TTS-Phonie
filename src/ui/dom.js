import { EXTENSION_BASE } from '../core/constants.js';

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function icon(name, className = 'phonie-icon') {
    const safeName = String(name).replace(/[^a-z-]/g, '');
    const safeClass = String(className).replace(/[^a-zA-Z0-9 _-]/g, '');
    return `<svg class="${safeClass}" aria-hidden="true" focusable="false"><use href="${EXTENSION_BASE}/assets/icons/sprite.svg#phonie-${safeName}"></use></svg>`;
}

export function clamp(value, minimum, maximum) {
    return Math.min(Math.max(Number(value) || 0, minimum), maximum);
}

export function formatClock(timestamp = Date.now()) {
    return new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(timestamp);
}

export function initials(value) {
    const first = Array.from(String(value || 'P').trim().replace(/^[@#\s]+/u, ''))[0] || 'P';
    return first.toLocaleUpperCase();
}
