export const world_info_include_names = true;

export function getWorldInfoPrompt() {
    return Promise.resolve({ worldInfoBefore: '', worldInfoAfter: '', worldInfoDepth: [] });
}
