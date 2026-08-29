/**
 * Phonie 1.0 原创内联 SVG 图标系统。
 * 所有图标统一使用 24×24 画布、圆角几何和 currentColor；不依赖字体图标或 emoji。
 */

function svg(content, { fill = 'none', stroke = 'currentColor', strokeWidth = 1.8 } = {}) {
    return `<svg viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${content}</svg>`;
}

function qq() {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M7.1 10.1C7.1 5.9 9.1 3 12 3s4.9 2.9 4.9 7.1c0 1.1-.1 2-.4 2.9 1.5 1.1 2.4 2.6 2.6 4.5.1.7-.5 1.3-1.2 1.1l-2-.5c-1 1.1-2.3 1.8-3.9 1.8s-2.9-.7-3.9-1.8l-2 .5c-.7.2-1.3-.4-1.2-1.1.2-1.9 1.1-3.4 2.6-4.5-.3-.9-.4-1.8-.4-2.9Z" fill="currentColor"/>
        <ellipse cx="12" cy="11" rx="3.55" ry="4.3" fill="white"/>
        <ellipse cx="10.65" cy="8.5" rx=".78" ry="1.05" fill="#12201e"/>
        <ellipse cx="13.35" cy="8.5" rx=".78" ry="1.05" fill="#12201e"/>
        <path d="M10.7 10.5 12 9.8l1.3.7-1.3 1-1.3-1Z" fill="#F2A65A"/>
        <path d="M8.7 14.4c2.1 1 4.5 1 6.6 0" stroke="#E35B69" stroke-width="1.55" stroke-linecap="round"/>
    </svg>`;
}

function phone() { return svg('<path d="M7.2 3.4 9.4 7a1.6 1.6 0 0 1-.2 1.9L7.7 10.4a15.2 15.2 0 0 0 5.9 5.9l1.5-1.5a1.6 1.6 0 0 1 1.9-.2l3.6 2.2a1.6 1.6 0 0 1 .7 1.8l-.5 2a2 2 0 0 1-2 1.5C9.5 21.4 2.6 14.5 1.9 5.2a2 2 0 0 1 1.5-2l2-.5a1.6 1.6 0 0 1 1.8.7Z" fill="currentColor" stroke="none"/>'); }
function contacts() { return svg('<rect x="3" y="3" width="15" height="18" rx="4"/><path d="M18 7h3M18 12h3M18 17h3"/><circle cx="10.5" cy="9" r="2.6"/><path d="M6.8 16.2c.8-2 2-3 3.7-3s2.9 1 3.7 3"/>'); }
function trace() { return svg('<path d="M3 12h3l1.8-4.2 3.1 9 2.4-6 1.5 2.8H21"/><path d="M4.5 5.5A9 9 0 1 1 3 15" opacity=".55"/><path d="m3 5.5 3.4-.2-.2 3.4"/>'); }
function engine() { return svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 8.5v7M12 6.8v10.4M15 9.6v4.8"/><path d="M4 9H2M4 15H2M22 9h-2M22 15h-2" opacity=".65"/>'); }
function draw() { return svg('<path d="M4 20c2.8.2 4.8-.8 5.7-3.1.4-1.1-.1-2.3-1.2-2.8-1.1-.5-2.4 0-2.9 1.1-.4.9-.4 2.1-1.6 2.6"/><path d="m9.2 14.4 8.9-10a1.8 1.8 0 0 1 2.7 2.4l-9.1 10.1"/><path d="m17.1 5.6 2.2 2"/>'); }
function theme() { return svg('<path d="M12 2.5c5.2 0 9.5 3.9 9.5 8.8 0 3.1-1.8 4.6-4.2 4.6h-1.4c-1.1 0-1.8.7-1.8 1.7 0 .6.3 1 .3 1.6 0 1.4-1.2 2.3-2.7 2.3-5.2 0-9.2-4-9.2-9.3 0-5.4 4.2-9.7 9.5-9.7Z"/><circle cx="7.2" cy="10.1" r="1" fill="currentColor" stroke="none"/><circle cx="9.3" cy="6.6" r="1" fill="currentColor" stroke="none"/><circle cx="13.5" cy="6.2" r="1" fill="currentColor" stroke="none"/><circle cx="16.8" cy="9" r="1" fill="currentColor" stroke="none"/>'); }
function settings() { return svg('<path d="M5 7h9M18 7h1M5 12h2M11 12h8M5 17h7M16 17h3"/><circle cx="16" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="14" cy="17" r="2" fill="currentColor" stroke="none"/>'); }

function back() { return svg('<path d="m14.5 5-7 7 7 7"/>'); }
function chevron() { return svg('<path d="m9.5 5 7 7-7 7"/>'); }
function close() { return svg('<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>'); }
function wifi() { return svg('<path d="M3.2 9.5a13.2 13.2 0 0 1 17.6 0M6.4 13a8.4 8.4 0 0 1 11.2 0M9.6 16.4a3.7 3.7 0 0 1 4.8 0"/><circle cx="12" cy="19.2" r="1" fill="currentColor" stroke="none"/>'); }
function bolt() { return svg('<path d="m13.5 2-8 11h5.4L10.5 22l8-12h-5.4l.4-8Z" fill="currentColor" stroke="none"/>'); }
function battery() { return svg('<rect x="2" y="7" width="17" height="10" rx="3"/><path d="M21 10v4"/><path d="M5 10h8" stroke-width="3"/>'); }
function spark() { return svg('<path d="M12 2.5c.6 5.3 2.2 7 7.5 7.5-5.3.6-7 2.2-7.5 7.5-.6-5.3-2.2-7-7.5-7.5 5.3-.6 7-2.2 7.5-7.5Z"/><path d="M19 16.5c.2 2 1 2.8 3 3-2 .2-2.8 1-3 3-.2-2-1-2.8-3-3 2-.2 2.8-1 3-3Z"/>'); }
function message() { return svg('<path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10l-5.2 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 12.5h6" opacity=".7"/>'); }
function send() { return svg('<path d="m3 4 18 8-18 8 2.4-6.1L15 12l-9.6-1.9L3 4Z" fill="currentColor" stroke="none"/>'); }
function plus() { return svg('<path d="M12 5v14M5 12h14"/>'); }
function image() { return svg('<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.2" cy="8.2" r="1.4"/><path d="m4.5 17 4.2-4.3 3.1 2.8 3.8-4.1 4 4.6"/>'); }
function wallet() { return svg('<path d="M4 5h14a2 2 0 0 1 2 2v12H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="M15 10h7v5h-7a2.5 2.5 0 0 1 0-5Z"/><circle cx="16" cy="12.5" r=".8" fill="currentColor" stroke="none"/>'); }
function trash() { return svg('<path d="M4.5 7h15M9 4h6l1 3H8l1-3ZM6.5 7l.8 14h9.4l.8-14M10 11v6M14 11v6"/>'); }
function play() { return svg('<path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none"/>'); }
function pause() { return svg('<rect x="6.5" y="5" width="4" height="14" rx="1.4" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1.4" fill="currentColor" stroke="none"/>'); }
function headphones() { return svg('<path d="M4 13v-2a8 8 0 0 1 16 0v2"/><path d="M4 12h2.5A1.5 1.5 0 0 1 8 13.5v5A1.5 1.5 0 0 1 6.5 20H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 1-2ZM20 12h-2.5a1.5 1.5 0 0 0-1.5 1.5v5a1.5 1.5 0 0 0 1.5 1.5H19a2 2 0 0 0 2-2v-4a2 2 0 0 0-1-2Z"/>'); }
function person() { return svg('<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.7-5 3.2-7.5 7.5-7.5s6.8 2.5 7.5 7.5"/>'); }
function layers() { return svg('<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>'); }
function sliders() { return svg('<path d="M4 6h5M13 6h7M4 12h9M17 12h3M4 18h3M11 18h9"/><circle cx="11" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>'); }
function quote() { return svg('<path d="M5 6h5v5H6.5c0 3-1 5.2-3 7M14 6h5v5h-3.5c0 3-1 5.2-3 7"/>'); }
function star() { return svg('<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/>'); }
function endCall() { return svg('<path d="M4.3 15.8c4.9-4.6 10.5-4.6 15.4 0l-2.6 3.1-3.2-2.1.5-2.3c-1.6-.6-3.2-.6-4.8 0l.5 2.3-3.2 2.1-2.6-3.1Z" fill="currentColor" stroke="none"/>'); }
function check() { return svg('<path d="m4.5 12.5 4.6 4.6L19.8 6.4"/>'); }
function eye() { return svg('<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.8"/>'); }
function refresh() { return svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'); }

/*
 * PHOEN_ORIGINAL_HANDOFF_2026-08-25 / mobile_icons.js 中的通用资产。
 * 这些路径统一收口到 Phonie 的 24px 图标系统；业务冲突项不会因此恢复。
 */
function activity() { return svg('<path d="M4 12h3l2.2-6 4.2 12 2.1-6H20"/>'); }
function arrowUp() { return svg('<path d="m6 15 6-6 6 6"/>'); }
function arrowDown() { return svg('<path d="m6 9 6 6 6-6"/>'); }
function bell() { return svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>'); }
function bookmark() { return svg('<path d="M6 4.8A1.8 1.8 0 0 1 7.8 3h8.4A1.8 1.8 0 0 1 18 4.8V21l-6-3.5L6 21z"/>'); }
function cloud() { return svg('<path d="M17.5 19H7a5 5 0 0 1-.8-9.94A7 7 0 0 1 19.7 11.5 3.75 3.75 0 0 1 17.5 19Z"/>'); }
function database() { return svg('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>'); }
function download() { return svg('<path d="M12 3v12m0 0 5-5m-5 5-5-5"/><path d="M5 21h14"/>'); }
function edit() { return svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>'); }
function upload() { return svg('<path d="M12 21V9m0 0 5 5m-5-5-5 5"/><path d="M5 3h14"/>'); }
function users() { return svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'); }
function globe() { return svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.5 3.7 5.5 3.7 9S14.4 18.5 12 21c-2.4-2.5-3.7-5.5-3.7-9S9.6 5.5 12 3Z"/>'); }
function grid() { return svg('<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>'); }
function grip() { return svg('<circle cx="8" cy="6" r="1"/><circle cx="16" cy="6" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="8" cy="18" r="1"/><circle cx="16" cy="18" r="1"/>'); }
function home() { return svg('<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>'); }
function info() { return svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'); }
function key() { return svg('<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8m-3 3 3 3m-6 0 3 3"/>'); }
function library() { return svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5v-13A2.5 2.5 0 0 1 6.5 3Z"/>'); }
function messageCircle() { return svg('<path d="M21 11.5a8.5 8.5 0 0 1-9 8.5 9.8 9.8 0 0 1-4-.9L3 21l1.8-4.4A8.7 8.7 0 1 1 21 11.5Z"/>'); }
function microphone() { return svg('<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>'); }
function orbit() { return svg('<circle cx="12" cy="12" r="2"/><ellipse cx="12" cy="12" rx="9" ry="4.5" transform="rotate(35 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="4.5" transform="rotate(-35 12 12)"/>'); }
function radio() { return svg('<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4m8.4 0a6 6 0 0 0 0-8.4M4.9 4.9a10 10 0 0 0 0 14.2m14.2 0a10 10 0 0 0 0-14.2"/>'); }
function repeat() { return svg('<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>'); }
function search() { return svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'); }
function sun() { return svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>'); }
function tasks() { return svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m7.5 9 1.5 1.5L11.5 8M13.5 9H17M7.5 15l1.5 1.5 2.5-2.5M13.5 15H17"/>'); }
function undo() { return svg('<path d="m9 7-5 5 5 5"/><path d="M20 17a7 7 0 0 0-7-7H4"/>'); }
function volume() { return svg('<path d="M11 5 6 9H2v6h4l5 4Z"/><path d="M15 9a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12"/>'); }
function moon() { return svg('<path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z"/>'); }
function waveform() { return svg('<path d="M3 12h2l2-6 3 12 3-12 3 12 2-6h3"/>'); }
function gift() { return svg('<rect x="3" y="9" width="18" height="12" rx="1"/><path d="M12 9v12M3 13h18M7.5 9C5 9 4 7.8 4 6.5S5.1 4 6.5 4C9 4 12 9 12 9m4.5 0C19 9 20 7.8 20 6.5S18.9 4 17.5 4C15 4 12 9 12 9"/>'); }

function engineIndex() { return svg('<rect x="3" y="4" width="18" height="16" rx="4"/><path d="M7 8v8M10.5 10v4M14 7v10M17.5 9v6"/>'); }
function engineGpt() { return svg('<path d="M8 4.2A4 4 0 0 1 15.2 6 4 4 0 0 1 19 12a4 4 0 0 1-3 6.5A4 4 0 0 1 8.8 18 4 4 0 0 1 5 12a4 4 0 0 1 3-7.8Z"/><path d="m8 8 4-2.2L16 8v4.5l-4 2.3-4-2.3V8Zm4-2.2v4.5m4-2.3-4 2.3m0 4.5v3.4"/>'); }
function engineVox() { return svg('<path d="M4 9v6M8 6v12M12 3v18M16 7v10M20 10v4"/><path d="M2 12h20" opacity=".35"/>'); }
function engineEdge() { return svg('<path d="M20.5 15.5c-1.4 3.7-4.4 5.5-8.4 5.5-5.3 0-9.1-3.5-9.1-8.7C3 7 7.2 3 12.5 3c4.8 0 8.2 3.1 8.5 7.7H8.3c.5 2.6 2.5 4.1 5.2 4.1 2.3 0 4.1-.8 5.5-2.2"/>'); }
function engineEleven() { return svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 8v8M15 8v8" stroke-width="2.8"/>'); }
function engineMinimax() { return svg('<path d="M3 18V6l5 7 4-7 4 7 5-7v12"/><path d="M7 18h10" opacity=".55"/>'); }

const ICONS = Object.freeze({
    qq, phone, contacts, trace, engine, draw, theme, settings,
    back, chevron, close, wifi, bolt, battery, spark, message, send, plus,
    image, wallet, trash, play, pause, headphones, person, layers, sliders,
    quote, star, endCall, check, eye, refresh,
    activity, arrowUp, arrowDown, bell, bookmark, cloud, database, download,
    edit, upload, users, globe, grid, grip, home, info, key, library,
    messageCircle, microphone, orbit, radio, repeat, search, sun, tasks, undo,
    volume, moon, waveform, gift,
    arrowLeft: back,
    chevronRight: chevron,
    engineIndex, engineGpt, engineVox, engineEdge, engineEleven, engineMinimax,
});

export function icon(name, className = 'phonie-icon') {
    const factory = ICONS[name];
    if (!factory) return '';
    const safeClass = String(className).replace(/[^a-zA-Z0-9 _-]/g, '');
    return factory().replace('<svg ', `<svg class="${safeClass}" `);
}
