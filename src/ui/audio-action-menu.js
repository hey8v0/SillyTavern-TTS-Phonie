import { icon } from './dom.js';

const HOLD_DELAY = 520;
const MOVE_TOLERANCE = 10;

function safeFilePart(value) {
    return String(value || 'phonie-audio').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 72) || 'phonie-audio';
}

export function downloadAudioSource(source, name = 'phonie-audio') {
    if (!(source instanceof Blob) && typeof source !== 'string') return false;
    const href = source instanceof Blob ? URL.createObjectURL(source) : source;
    const link = document.createElement('a');
    link.href = href;
    link.download = `${safeFilePart(name)}.${source instanceof Blob && /ogg/i.test(source.type) ? 'ogg' : source instanceof Blob && /wav/i.test(source.type) ? 'wav' : 'mp3'}`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    if (source instanceof Blob) window.setTimeout(() => URL.revokeObjectURL(href), 1200);
    return true;
}

export class AudioActionMenu {
    #element = null;
    #bindings = new WeakMap();
    #outsideHandler;

    constructor() {
        this.#outsideHandler = (event) => {
            if (!this.#element?.hidden && !this.#element.contains(event.target)) this.close();
        };
        document.addEventListener('pointerdown', this.#outsideHandler, true);
    }

    #ensure() {
        if (this.#element?.isConnected) return this.#element;
        const menu = document.createElement('div');
        menu.className = 'phonie-audio-action-menu';
        menu.hidden = true;
        menu.setAttribute('role', 'menu');
        menu.innerHTML = `<button type="button" data-audio-menu-action="download" role="menuitem">${icon('download')}<span>下载</span></button><button type="button" data-audio-menu-action="regenerate" role="menuitem">${icon('reset')}<span>重新生成</span></button>`;
        document.body.append(menu);
        this.#element = menu;
        return menu;
    }

    bind(element, actions = {}) {
        if (!(element instanceof HTMLElement) || this.#bindings.has(element)) return;
        let timer = 0;
        let startX = 0;
        let startY = 0;
        let longPressed = false;
        const cancel = () => { window.clearTimeout(timer); timer = 0; };
        const onDown = (event) => {
            if (event.button !== undefined && event.button !== 0) return;
            startX = event.clientX;
            startY = event.clientY;
            longPressed = false;
            cancel();
            timer = window.setTimeout(() => {
                longPressed = true;
                navigator.vibrate?.(12);
                this.open(element, actions);
            }, HOLD_DELAY);
        };
        const onMove = (event) => {
            if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_TOLERANCE) cancel();
        };
        const onClick = (event) => {
            if (!longPressed) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            longPressed = false;
        };
        const onContext = (event) => { event.preventDefault(); this.open(element, actions); };
        element.addEventListener('pointerdown', onDown);
        element.addEventListener('pointermove', onMove);
        element.addEventListener('pointerup', cancel);
        element.addEventListener('pointercancel', cancel);
        element.addEventListener('click', onClick, true);
        element.addEventListener('contextmenu', onContext);
        this.#bindings.set(element, true);
    }

    open(anchor, actions) {
        const menu = this.#ensure();
        menu.hidden = false;
        const rect = anchor.getBoundingClientRect();
        const width = 176;
        menu.style.left = `${Math.min(window.innerWidth - width - 12, Math.max(12, rect.left + rect.width / 2 - width / 2))}px`;
        menu.style.top = `${Math.max(12, rect.top > 130 ? rect.top - 78 : rect.bottom + 12)}px`;
        for (const button of menu.querySelectorAll('[data-audio-menu-action]')) {
            const action = button.dataset.audioMenuAction;
            button.hidden = typeof actions[action] !== 'function';
            button.onclick = async (event) => { event.stopPropagation(); this.close(); await actions[action]?.(); };
        }
    }

    close() { if (this.#element) this.#element.hidden = true; }
    dispose() {
        document.removeEventListener('pointerdown', this.#outsideHandler, true);
        this.#element?.remove();
        this.#element = null;
    }
}
