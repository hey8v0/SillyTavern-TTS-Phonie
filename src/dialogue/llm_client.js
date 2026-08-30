async function fetchModels(apiUrl, apiKey) {
    const baseUrl = String(apiUrl || '')
        .trim()
        .replace(/\/chat\/completions(?:[/?#].*)?$/, '')
        .replace(/\/+$/, '');
    const modelsUrl = `${baseUrl}/models`;

    const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${apiKey}`
        }
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    let models = [];
    if (data.data && Array.isArray(data.data)) {
        models = data.data.map(m => m.id || m.name || m);
    } else if (Array.isArray(data)) {
        models = data.map(m => typeof m === 'string' ? m : (m.id || m.name));
    }

    models = [...new Set(models.map(model => String(model || '').trim()).filter(Boolean))];

    if (models.length === 0) {
        throw new Error('未找到可用模型');
    }

    return models;
}

/**
 * 判断是否为网络错误（可重试）
 */
function isNetworkError(error) {
    const networkErrorPatterns = [
        'Failed to fetch',
        'NetworkError',
        'ERR_CONNECTION_RESET',
        'ERR_CONNECTION_REFUSED',
        'ERR_CONNECTION_TIMED_OUT',
        'ERR_NETWORK',
        'net::ERR_',
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND'
    ];

    const errorMessage = error.message || error.toString();
    return networkErrorPatterns.some(pattern => errorMessage.includes(pattern));
}

/**
 * 延迟函数
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function callLLM(config) {
    let llmUrl = config.api_url.trim();

    if (!llmUrl.includes('/chat/completions')) {
        llmUrl = llmUrl.replace(/\/$/, '') + '/chat/completions';
    }

    const messages = Array.isArray(config.messages) && config.messages.length
        ? config.messages
            .filter(message => message && ['system', 'user', 'assistant'].includes(message.role))
            .map(message => ({ role: message.role, content: String(message.content || '') }))
            .filter(message => message.content.trim())
        : [];
    if (!messages.length) {
        if (String(config.system_prompt || '').trim()) {
            messages.push({ role: 'system', content: String(config.system_prompt).trim() });
        }
        messages.push({ role: 'user', content: String(config.prompt || '') });
    }

    const requestBody = {
        model: config.model,
        messages,
        temperature: Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.8,
        stream: config.responseMode === 'stream' || config.streaming === true
    };

    if (config.max_tokens) {
        requestBody.max_tokens = config.max_tokens;
    }

    const MAX_RETRIES = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(llmUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.api_key}`
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                // ✅ 打印完整请求信息
                console.error('[LLM_Client] ❌ HTTP 错误');
                console.error('[LLM_Client] 请求 URL:', llmUrl);
                console.error('[LLM_Client] 请求模型:', config.model);
                console.error('[LLM_Client] 请求体 (不含 prompt):', JSON.stringify({
                    model: requestBody.model,
                    temperature: requestBody.temperature,
                    max_tokens: requestBody.max_tokens,
                    prompt_length: messages.reduce((total, message) => total + message.content.length, 0),
                    message_roles: messages.map(message => message.role),
                }));
                console.error('[LLM_Client] 响应状态:', response.status);
                console.error('[LLM_Client] 响应内容:', errorText);
                throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
            }

            return readOpenAICompatibleResponse(response, { streaming: requestBody.stream });

        } catch (error) {
            lastError = error;

            // ✅ 在错误时打印完整请求信息（首次或最后一次重试）
            if (attempt === 1 || attempt === MAX_RETRIES) {
                console.error('[LLM_Client] ❌ LLM 调用失败');
                console.error('[LLM_Client] 错误信息:', error.message);
                console.error('[LLM_Client] 请求 URL:', llmUrl);
                console.error('[LLM_Client] 请求模型:', config.model);
                console.error('[LLM_Client] 请求配置:', JSON.stringify({
                    temperature: requestBody.temperature,
                    max_tokens: requestBody.max_tokens,
                    prompt_length: messages.reduce((total, message) => total + message.content.length, 0),
                    message_roles: messages.map(message => message.role),
                }));
                if (error.rawResponse) {
                    console.error('[LLM_Client] 原始响应数据:', JSON.stringify(error.rawResponse, null, 2));
                }
            }

            // 只有网络错误才重试
            if (isNetworkError(error) && attempt < MAX_RETRIES) {
                console.warn(`[LLM_Client] ⚠️ 网络错误,第 ${attempt}/${MAX_RETRIES} 次重试... (${error.message})`);
                await delay(1000 * attempt);  // 递增延迟: 1s, 2s, 3s
                continue;
            }

            // 非网络错误或已用尽重试次数,直接抛出
            throw error;
        }
    }

    // 理论上不会到这里,但以防万一
    throw lastError;
}

