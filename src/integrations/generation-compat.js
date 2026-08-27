export function flattenPromptMessages(messages = []) {
    return messages
        .filter((message) => message && typeof message === 'object')
        .map((message) => `[${message.role || 'user'}]\n${String(message.content || '')}`)
        .join('\n\n');
}

export function getCurrentGenerationTarget(context) {
    return {
        id: '',
        name: '跟随酒馆',
        api: String(context?.mainApi || context?.main_api || 'current'),
        model: String(context?.onlineStatus || context?.online_status || context?.model || '当前模型'),
    };
}

export async function requestPhoneGeneration({
    settings,
    prompt,
    jsonSchema,
    generateQuietPrompt,
    loadScriptModule = () => import('/script.js'),
    requestCustomGeneration = async (options) => {
        const module = await import('./openai-compatible.js');
        return module.requestCustomOpenAIGeneration(options);
    },
}) {
    if (settings.generationMode === 'custom') {
        return requestCustomGeneration({
            endpoint: settings.customOpenAIEndpoint,
            model: settings.customOpenAIModel,
            messages: prompt,
            maxTokens: Math.min(settings.customOpenAIMaxTokens, settings.phoneResponseLength),
            temperature: settings.customOpenAITemperature,
            jsonSchema,
        });
    }

    let scriptModule = {};
    try {
        scriptModule = await loadScriptModule();
    } catch {
        scriptModule = {};
    }
    if (typeof scriptModule.generateRaw === 'function') {
        return scriptModule.generateRaw({
            prompt,
            responseLength: settings.phoneResponseLength,
            jsonSchema,
            trimNames: false,
        });
    }

    if (typeof generateQuietPrompt !== 'function') {
        throw new Error('当前 SillyTavern 没有可用的静默生成接口');
    }
    return generateQuietPrompt({
        quietPrompt: flattenPromptMessages(prompt),
        jsonSchema,
        responseLength: settings.phoneResponseLength,
        trimToSentence: false,
    });
}
