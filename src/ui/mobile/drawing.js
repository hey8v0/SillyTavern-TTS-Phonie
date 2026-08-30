import { NOVELAI_MODELS, buildNovelAiRequest, novelAiParamsVersion } from './novelai.js';

export { NOVELAI_MODELS, buildNovelAiRequest, novelAiParamsVersion };

const FALLBACK_ENDPOINT = '/api/plugins/phonie-novelai-v5/generate';

async function responseError(response, label) {
    const detail = String(await response.text().catch(() => '')).trim().slice(0, 240);
    return new Error(`${label}（HTTP ${response.status}）${detail ? `：${detail}` : ''}`);
}

export async function requestNovelAiImage(values, { fetchImpl = fetch, headers = {} } = {}) {
    const request = buildNovelAiRequest(values);
    let response = await fetchImpl('/api/novelai/generate-image', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });
    if (response.ok) return response;

    const needsV5Fallback = request.params_version === 4 && [400, 404, 422, 500, 501].includes(response.status);
    if (!needsV5Fallback) throw await responseError(response, 'NovelAI 生成失败');

    response = await fetchImpl(FALLBACK_ENDPOINT, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });
    if (response.ok) return response;
    if (response.status === 404) {
        throw new Error('当前 SillyTavern 核心不支持 NovelAI V5。请把扩展内 server-plugins/phonie-novelai-v5 复制到酒馆 plugins 目录，开启 enableServerPlugins 后重启酒馆。');
    }
    throw await responseError(response, 'NovelAI V5 兼容服务失败');
}