function extractStreamText(data) {
    if (!data || typeof data !== 'object') return '';
    const value = data.choices?.[0]?.delta?.content
        ?? data.choices?.[0]?.message?.content
        ?? data.choices?.[0]?.text
        ?? data.delta?.text
        ?? data.output_text
        ?? (data.type === 'response.output_text.delta' ? data.delta : '');
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        return value.map(item => item?.text ?? item?.content ?? '').filter(Boolean).join('');
    }
    return '';
}

export async function readOpenAICompatibleResponse(response, { streaming = false } = {}) {
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (!streaming || !response.body || !contentType.includes('text/event-stream')) {
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            if (text.trim()) return text.trim();
            throw new Error('OpenAI 兼容接口返回了空响应');
        }
        return parseResponse(data);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let output = '';
    let done = false;

    const consumeEvent = block => {
        const lines = block.split(/\r?\n/u);
        const eventName = lines.find(line => line.startsWith('event:'))?.slice(6).trim() || '';
        const payload = lines
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart())
            .join('\n')
            .trim();
        if (!payload) return;
        if (payload === '[DONE]') {
            done = true;
            return;
        }
        let data;
        try {
            data = JSON.parse(payload);
        } catch (error) {
            throw new Error(`流式响应包含无效 JSON：${error.message}`);
        }
        if (eventName === 'error' || data.error) {
            const message = data.error?.message || data.message || 'OpenAI 兼容接口返回流式错误';
            throw new Error(message);
        }
        output += extractStreamText(data);
    };

    while (!done) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
        const blocks = buffer.split(/\r?\n\r?\n/u);
        buffer = blocks.pop() || '';
        blocks.forEach(consumeEvent);
        if (chunk.done) break;
    }
    if (buffer.trim() && !done) consumeEvent(buffer);
    if (!output) throw new Error('OpenAI 兼容接口的流式响应没有文本内容');
    return output;
}

function parseResponse(data) {
    // 添加详细的调试日志
    console.log('[LLM_Client] 🔍 开始解析LLM响应');
    console.log('[LLM_Client] 响应数据类型:', typeof data);
    console.log('[LLM_Client] 响应是否为对象:', data !== null && typeof data === 'object');

    if (data !== null && typeof data === 'object') {
        console.log('[LLM_Client] 响应对象的键:', Object.keys(data));
        console.log('[LLM_Client] 完整响应数据:', JSON.stringify(data, null, 2));
    } else {
        console.log('[LLM_Client] 响应数据 (非对象):', data);
    }

    const extractText = value => {
        if (typeof value === 'string') return value.trim();
        if (Array.isArray(value)) {
            return value.map(item => extractText(item?.content ?? item?.text ?? item)).filter(Boolean).join('\n');
        }
        if (!value || typeof value !== 'object') return '';
        if (typeof value.text === 'string') return value.text.trim();
        if (typeof value.text?.value === 'string') return value.text.value.trim();
        if (value.content !== undefined) return extractText(value.content);
        return '';
    };
    let content = null;
    const candidates = [
        ['data.choices[0].message.content', data.choices?.[0]?.message?.content],
        ['data.message.content', data.message?.content],
        ['data.choices[0].text', data.choices?.[0]?.text],
        ['data.output_text', data.output_text],
        ['data.content', data.content],
        ['data.output', data.output],
        ['data.response', data.response],
        ['data.result', data.result],
        ['data.choices[0].message.reasoning_content', data.choices?.[0]?.message?.reasoning_content],
    ];
    for (const [label, candidate] of candidates) {
        content = extractText(candidate);
        if (!content && candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
            content = JSON.stringify(candidate);
        }
        if (content) {
            console.log(`[LLM_Client] ✅ 使用 ${label}`);
            break;
        }
    }

    if (!content) {
        console.error('[LLM_Client] ❌ 无法从响应中提取内容');
        console.error('[LLM_Client] 已尝试的路径:');
        console.error('  - data.choices[0].message.content');
        console.error('  - data.message.content');
        console.error('  - data.choices[0].message.reasoning_content');
        console.error('  - data.choices[0].text');
        console.error('  - data.output_text');
        console.error('  - data.content');
        console.error('  - data.output');
        console.error('  - data.response');
        console.error('  - data.result');

        // 创建错误对象并附加原始响应数据
        const error = new Error('无法解析LLM响应 (响应格式不兼容)');
        error.rawResponse = data;  // 附加原始响应数据
        throw error;
    }

    console.log('[LLM_Client] ✅ 成功解析,内容长度:', content.length);
    return content;
}

export const LLM_Client = {
    fetchModels,
    callLLM,
    parseResponse,
    readOpenAICompatibleResponse,
};
