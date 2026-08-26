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
        dockY: Math.min(1, Math.max(0, Number(clientY) / height)),
    };
}

export function getOrbDockTargetFromRect(rect, viewportWidth, viewportHeight, edgeInset = 8) {
    const width = Math.max(1, Number(viewportWidth) || 1);
    const height = Math.max(1, Number(viewportHeight) || 1);
    const orbWidth = Math.max(1, Number(rect?.width) || 48);
    const orbHeight = Math.max(1, Number(rect?.height) || 48);
    const top = Math.min(height - orbHeight - edgeInset, Math.max(edgeInset, Number(rect?.top) || 0));
    const range = Math.max(1, height - orbHeight - edgeInset * 2);
    return {
        dockSide: (Number(rect?.left) || 0) + orbWidth / 2 < width / 2 ? 'left' : 'right',
        dockY: Math.min(1, Math.max(0, (top - edgeInset) / range)),
    };
}

export function getOrbTop(dockY, viewportHeight, orbHeight = 48, edgeInset = 8) {
    const height = Math.max(1, Number(viewportHeight) || 1);
    const size = Math.max(1, Number(orbHeight) || 48);
    const range = Math.max(0, height - size - edgeInset * 2);
    return edgeInset + Math.min(1, Math.max(0, Number(dockY) || 0)) * range;
}
