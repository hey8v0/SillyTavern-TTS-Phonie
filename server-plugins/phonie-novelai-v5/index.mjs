import fetch from 'node-fetch';
import { readSecret, SECRET_KEYS } from '../../src/endpoints/secrets.js';
import { extractFileFromZipBuffer } from '../../src/util.js';

export const info = {
    id: 'phonie-novelai-v5',
    name: 'Phonie NovelAI V5 兼容服务',
    description: '为尚未支持 params_version 4 的 SillyTavern 提供 NovelAI V5 安全代理。',
};

const MODELS = new Set(['nai-diffusion-5-full', 'nai-diffusion-5-curated']);

function number(value, fallback, min, max) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export async function init(router) {
    router.post('/generate', async (request, response) => {
        const token = readSecret(request.user.directories, SECRET_KEYS.NOVEL);
        if (!token) return response.status(400).json({ error: '请先在 SillyTavern 密钥保险箱保存 NovelAI Token。' });

        const body = request.body || {};
        const model = String(body.model || '');
        if (!MODELS.has(model)) return response.status(400).json({ error: '兼容服务只接受 NovelAI V5 Full / Curated。' });
        const prompt = String(body.prompt || '').trim();
        if (!prompt) return response.status(400).json({ error: '正面提示词不能为空。' });

        try {
            const result = await fetch('https://image.novelai.net/ai/generate-image', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: 'generate',
                    input: prompt,
                    model,
                    parameters: {
                        params_version: 4,
                        prefer_brownian: true,
                        negative_prompt: String(body.negative_prompt || ''),
                        height: number(body.height, 1216, 64, 1536),
                        width: number(body.width, 832, 64, 1536),
                        scale: number(body.scale, 5, 0, 20),
                        cfg_rescale: number(body.cfg_rescale, 0, 0, 1),
                        seed: Number(body.seed) >= 0 ? Number(body.seed) : Math.floor(Math.random() * 9999999999),
                        sampler: String(body.sampler || 'k_euler'),
                        noise_schedule: String(body.scheduler || 'native'),
                        steps: Math.round(number(body.steps, 28, 1, 28)),
                        n_samples: 1,
                        ucPreset: 0,
                        qualityToggle: false,
                        add_original_image: false,
                        dynamic_thresholding: Boolean(body.decrisper),
                        legacy: false,
                        legacy_v3_extend: false,
                        characterPrompts: [],
                        reference_image_multiple: [],
                        reference_information_extracted_multiple: [],
                        reference_strength_multiple: [],
                        v4_negative_prompt: { caption: { base_caption: String(body.negative_prompt || ''), char_captions: [] } },
                        v4_prompt: { caption: { base_caption: prompt, char_captions: [] }, use_coords: false, use_order: true },
                    },
                }),
            });
            if (!result.ok) {
                const detail = String(await result.text().catch(() => '')).slice(0, 300);
                return response.status(result.status).json({ error: detail || `NovelAI HTTP ${result.status}` });
            }
            const png = await extractFileFromZipBuffer(await result.arrayBuffer(), '.png');
            if (!png) return response.status(502).json({ error: 'NovelAI 返回的压缩包中没有 PNG。' });
            return response.type('text/plain').send(png.toString('base64'));
        } catch (error) {
            return response.status(502).json({ error: error?.message || 'NovelAI V5 请求失败。' });
        }
    });
}
