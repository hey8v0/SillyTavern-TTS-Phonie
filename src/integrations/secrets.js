import {
    SECRET_KEYS,
    canViewSecrets,
    deleteSecret,
    findSecret,
    secret_state,
    writeSecret,
} from '/scripts/secrets.js';

export const PHONIE_SECRET_KINDS = Object.freeze({
    OPENAI: 'openai',
    ELEVENLABS: 'elevenlabs',
});

function keyFor(kind) {
    if (kind === PHONIE_SECRET_KINDS.ELEVENLABS) return SECRET_KEYS.ELEVENLABS;
    return SECRET_KEYS.CUSTOM;
}

export function hasSecretReference(kind, secretId) {
    if (!secretId) return false;
    const values = secret_state[keyFor(kind)];
    return Array.isArray(values) && values.some((item) => item?.id === secretId);
}

export async function savePhonieSecret(kind, value, label) {
    const clean = String(value || '').trim();
    if (!clean) throw new Error('密钥不能为空');
    const id = await writeSecret(keyFor(kind), clean, String(label || 'Phonie').slice(0, 120));
    if (!id) throw new Error('SillyTavern 未返回密钥 ID');
    return id;
}

export async function revealPhonieSecret(kind, secretId) {
    if (!secretId) return '';
    const value = await findSecret(keyFor(kind), secretId);
    if (value === null) {
        throw new Error('SillyTavern 已禁止密钥揭示。请在 config.yaml 将 allowKeysExposure 设为 true，重启后再使用该直连接口。');
    }
    return String(value || '');
}

export async function removePhonieSecret(kind, secretId) {
    if (!secretId) return;
    await deleteSecret(keyFor(kind), secretId);
}

export async function canRevealPhonieSecrets() {
    return canViewSecrets();
}

/** 把早期版本误存于扩展设置的明文密钥一次性迁入 SillyTavern Secrets。 */
export async function migrateLegacySecrets(bridge, settings) {
    let changed = false;
    const customOpenAIPresets = [];
    for (const preset of settings.customOpenAIPresets || []) {
        const next = { ...preset };
        if (next.apiKey) {
            next.secretId = await savePhonieSecret(PHONIE_SECRET_KINDS.OPENAI, next.apiKey, `Phonie · ${next.name || 'OpenAI'}`);
            delete next.apiKey;
            changed = true;
        }
        customOpenAIPresets.push(next);
    }

    const ttsProviderSettings = { ...(settings.ttsProviderSettings || {}) };
    const eleven = { ...(ttsProviderSettings.elevenlabs || {}) };
    if (eleven.apiKey) {
        eleven.secretId = await savePhonieSecret(PHONIE_SECRET_KINDS.ELEVENLABS, eleven.apiKey, 'Phonie · ElevenLabs');
        delete eleven.apiKey;
        ttsProviderSettings.elevenlabs = eleven;
        changed = true;
    }

    return changed
        ? bridge.updateSettings({ customOpenAIPresets, ttsProviderSettings })
        : settings;
}
