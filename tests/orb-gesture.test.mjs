import test from 'node:test';
import assert from 'node:assert/strict';

import { isOrbTap, ORB_DRAG_THRESHOLD, updateOrbDrag } from '../src/ui/orb-gesture.js';

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
