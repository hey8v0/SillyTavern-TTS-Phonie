export const ORB_DRAG_THRESHOLD = 12;

export function shouldStartOrbDrag(event) {
    if (!event || event.isPrimary === false) return false;
    return event.pointerType !== 'mouse' || event.button === 0;
}

export function updateOrbDrag(drag, clientX, clientY, threshold = ORB_DRAG_THRESHOLD) {
    if (!drag) return null;
    const distance = Math.hypot(clientX - drag.startX, clientY - drag.startY);
    if (drag.moved || distance <= threshold) return drag;
    return { ...drag, moved: true };
}

export function isOrbTap(drag, eventType) {
    return Boolean(drag && !drag.moved && eventType === 'pointerup');
}

export function getOrbDockTarget(clientX, clientY, viewportWidth, viewportHeight) {
    const width = Math.max(1, Number(viewportWidth) || 1);
    const height = Math.max(1, Number(viewportHeight) || 1);
    return {
        dockSide: Number(clientX) < width / 2 ? 'left' : 'right',
        dockY: Math.min(0.9, Math.max(0.07, Number(clientY) / height)),
    };
}
