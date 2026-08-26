function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

export function normalizeBatteryStatus(battery) {
    const level = finiteNumber(battery?.level);
    return {
        available: level !== null,
        percent: level === null ? null : Math.min(100, Math.max(0, Math.round(level * 100))),
        charging: Boolean(battery?.charging),
    };
}

export function normalizeNetworkStatus({ online = true, connection = null } = {}) {
    if (!online) return { online: false, label: '离线', kind: 'offline', downlink: null };
    const rawType = String(connection?.type || connection?.effectiveType || '').toLowerCase();
    const kind = rawType.includes('wifi') ? 'wifi'
        : rawType.includes('ethernet') ? 'ethernet'
            : /(^|[^a-z])(slow-2g|2g|3g|4g|5g)([^a-z]|$)/.test(rawType) ? 'cellular'
                : 'online';
    const labels = {
        'slow-2g': '2G',
        '2g': '2G',
        '3g': '3G',
        '4g': '4G',
        '5g': '5G',
        wifi: 'Wi-Fi',
        ethernet: '有线',
    };
    return {
        online: true,
        label: labels[rawType] || (kind === 'wifi' ? 'Wi-Fi' : kind === 'ethernet' ? '有线' : '在线'),
        kind,
        downlink: finiteNumber(connection?.downlink),
    };
}

export function createDeviceStatusSnapshot({ navigatorRef = globalThis.navigator, battery = null } = {}) {
    return {
        battery: normalizeBatteryStatus(battery),
        network: normalizeNetworkStatus({
            online: navigatorRef?.onLine !== false,
            connection: navigatorRef?.connection || navigatorRef?.mozConnection || navigatorRef?.webkitConnection || null,
        }),
    };
}

export class DeviceStatusMonitor {
    #navigator;
    #window;
    #listener;
    #battery = null;
    #disposers = [];

    constructor({ navigatorRef = globalThis.navigator, windowRef = globalThis.window, onChange = () => {} } = {}) {
        this.#navigator = navigatorRef;
        this.#window = windowRef;
        this.#listener = onChange;
    }

    async start() {
        const connection = this.#navigator?.connection || this.#navigator?.mozConnection || this.#navigator?.webkitConnection;
        const emit = () => this.#listener(this.snapshot());
        for (const event of ['online', 'offline']) {
            this.#window?.addEventListener?.(event, emit);
            this.#disposers.push(() => this.#window?.removeEventListener?.(event, emit));
        }
        connection?.addEventListener?.('change', emit);
        this.#disposers.push(() => connection?.removeEventListener?.('change', emit));

        emit();
        try {
            if (typeof this.#navigator?.getBattery === 'function') {
                this.#battery = await this.#navigator.getBattery();
                for (const event of ['levelchange', 'chargingchange']) {
                    this.#battery?.addEventListener?.(event, emit);
                    this.#disposers.push(() => this.#battery?.removeEventListener?.(event, emit));
                }
            }
        } catch (error) {
            console.debug('[Phonie] Battery API is unavailable; status bar will use an honest fallback.', error);
        }
        emit();
        return this.snapshot();
    }

    snapshot() {
        return createDeviceStatusSnapshot({ navigatorRef: this.#navigator, battery: this.#battery });
    }

    dispose() {
        for (const dispose of this.#disposers.splice(0)) dispose();
        this.#battery = null;
    }
}
