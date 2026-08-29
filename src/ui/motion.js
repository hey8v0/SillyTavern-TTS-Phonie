const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const MOTION_FRAME_INTERVAL = 1000 / 30;
const MAX_DEVICE_PIXEL_RATIO = 1.5;

function readMotionColors(root) {
    const styles = getComputedStyle(root);
    const parser = document.createElement('canvas').getContext('2d');
    const normalize = (value, fallback) => {
        if (!parser) return fallback;
        parser.fillStyle = fallback;
        try {
            parser.fillStyle = value || fallback;
        } catch {
            return fallback;
        }
        return parser.fillStyle;
    };
    return {
        cyan: normalize(styles.getPropertyValue('--voice-cyan').trim(), 'rgb(83, 196, 205)'),
        copper: normalize(styles.getPropertyValue('--voice-copper').trim(), 'rgb(224, 150, 102)'),
        text: normalize(styles.getPropertyValue('--voice-text').trim(), 'rgb(244, 240, 232)'),
    };
}

function activitySpeed(activity) {
    if (activity === 'call') return 1.7;
    if (activity === 'playing') return 1.42;
    if (activity === 'generating') return 1.18;
    return 0.62;
}

/**
 * A small, dependency-free runtime for the phone shell.
 *
 * The home wallpaper borrows the p5 rain-curtain interaction model, but keeps
 * the production runtime local: pointer events only update input state, canvas
 * writes are consolidated in requestAnimationFrame, and animation stops while
 * the phone is hidden, off-route, off-screen, or backgrounded.
 */
