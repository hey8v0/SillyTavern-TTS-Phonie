import { EXTENSION_BASE } from '../core/constants.js';

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function icon(name, className = 'phoen-icon') {
    const safeName = String(name).replace(/[^a-z-]/g, '');
    const safeClass = String(className).replace(/[^a-zA-Z0-9 _-]/g, '');
    return `<svg class="${safeClass}" aria-hidden="true" focusable="false"><use href="${EXTENSION_BASE}/assets/icons/sprite.svg#phoen-${safeName}"></use></svg>`;
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
    const parts = String(value || 'P').trim().split(/\s+/).filter(Boolean);
    if (parts.length > 1) return `${parts[0][0]}${parts.at(-1)[0]}`.toUpperCase();
    return Array.from(parts[0] || 'P').slice(0, 2).join('').toUpperCase();
}
