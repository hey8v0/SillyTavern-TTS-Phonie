export const extension_settings = {};

export function getContext() {
    return {
        name1: '我',
        name2: '示例角色',
        characterId: 0,
        characters: [{ name: '示例角色', avatar: '' }],
        chat: [],
        chatMetadata: {},
        saveMetadataDebounced() {},
        getCharacterCardFields() {
            return { description: '', personality: '', scenario: '', mesExamples: '' };
        },
        getWorldInfoPrompt() {
            return Promise.resolve({ worldInfoBefore: '', worldInfoAfter: '', worldInfoDepth: [] });
        },
    };
}
