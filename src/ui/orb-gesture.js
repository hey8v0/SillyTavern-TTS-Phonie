export const ORB_DRAG_THRESHOLD = 12;

export function updateOrbDrag(drag, clientX, clientY, threshold = ORB_DRAG_THRESHOLD) {
    if (!drag) return null;
    const distance = Math.hypot(clientX - drag.startX, clientY - drag.startY);
    if (drag.moved || distance <= threshold) return drag;
    return { ...drag, moved: true };
}

export function isOrbTap(drag, eventType) {
    return Boolean(drag && !drag.moved && eventType === 'pointerup');
}
