function cleanName(value) {
    return String(value || '').trim();
}

function normalizedName(value) {
    return cleanName(value).normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ');
}

function speakerId(name) {
    return 'speaker:' + encodeURIComponent(cleanName(name).toLocaleLowerCase('zh-CN'));
}

function cardId(character, index) {
    const source = character?.avatar || character?.id || character?.chid || character?.name || index;
    return 'card:' + encodeURIComponent(String(source));
}

function routeFor(routes, identity) {
    const source = routes && typeof routes === 'object' ? routes : {};
    if (identity?.id && source[identity.id]) return source[identity.id];
    if (identity?.name && source[identity.name]) return source[identity.name];
    return Object.values(source).find((route) => (
        route
        && ((identity?.id && route.characterId === identity.id)
            || (identity?.name && route.characterName === identity.name))
    )) || {};
}

export function resolveCharacterRoute(routes, identity) {
    return { ...routeFor(routes, typeof identity === 'string' ? { name: identity } : identity) };
}

export function buildCharacterDirectory({
    currentContact = null,
    characters = [],
    routes = {},
    messages = [],
    speakersOnly = false,
} = {}) {
    const directory = new Map();
    const nameIndex = new Map();

    const add = (entry) => {
        const name = cleanName(entry?.name);
        if (!name) return;
        let id = cleanName(entry?.id) || speakerId(name);
        const nameKey = normalizedName(name);
        const knownIds = nameIndex.get(nameKey) || [];
        if (knownIds.length) id = knownIds[0];
        const previous = directory.get(id) || {};
        directory.set(id, {
            id,
            name: previous.name || name,
            avatarUrl: entry?.avatarUrl || previous.avatarUrl || '',
            source: previous.source === 'current' ? 'current' : (entry?.source || previous.source || 'dialogue'),
            current: Boolean(previous.current || entry?.current),
            spoken: Boolean(previous.spoken || entry?.spoken),
        });
        if (!knownIds.includes(id)) nameIndex.set(nameKey, [...knownIds, id]);
    };

    if (!speakersOnly && currentContact?.name) add({ ...currentContact, current: true, source: 'current' });

    const cardList = Array.isArray(characters) ? characters : Object.values(characters || {});
    if (!speakersOnly) cardList.forEach((character, index) => {
        const name = cleanName(character?.name);
        if (!name) return;
        add({
            id: cardId(character, index),
            name,
            avatarUrl: character?.avatar ? '/characters/' + encodeURIComponent(character.avatar) : '',
            source: 'card',
        });
    });

    for (const message of Array.isArray(messages) ? messages : []) {
        for (const segment of message?.extra?.phonie?.bodySpeech || []) {
            if (segment?.speaker) add({ name: segment.speaker, source: 'dialogue', spoken: true });
        }
    }

    for (const [key, route] of Object.entries(routes || {})) {
        const name = cleanName(route?.characterName || (key.startsWith('card:') || key.startsWith('speaker:') ? '' : key));
        if (!name) continue;
        add({
            id: cleanName(route?.characterId) || cleanName(key) || speakerId(name),
            name,
            source: 'route',
        });
    }

    return [...directory.values()]
        .map((entry) => ({ ...entry, route: resolveCharacterRoute(routes, entry) }))
        .sort((left, right) => (
            Number(right.current) - Number(left.current)
            || Number(Boolean(Object.keys(right.route).length)) - Number(Boolean(Object.keys(left.route).length))
            || Number(right.spoken) - Number(left.spoken)
            || left.name.localeCompare(right.name, 'zh-CN')
        ));
}
