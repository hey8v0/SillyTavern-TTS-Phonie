export const NOVELAI_MODELS = Object.freeze([
    { id: 'nai-diffusion-5-full', label: 'NAI Diffusion V5 Full', paramsVersion: 4 },
    { id: 'nai-diffusion-5-curated', label: 'NAI Diffusion V5 Curated', paramsVersion: 4 },
    { id: 'nai-diffusion-4-5-full', label: 'NAI Diffusion V4.5 Full', paramsVersion: 3 },
    { id: 'nai-diffusion-4-5-curated', label: 'NAI Diffusion V4.5 Curated', paramsVersion: 3 },
    { id: 'nai-diffusion-4-full', label: 'NAI Diffusion V4 Full', paramsVersion: 3 },
    { id: 'nai-diffusion-4-curated-preview', label: 'NAI Diffusion V4 Curated', paramsVersion: 3 },
    { id: 'nai-diffusion-3', label: 'NAI Diffusion V3', paramsVersion: 3 },
]);

export function novelAiParamsVersion(model) {
    return NOVELAI_MODELS.find(item => item.id === model)?.paramsVersion || 3;
}

export function buildNovelAiRequest(values = {}) {
    const model = String(values.model || 'nai-diffusion-4-5-full');
    return {
        ...values,
        model,
        params_version: novelAiParamsVersion(model),
    };
}
