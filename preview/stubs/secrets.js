export const SECRET_KEYS = {
    OPENAI: 'api_key_openai',
    NOVEL: 'api_key_novel',
    ELEVENLABS: 'api_key_elevenlabs',
    MINIMAX: 'api_key_minimax',
};

export const secret_state = {};

export function writeSecret() { return Promise.resolve(true); }
export function readSecret() { return ''; }
export function revealSecret() { return Promise.resolve(''); }
export function deleteSecret() { return Promise.resolve(true); }