export function createPhoneMotionRuntime({ root, screen }) {
    if (!root || !screen) return { sync() {}, destroy() {} };

    const reducedMotionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    let reducedMotion = Boolean(reducedMotionQuery?.matches);
    let destroyed = false;
    let open = !root.classList.contains('minimized');
    let route = root.dataset.voiceRoute || 'home';
    let activity = 'idle';
    let renderKey = '';
    let visible = document.visibilityState !== 'hidden';
    let intersecting = true;
    let canvas = null;
    let context = null;
    let frameHandle = 0;
    let lastFrameTime = 0;
    let canvasWidth = 0;
    let canvasHeight = 0;
    let devicePixelRatio = 1;
    let colors = readMotionColors(root);
    let pressedButton = null;
    let routeTimer = 0;

    const pointer = {
        active: false,
        x: 0,
        y: 0,
        previousX: 0,
        previousY: 0,
        impulse: 0,
    };

    const shouldAnimate = () => (
        !destroyed
        && open
        && route === 'home'
        && visible
        && intersecting
        && Boolean(canvas?.isConnected)
        && !reducedMotion
    );

    const cancelFrame = () => {
        if (frameHandle) cancelAnimationFrame(frameHandle);
        frameHandle = 0;
        lastFrameTime = 0;
    };

    const resizeCanvas = () => {
        if (!canvas?.isConnected) return false;
        const rect = canvas.getBoundingClientRect();
        const nextWidth = Math.max(1, Math.round(rect.width));
        const nextHeight = Math.max(1, Math.round(rect.height));
        const nextRatio = Math.min(MAX_DEVICE_PIXEL_RATIO, Math.max(1, globalThis.devicePixelRatio || 1));
        if (nextWidth === canvasWidth && nextHeight === canvasHeight && nextRatio === devicePixelRatio) return false;
        canvasWidth = nextWidth;
        canvasHeight = nextHeight;
        devicePixelRatio = nextRatio;
        canvas.width = Math.round(canvasWidth * devicePixelRatio);
        canvas.height = Math.round(canvasHeight * devicePixelRatio);
        context = canvas.getContext('2d', { alpha: true });
        context?.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        return true;
    };

    const drawSignalCurtain = (time = 0) => {
        if (!context || !canvasWidth || !canvasHeight) return;
        context.clearRect(0, 0, canvasWidth, canvasHeight);

        const speed = reducedMotion ? 0 : activitySpeed(activity);
        const timeSeconds = time / 1000;
        const lineCount = canvasWidth < 330 ? 7 : 8;
        const horizontalPadding = canvasWidth * 0.06;
        const usableWidth = canvasWidth - horizontalPadding * 2;
        const pointerImpulse = reducedMotion ? 0 : pointer.impulse;

        context.lineCap = 'round';
        context.lineJoin = 'round';
        for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
            const progress = lineCount === 1 ? 0.5 : lineIndex / (lineCount - 1);
            const baseX = horizontalPadding + usableWidth * progress;
            const phase = lineIndex * 0.83;
            const pointerDistance = pointer.active ? Math.abs(pointer.x - baseX) : canvasWidth;
            const pointerWeight = clamp(1 - pointerDistance / Math.max(86, canvasWidth * 0.34), 0, 1);
            const direction = pointer.active ? Math.sign(baseX - pointer.x || 1) : 0;
            const drift = Math.sin(timeSeconds * 0.72 * speed + phase) * (2.2 + progress * 1.8);
            const repulsion = direction * pointerWeight * (8 + pointerImpulse * 18);
            const x = baseX + drift + repulsion;
            const top = -18;
            const bottom = canvasHeight * (0.58 + (lineIndex % 3) * 0.1);
            const bend = Math.sin(timeSeconds * 0.54 * speed + phase * 1.4) * 5 + repulsion * 0.62;

            context.beginPath();
            context.moveTo(baseX, top);
            context.bezierCurveTo(baseX + bend * 0.22, bottom * 0.28, x - bend * 0.35, bottom * 0.7, x, bottom);
            context.globalAlpha = 0.08 + (lineIndex % 2) * 0.025;
            context.strokeStyle = lineIndex % 3 === 0 ? colors.copper : colors.cyan;
            context.lineWidth = 0.72;
            context.stroke();

            const dropCount = 3 + (lineIndex % 3);
            for (let dropIndex = 0; dropIndex < dropCount; dropIndex += 1) {
                const travel = reducedMotion
                    ? (dropIndex + 1) / (dropCount + 1)
                    : (timeSeconds * (0.018 + lineIndex * 0.0014) * speed + dropIndex / dropCount + phase * 0.07) % 1;
                const y = 22 + travel * Math.max(42, bottom - 34);
                const curveProgress = clamp(y / Math.max(1, bottom), 0, 1);
                const dropX = baseX + (x - baseX) * curveProgress + Math.sin(phase + dropIndex * 1.7 + timeSeconds * speed) * 1.4;
                const radius = 1.25 + ((lineIndex + dropIndex) % 3) * 0.42;
                context.beginPath();
                context.ellipse(dropX, y, radius, radius * 1.65, 0, 0, Math.PI * 2);
                context.globalAlpha = 0.13 + ((lineIndex + dropIndex) % 2) * 0.05;
                context.fillStyle = lineIndex % 3 === 0 ? colors.copper : colors.cyan;
                context.fill();
            }
        }

        const pulseX = canvasWidth * 0.79;
        const pulseY = canvasHeight * 0.2;
        const pulse = reducedMotion ? 0.5 : (Math.sin(timeSeconds * 1.7 * speed) + 1) / 2;
        const glow = context.createRadialGradient(pulseX, pulseY, 0, pulseX, pulseY, 72 + pulse * 16);
        glow.addColorStop(0, colors.cyan);
        glow.addColorStop(1, 'transparent');
        context.globalAlpha = activity === 'idle' ? 0.035 : 0.065;
        context.fillStyle = glow;
        context.fillRect(pulseX - 100, pulseY - 100, 200, 200);
        context.globalAlpha = 1;
    };

    const scheduleFrame = () => {
        if (!frameHandle && shouldAnimate()) frameHandle = requestAnimationFrame(drawFrame);
    };

    function drawFrame(now) {
        frameHandle = 0;
        if (!shouldAnimate()) return;
        if (lastFrameTime && now - lastFrameTime < MOTION_FRAME_INTERVAL) {
            frameHandle = requestAnimationFrame(drawFrame);
            return;
        }
        lastFrameTime = now;
        resizeCanvas();
        pointer.impulse *= 0.91;
        drawSignalCurtain(now);
        frameHandle = requestAnimationFrame(drawFrame);
    }

    const attachCanvas = () => {
        const nextCanvas = screen.querySelector('[data-voice-motion-canvas]');
        if (canvas === nextCanvas) return;
        canvas = nextCanvas;
        context = null;
        canvasWidth = 0;
        canvasHeight = 0;
        if (!canvas) {
            cancelFrame();
            return;
        }
        colors = readMotionColors(root);
        resizeCanvas();
        drawSignalCurtain(performance.now?.() || 0);
    };

    const animateRouteEntry = (nextRoute, previousRoute) => {
        if (reducedMotion || !open) return;
        const panel = screen.firstElementChild;
        if (!panel) return;
        const direction = nextRoute === 'home' && previousRoute && previousRoute !== 'home'
            ? 'back'
            : previousRoute === 'home' && nextRoute !== 'home'
                ? 'forward'
                : 'lateral';
        root.dataset.motionDirection = direction;
        panel.classList.add('voice-route-enter');
        window.clearTimeout(routeTimer);
        routeTimer = window.setTimeout(() => panel.classList.remove('voice-route-enter'), 360);
    };

    const releasePressed = () => {
        pressedButton?.classList.remove('is-motion-pressed');
        pressedButton = null;
    };

    const handlePointerDown = event => {
        const button = event.target.closest?.('button:not(:disabled)');
        if (!button || !root.contains(button)) return;
        releasePressed();
        pressedButton = button;
        button.classList.add('is-motion-pressed');
    };

    const handlePointerMove = event => {
        const rect = canvas?.getBoundingClientRect();
        if (!rect || !canvas?.isConnected) return;
        const nextX = clamp(event.clientX - rect.left, 0, rect.width);
        const nextY = clamp(event.clientY - rect.top, 0, rect.height);
        const distance = Math.hypot(nextX - pointer.previousX, nextY - pointer.previousY);
        pointer.previousX = nextX;
        pointer.previousY = nextY;
        pointer.x = nextX;
        pointer.y = nextY;
        pointer.active = true;
        pointer.impulse = clamp(pointer.impulse * 0.72 + distance / 46, 0, 1);
        scheduleFrame();
    };

    const handlePointerLeave = () => {
        pointer.active = false;
        pointer.impulse *= 0.6;
    };

    const handleVisibility = () => {
        visible = document.visibilityState !== 'hidden';
        if (visible) scheduleFrame();
        else cancelFrame();
    };

    const handleReducedMotion = event => {
        reducedMotion = Boolean(event.matches);
        root.dataset.reducedMotion = String(reducedMotion);
        if (reducedMotion) {
            cancelFrame();
            resizeCanvas();
            drawSignalCurtain(0);
        } else {
            scheduleFrame();
        }
    };

    const resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            if (!canvas?.isConnected) return;
            const changed = resizeCanvas();
            if (changed && !shouldAnimate()) drawSignalCurtain(0);
        })
        : null;
    resizeObserver?.observe(screen);

    const intersectionObserver = typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(entries => {
            intersecting = entries[0]?.isIntersecting !== false;
            if (intersecting) scheduleFrame();
            else cancelFrame();
        })
        : null;
    intersectionObserver?.observe(root);

    root.addEventListener('pointerdown', handlePointerDown, true);
    screen.addEventListener('pointermove', handlePointerMove, { passive: true });
    screen.addEventListener('pointerleave', handlePointerLeave, { passive: true });
    window.addEventListener('pointerup', releasePressed, true);
    window.addEventListener('pointercancel', releasePressed, true);
    window.addEventListener('blur', releasePressed);
    document.addEventListener('visibilitychange', handleVisibility);
    reducedMotionQuery?.addEventListener?.('change', handleReducedMotion);
    root.dataset.reducedMotion = String(reducedMotion);

    return {
        sync(next = {}) {
            const previousRoute = route;
            const previousRenderKey = renderKey;
            open = next.open ?? open;
            route = next.route || route;
            activity = next.activity || 'idle';
            renderKey = next.renderKey || route;
            root.dataset.motionState = activity;
            attachCanvas();
            colors = readMotionColors(root);

            if (next.animateRoute && renderKey !== previousRenderKey) {
                animateRouteEntry(route, previousRoute);
            }
            if (shouldAnimate()) scheduleFrame();
            else {
                cancelFrame();
                if (canvas?.isConnected) drawSignalCurtain(0);
            }
        },
        destroy() {
            destroyed = true;
            cancelFrame();
            window.clearTimeout(routeTimer);
            releasePressed();
            resizeObserver?.disconnect();
            intersectionObserver?.disconnect();
            root.removeEventListener('pointerdown', handlePointerDown, true);
            screen.removeEventListener('pointermove', handlePointerMove);
            screen.removeEventListener('pointerleave', handlePointerLeave);
            window.removeEventListener('pointerup', releasePressed, true);
            window.removeEventListener('pointercancel', releasePressed, true);
            window.removeEventListener('blur', releasePressed);
            document.removeEventListener('visibilitychange', handleVisibility);
            reducedMotionQuery?.removeEventListener?.('change', handleReducedMotion);
        },
    };
}
