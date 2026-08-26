import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getOrbDockTarget,
    isOrbTap,
    ORB_DRAG_THRESHOLD,
    shouldStartOrbDrag,
    updateOrbDrag,
} from '../src/ui/orb-gesture.js';

test('small pointer jitter remains a tap', () => {
    const drag = { pointerId: 1, startX: 100, startY: 200, moved: false };
    const updated = updateOrbDrag(drag, 100 + ORB_DRAG_THRESHOLD - 1, 200);

    assert.equal(updated.moved, false);
    assert.equal(isOrbTap(updated, 'pointerup'), true);
});

test('movement beyond the threshold becomes a drag', () => {
    const drag = { pointerId: 1, startX: 100, startY: 200, moved: false };
    const updated = updateOrbDrag(drag, 100 + ORB_DRAG_THRESHOLD + 1, 200);

    assert.equal(updated.moved, true);
    assert.equal(isOrbTap(updated, 'pointerup'), false);
});

test('a cancelled pointer gesture never opens the phone', () => {
    const drag = { pointerId: 1, startX: 100, startY: 200, moved: false };

    assert.equal(isOrbTap(drag, 'pointercancel'), false);
});

test('touch pointers are accepted even when WebView reports button minus one', () => {
    assert.equal(shouldStartOrbDrag({ pointerType: 'touch', button: -1, isPrimary: true }), true);
    assert.equal(shouldStartOrbDrag({ pointerType: 'mouse', button: 2, isPrimary: true }), false);
    assert.equal(shouldStartOrbDrag({ pointerType: 'touch', button: 0, isPrimary: false }), false);
});

test('orb release snaps to the closest edge with a clamped vertical position', () => {
    assert.deepEqual(getOrbDockTarget(40, -200, 400, 800), { dockSide: 'left', dockY: 0.07 });
    assert.deepEqual(getOrbDockTarget(360, 1200, 400, 800), { dockSide: 'right', dockY: 0.9 });
});
