function cleanId(value) {
    return String(value || '').trim();
}

function friendKey(friend) {
    return cleanId(friend?.id || friend?.name || friend);
}

export function batchDeleteMessages(messages = [], selectedIds = []) {
    const deleted = new Set(selectedIds.map(cleanId).filter(Boolean));
    return messages
        .filter(message => !deleted.has(cleanId(message?.id)))
        .map(message => {
            if (!deleted.has(cleanId(message?.replyToId))) return { ...message };
            return {
                ...message,
                replyToId: '',
                replyPreview: '原消息已删除',
            };
        });
}

/** Removing QQ friends never removes contacts, routes or private history. */
export function removeQqFriends({ friends = [], groups = [] } = {}, selectedIds = []) {
    const removed = new Set(selectedIds.map(cleanId).filter(Boolean));
    const nextFriends = friends.filter(friend => !removed.has(friendKey(friend)));
    const nextGroups = [];
    const dissolvedGroupIds = [];

    for (const group of groups) {
        const members = (group?.members || []).filter(member => !removed.has(friendKey(member)));
        if (members.length < 2) {
            dissolvedGroupIds.push(cleanId(group?.id));
            continue;
        }
        nextGroups.push({ ...group, members });
    }

    return { friends: nextFriends, groups: nextGroups, dissolvedGroupIds };
}

export function normalizeQqThreads({ friends = [], groups = [], threads = [] } = {}) {
    const byId = new Map((threads || []).map(thread => [cleanId(thread.id), { ...thread }]));
    for (const friend of friends) {
        const id = `friend:${friendKey(friend)}`;
        byId.set(id, { ...byId.get(id), id, kind: 'private', participant: friendKey(friend) });
    }
    for (const group of groups) {
        const groupId = cleanId(group?.id);
        const id = `group:${groupId}`;
        byId.set(id, { ...byId.get(id), ...group, id, groupId, kind: 'group' });
    }
    return [...byId.values()];
}
