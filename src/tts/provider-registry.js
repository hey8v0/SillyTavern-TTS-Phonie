export class ProviderRegistry {
    #providers = new Map();

    register(provider) {
        if (!provider?.id || typeof provider.synthesize !== 'function') {
            throw new TypeError('A provider requires an id and synthesize method.');
        }
        if (this.#providers.has(provider.id)) {
            throw new Error(`Provider already registered: ${provider.id}`);
        }
        this.#providers.set(provider.id, provider);
        return provider;
    }

    get(id) {
        return this.#providers.get(id) ?? null;
    }

    list() {
        return Array.from(this.#providers.values(), (provider) => ({
            id: provider.id,
            label: provider.label || provider.id,
            capabilities: { ...(provider.capabilities || {}) },
        }));
    }

    async synthesize(request, fallbackIds = []) {
        const candidates = [request.providerId, ...fallbackIds].filter(Boolean);
        const failures = [];

        for (const id of candidates) {
            const provider = this.get(id);
            if (!provider) {
                failures.push({ id, error: new Error('Provider not registered.') });
                continue;
            }

            try {
                return await provider.synthesize({ ...request, providerId: id });
            } catch (error) {
                failures.push({ id, error });
            }
        }

        throw new AggregateError(failures.map((failure) => failure.error), 'All Phoen TTS providers failed.');
    }
}
