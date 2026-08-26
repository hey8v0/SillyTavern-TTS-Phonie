function cleanErrorPayload(value) {
    if (!value) return '';
    if (typeof value === 'string') return value.slice(0, 400);
    return String(value.error?.message || value.message || JSON.stringify(value)).slice(0, 400);
}

export function normalizeOpenAIEndpoint(value) {
    const input = String(value || '').trim();
    if (!input) throw new Error('请输入自定义 OpenAI 接口地址');
    let url;
    try {
        url = new URL(input);
    } catch {
        throw new Error('接口地址格式不正确');
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('接口地址必须使用 HTTP 或 HTTPS');
    if (url.username || url.password) throw new Error('请不要把密钥写在接口地址中');
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
}

async function defaultHeaders() {
    const module = await import('/script.js');
    return typeof module.getRequestHeaders === 'function' ? module.getRequestHeaders() : {};
}

async function readResponse(response) {
    const data = await response.json().catch(async () => ({ message: await response.text().catch(() => '') }));
    if (!response.ok) throw new Error(cleanErrorPayload(data) || `请求失败（${response.status}）`);
    return data;
}

export async function saveCustomOpenAIKey(apiKey, {
    loadSecrets = () => import('/scripts/secrets.js'),
} = {}) {
    const value = String(apiKey || '').trim();
    if (!value) throw new Error('请输入 API 密钥');
    const secrets = await loadSecrets();
    if (!secrets?.writeSecret || !secrets?.SECRET_KEYS?.CUSTOM) throw new Error('当前酒馆版本不支持安全密钥存储');
    await secrets.writeSecret(secrets.SECRET_KEYS.CUSTOM, value, 'Phonie 自定义 OpenAI');
}

export async function fetchCustomOpenAIModels(endpoint, {
    fetchImpl = globalThis.fetch,
    getHeaders = defaultHeaders,
} = {}) {
    const response = await fetchImpl('/api/backends/chat-completions/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getHeaders()) },
        body: JSON.stringify({
            chat_completion_source: 'custom',
            custom_url: normalizeOpenAIEndpoint(endpoint),
            custom_include_headers: '',
        }),
    });
    const data = await readResponse(response);
    return [...new Set((Array.isArray(data?.data) ? data.data : [])
        .map((model) => String(model?.id || '').trim())
        .filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export async function requestCustomOpenAIGeneration({
    endpoint,
    model,
    messages,
    maxTokens = 8192,
    temperature = 0.8,
    jsonSchema,
}, {
    fetchImpl = globalThis.fetch,
    getHeaders = defaultHeaders,
} = {}) {
    const selectedModel = String(model || '').trim();
    if (!selectedModel) throw new Error('请先选择自定义模型');
    const response = await fetchImpl('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getHeaders()) },
        body: JSON.stringify({
            chat_completion_source: 'custom',
            custom_url: normalizeOpenAIEndpoint(endpoint),
            custom_include_headers: '',
            custom_include_body: '',
            custom_exclude_body: '',
            model: selectedModel,
            messages,
            max_tokens: Math.min(65536, Math.max(80, Math.round(Number(maxTokens) || 8192))),
            temperature: Math.min(2, Math.max(0, Number(temperature) || 0.8)),
            stream: false,
            json_schema: jsonSchema ? { name: 'phonie_phone_reply', strict: true, value: jsonSchema } : undefined,
        }),
    });
    return readResponse(response);
}
