export function flattenPromptMessages(messages = []) {
    return messages
        .filter((message) => message && typeof message === 'object')
        .map((message) => `[${message.role || 'user'}]\n${String(message.content || '')}`)
        .join('\n\n');
}

export function listConnectionProfiles(context) {
    const profiles = context?.extensionSettings?.connectionManager?.profiles;
    if (!Array.isArray(profiles)) return [];
    return profiles
        .filter((profile) => profile?.id != null)
        .map((profile) => ({
            id: String(profile.id),
            name: String(profile.name || profile.model || '未命名连接'),
            api: String(profile.api || ''),
            model: String(profile.model || '默认模型'),
        }));
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
    loadSharedModule = () => import('/scripts/extensions/shared.js'),
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
            maxTokens: settings.customOpenAIMaxTokens,
            temperature: settings.customOpenAITemperature,
            jsonSchema,
        });
    }

    if ((settings.generationMode === 'profile' || (!settings.generationMode && settings.generationProfileId)) && settings.generationProfileId) {
        const shared = await loadSharedModule();
        const service = shared?.ConnectionManagerRequestService;
        if (!service?.constructPrompt || !service?.sendRequest) {
            throw new Error('当前 SillyTavern 不支持 Connection Manager 请求服务');
        }
        const preparedPrompt = service.constructPrompt(prompt, settings.generationProfileId);
        const response = await service.sendRequest(
            settings.generationProfileId,
            preparedPrompt,
            settings.phoneResponseLength,
            { stream: false, extractData: true, includePreset: true, includeInstruct: true },
            { json_schema: jsonSchema },
        );
        return response?.content ?? response ?? '';
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
