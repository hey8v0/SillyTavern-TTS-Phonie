function cleanName(value) {
    return String(value || '').trim();
}

/**
 * Build the public phone book. Voice routes, the currently selected card and
 * QQ history deliberately do not participate in this list.
 */
export function buildVoiceContacts({
    manualCharacters = [],
    bodySpeakers = [],
    hiddenCharacters = [],
    userName = '',
} = {}) {
    const hidden = new Set(hiddenCharacters.map(cleanName).filter(Boolean));
    const excludedUser = cleanName(userName);
    const contacts = new Map();

    const add = (value, source) => {
        const name = cleanName(value);
        if (!name || name === excludedUser || hidden.has(name)) return;
        const contact = contacts.get(name) || { name, sources: [] };
        if (!contact.sources.includes(source)) contact.sources.push(source);
        contacts.set(name, contact);
    };

    manualCharacters.forEach(name => add(name, 'manual'));
    bodySpeakers.forEach(name => add(name, 'body'));

    return [...contacts.values()].sort((left, right) => (
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    ));
}

export function validateCallParticipants(values, { min = 1, max = 6 } = {}) {
    const participants = [...new Set((values || []).map(cleanName).filter(Boolean))];
    if (participants.length < min) throw new Error(`至少选择 ${min} 位联系人`);
    if (participants.length > max) throw new Error(`最多选择 ${max} 位联系人`);
    return participants;
}

/**
 * Public Phonie calls currently accept exactly one contact. Keep this separate
 * from the generic participant helper because QQ groups and legacy data may
 * still contain more than one character.
 */
export function validateSingleCallParticipant(values) {
    const participants = validateCallParticipants(values);
    if (participants.length !== 1) throw new Error('公开版电话目前只能选择 1 位联系人');
    return participants[0];
}

export function renderContactsApp({ FrontendVoiceTools, state, safe, icon }) {
    const renderAvatar = contact => (contact.avatarUrl
        ? `<img src="${safe(contact.avatarUrl)}" alt="">`
        : `<span>${safe(contact.name.slice(0, 1) || '角')}</span>`);
    const tools = FrontendVoiceTools.getSnapshot();
    const contacts = tools.contacts || FrontendVoiceTools.getVoiceContacts?.() || [];
    return `
        <section class="voice-secondary-view voice-contacts-app" aria-labelledby="voice-contacts-heading">
            <h1 id="voice-contacts-heading">通讯录</h1>
            <section class="voice-contacts-summary" aria-label="角色资源概览">
                <div><strong>${contacts.length}</strong><small>联系人</small></div>
                <div><strong>${contacts.filter(item => item.configured).length}</strong><small>已配声线</small></div>
                <div><strong>${contacts.filter(item => item.favorite).length}</strong><small>绑定收藏</small></div>
            </section>
            <label class="voice-tool-search voice-contact-search" for="tts-contact-search">
                ${icon('search', 17)}<span>搜索联系人</span>
                <input id="tts-contact-search" type="search" autocomplete="off" aria-label="搜索联系人">
                <kbd id="tts-contact-count">${contacts.length}</kbd>
            </label>
            <div class="voice-contact-list" data-preserve-scroll="voice-contact-list">
                ${contacts.length ? contacts.map(contact => {
        const expanded = state.contactName === contact.name;
        const searchText = `${contact.name} ${contact.providerName} ${contact.voice} ${contact.favorite?.name || ''}`.toLocaleLowerCase('zh-CN');
        return `<article class="voice-contact-card${expanded ? ' is-expanded' : ''}" data-contact-item data-contact-search="${safe(searchText)}">
                        <button type="button" data-contact-toggle="${safe(contact.name)}" aria-expanded="${expanded}">
                            <span class="voice-contact-avatar">${renderAvatar(contact)}</span>
                            <span class="voice-contact-copy">
                                <strong>${safe(contact.name)}${contact.current ? '<i>当前</i>' : ''}</strong>
                                <small>${safe(contact.configured ? `${contact.providerName}${contact.voice ? ` · ${contact.voice}` : ''}` : '尚未配置声线')}</small>
                            </span>
                            <span class="voice-contact-state${contact.configured ? ' is-ready' : ''}" aria-label="${contact.configured ? '已配置声线' : '未配置声线'}"></span>
                            ${icon('chevronRight', 16)}
                        </button>
                        ${expanded ? `<div class="voice-contact-details">
                            <dl>
                                <div><dt>路由</dt><dd>${safe(contact.configured ? contact.providerName : '默认')}</dd></div>
                                <div><dt>收藏</dt><dd>${safe(contact.favorite?.name || '未绑定')}</dd></div>
                                <div><dt>消息</dt><dd>${contact.messageCount}</dd></div>
                            </dl>
                            ${contact.lastMessage ? `<p>${safe(contact.lastMessage)}</p>` : ''}
                            <div class="voice-contact-actions">
                                <button type="button" data-contact-open-chat="${safe(contact.name)}">${icon('messageCircle', 15)} 聊天</button>
                                <button type="button" data-contact-open-route="${safe(contact.name)}">${icon('sliders', 15)} 声线路由</button>
                                <button type="button" data-contact-open-favorites>${icon('bookmark', 15)} 声线收藏</button>
                            </div>
                        </div>` : ''}
                    </article>`;
    }).join('') : `<div class="voice-tool-empty voice-contact-empty">${icon('users', 25)}<strong>暂无联系人</strong></div>`}
                <p id="tts-contact-empty" hidden>没有符合条件的联系人。</p>
            </div>
        </section>`;
}
