import { resolveSticker } from './stickers.js';
import { buildQqMemberCandidates } from './qq-data.js';

/**
 * Render the QQ surface. Runtime services and small shared formatters are
 * injected so this module stays independent from the phone shell.
 */
export function renderQqApp({
    FrontendVoiceTools,
    TTS_ProviderRegistry,
    state,
    safe,
    icon,
    formatToolTime,
    chatMessagePreview,
    renderCallerAvatar,
}) {
    const qqFriendAvatar = friend => `<span class="voice-qq-avatar" aria-hidden="true">${safe(String(friend?.name || '友').slice(0, 1))}</span>`;
    const renderGroupMessage = (message, group, selectedMessages) => {
        const quoted = message.replyToId ? group.messages.find(item => item.id === message.replyToId) : null;
        const missingQuote = !quoted && (message.replyPreview || message.replyToId);
        const speaker = message.sender === 'user' ? (group.userName || '我') : (message.speaker || '群成员');
        const selected = selectedMessages.has(message.id);
        const sticker = message.type === 'sticker'
            ? resolveSticker(TTS_ProviderRegistry.getQqState().stickers, message)
            : null;
        const stickerUrl = sticker?.url || message.stickerUrl || '';
        const content = message.type === 'sticker'
            ? (stickerUrl
                ? `<img class="voice-qq-group-sticker" src="${safe(stickerUrl)}" alt="表情包" data-chat-sticker-image data-chat-sticker-id="${safe(sticker?.id || message.stickerId || '')}">`
                : '<span class="voice-chat-sticker-error">图片加载失败</span>')
            : message.type === 'image'
                ? `<span class="voice-qq-group-kind">图片</span><p>${safe(message.description || message.content || '未填写描述')}</p>`
                : message.type === 'transfer'
                    ? `<span class="voice-qq-group-kind">转账</span><p>${safe(message.amount || '0')} 元${message.note ? ` · ${safe(message.note)}` : ''}</p>`
                    : message.type === 'recalled'
                        ? '<p class="voice-qq-group-recalled">消息已撤回</p>'
                        : `<p>${safe(message.translation || message.content || '')}</p>`;
        return `<li class="voice-qq-group-message ${message.sender === 'user' ? 'is-user' : 'is-character'} ${selected ? 'is-selected' : ''}">
            ${state.groupSelectionMode ? `<label class="voice-chat-select" title="选择消息"><input type="checkbox" data-group-select-message="${safe(message.id)}" ${selected ? 'checked' : ''}><i></i></label>` : ''}
            <article>
                <header><strong>${safe(speaker)}</strong><time>${safe(formatToolTime(message.createdAt))}</time></header>
                ${quoted ? `<blockquote>${safe(chatMessagePreview(quoted))}</blockquote>` : missingQuote ? '<blockquote class="is-missing">原消息已删除</blockquote>' : ''}
                <div class="voice-qq-group-bubble">${content}</div>
            </article>
        </li>`;
    };

    const tools = FrontendVoiceTools.getSnapshot();
    const context = tools.context;
    const contacts = tools.contacts || FrontendVoiceTools.getVoiceContacts?.() || [];
    const qq = TTS_ProviderRegistry.getQqState();
    const friends = Array.isArray(qq.friends) ? qq.friends : [];
    const groups = (tools.groupChat?.groups || []).map(group => ({
        ...group,
        members: Array.isArray(group.memberNames) ? group.memberNames : [],
    }));
    const threadMessages = tools.phoneChat?.thread?.messages || [];
    const currentName = context.charName || '当前角色';
    const lastPreview = threadMessages.length ? chatMessagePreview(threadMessages[threadMessages.length - 1]) : '暂无消息';
    const addable = contacts.filter(contact => contact.name && contact.name !== currentName
        && !friends.some(friend => friend.name === contact.name)).slice(0, 40);
    const openGroup = state.qqOpenGroup ? groups.find(group => group.id === state.qqOpenGroup) : null;
    const draft = state.qqGroupDraft || { name: '', members: [] };
    const hiddenCurrent = TTS_ProviderRegistry.getUiSettings().hiddenCurrentCharName === currentName;
    const memberCandidates = buildQqMemberCandidates({ currentName, friends, hiddenCurrent });
    const selectedFriends = new Set(state.qqSelectedFriends || []);
    const manageableFriends = buildQqMemberCandidates({ currentName, friends, hiddenCurrent });
    const allFriendsSelected = manageableFriends.length > 0
        && manageableFriends.every(friend => selectedFriends.has(friend.name));
    const selectedGroupMessages = new Set(state.groupSelectedMessages || []);
    const groupMessages = Array.isArray(openGroup?.messages) ? openGroup.messages : [];
    const allGroupMessagesSelected = groupMessages.length > 0 && groupMessages.every(message => selectedGroupMessages.has(message.id));
    return `
        <section class="voice-secondary-view voice-qq-app" aria-labelledby="voice-qq-heading">
            <h1 id="voice-qq-heading">QQ</h1>
            <section class="voice-qq-recent" aria-label="最近会话">
                <button type="button" data-route="chat">
                    ${renderCallerAvatar(context)}
                    <span class="voice-qq-copy"><strong>${safe(currentName)}</strong><small>${safe(lastPreview)}</small></span>
                    ${icon('chevronRight', 16)}
                </button>
            </section>
            <section class="voice-qq-section" aria-label="好友">
                <header><strong>好友</strong><span>${friends.length + 1} 位</span><div class="voice-qq-header-actions"><button type="button" data-qq-toggle-friend-select aria-pressed="${state.qqFriendSelectionMode}">${icon('check', 15)} ${state.qqFriendSelectionMode ? '完成' : '管理'}</button><button type="button" data-qq-add-friend aria-pressed="${state.qqAddFriendOpen}">${icon('plus', 15)} 添加好友</button></div></header>
                ${state.qqFriendSelectionMode ? `<div class="voice-qq-bulk-toolbar"><label><input type="checkbox" data-qq-select-all-friends ${allFriendsSelected ? 'checked' : ''}> 全选</label><span>已选 ${selectedFriends.size}/${manageableFriends.length}</span><button type="button" data-qq-delete-friends ${selectedFriends.size ? '' : 'disabled'}>${icon('trash', 14)} 删除</button></div>` : ''}
                <div class="voice-qq-list">
                    ${hiddenCurrent ? `
                    <div class="voice-qq-row is-current is-hidden">
                        ${qqFriendAvatar({ name: currentName })}
                        <span class="voice-qq-copy"><strong>${safe(currentName)}</strong><small>已删除 · 切换角色卡或新开聊天后自动恢复</small></span>
                        <button type="button" data-qq-restore-current>${icon('undo', 14)} 恢复</button>
                    </div>` : `
                    <div class="voice-qq-row is-current ${selectedFriends.has(currentName) ? 'is-selected' : ''}">
                        ${state.qqFriendSelectionMode ? `<label class="voice-qq-select"><input type="checkbox" data-qq-select-current data-qq-select-friend="${safe(currentName)}" ${selectedFriends.has(currentName) ? 'checked' : ''}><i></i></label>` : ''}
                        <button type="button" class="voice-qq-open" data-route="chat" ${state.qqFriendSelectionMode ? 'disabled' : ''}>
                            ${qqFriendAvatar({ name: currentName })}
                            <span class="voice-qq-copy"><strong>${safe(currentName)}</strong><small>当前角色卡 · 私聊</small></span>
                            <i>当前</i>
                        </button>
                    </div>`}
                    ${friends.map(friend => `<div class="voice-qq-row ${selectedFriends.has(friend.name) ? 'is-selected' : ''}">
                        ${state.qqFriendSelectionMode ? `<label class="voice-qq-select"><input type="checkbox" data-qq-select-friend="${safe(friend.name)}" ${selectedFriends.has(friend.name) ? 'checked' : ''}><i></i></label>` : ''}
                        <button type="button" class="voice-qq-open" data-qq-open-friend="${safe(friend.name)}" ${state.qqFriendSelectionMode ? 'disabled' : ''}>
                            ${qqFriendAvatar(friend)}
                            <span class="voice-qq-copy"><strong>${safe(friend.name)}</strong><small>${friend.addedAt ? `添加于 ${formatToolTime(friend.addedAt)}` : '好友'}</small></span>
                            ${icon('chevronRight', 15)}
                        </button>
                    </div>`).join('')}
                </div>
                ${state.qqAddFriendOpen ? `
                <div class="voice-qq-picker" data-qq-friend-picker>
                    <header><span>从通讯录选择好友</span><button type="button" data-qq-close-picker aria-label="关闭">${icon('close', 15)}</button></header>
                    <div class="voice-qq-list">
                        ${addable.length ? addable.map(contact => `<button type="button" class="voice-qq-row" data-qq-pick-friend="${safe(contact.name)}">
                            ${qqFriendAvatar(contact)}
                            <span class="voice-qq-copy"><strong>${safe(contact.name)}</strong><small>${contact.configured ? `${safe(contact.providerName)} · 已配声线` : '通讯录联系人'}</small></span>
                            ${icon('plus', 15)}
                        </button>`).join('') : '<p class="voice-qq-picker-empty">没有可添加的联系人。</p>'}
                    </div>
                </div>` : ''}
            </section>
            <section class="voice-qq-section" aria-label="群聊">
                <header><strong>群聊</strong><span>${groups.length} 个</span><button type="button" data-qq-create-group aria-pressed="${state.qqGroupFormOpen}">${icon('plus', 15)} 创建群聊</button></header>
                <div class="voice-qq-list">
                    ${groups.length ? groups.map(group => `<button type="button" class="voice-qq-row" data-qq-open-group="${safe(group.id)}">
                        <span class="voice-qq-avatar is-group" aria-hidden="true">${icon('users', 16)}</span>
                        <span class="voice-qq-copy"><strong>${safe(group.name)}</strong><small>${group.members.length} 名成员</small></span>
                        ${icon('chevronRight', 15)}
                    </button>`).join('') : '<p class="voice-qq-list-empty">还没有群聊，点右上角创建。</p>'}
                </div>
                ${state.qqGroupFormOpen ? `
                <form class="voice-qq-picker" data-qq-group-form>
                    <header><span>创建群聊</span><button type="button" data-qq-close-picker aria-label="关闭">${icon('close', 15)}</button></header>
                    <label class="voice-qq-group-name"><span>群名称</span><input name="groupName" type="text" maxlength="40" value="${safe(draft.name)}" placeholder="例如：深夜电台群"></label>
                    <div class="voice-qq-list">
                        ${memberCandidates.length ? memberCandidates.map(friend => `<label class="voice-qq-row">
                            ${qqFriendAvatar(friend)}
                            <span class="voice-qq-copy"><strong>${safe(friend.name)}</strong><small>${friend.current ? '当前角色卡' : '好友'}</small></span>
                            <input type="checkbox" name="member" value="${safe(friend.name)}" ${draft.members.includes(friend.name) ? 'checked' : ''}><i></i>
                        </label>`).join('') : '<p class="voice-qq-picker-empty">先添加好友，才能创建群聊。</p>'}
                    </div>
                    <button class="voice-button primary wide" type="submit">${icon('check', 16)} 创建群聊</button>
                </form>` : ''}
            </section>
            ${openGroup ? `
            <section class="voice-qq-group-detail" aria-label="${safe(openGroup.name)}">
                <header>
                    <button type="button" data-qq-close-group aria-label="返回群聊列表">${icon('arrowLeft', 16)}</button>
                    <strong>${safe(openGroup.name)}</strong>
                    <button type="button" data-toggle-group-selection aria-pressed="${state.groupSelectionMode}" aria-label="${state.groupSelectionMode ? '退出消息多选' : '多选群消息'}">${icon(state.groupSelectionMode ? 'close' : 'check', 15)}</button>
                </header>
                <p class="voice-qq-group-summary">${openGroup.members.length} 名成员 · ${groupMessages.length} 条消息</p>
                ${state.groupSelectionMode ? `<div class="voice-chat-bulk-toolbar">
                    <label><input type="checkbox" data-group-select-all ${allGroupMessagesSelected ? 'checked' : ''}> 全选</label>
                    <span>已选 ${selectedGroupMessages.size} 条</span>
                    <button type="button" data-group-delete-selected ${selectedGroupMessages.size ? '' : 'disabled'}>${icon('trash', 14)} 删除</button>
                </div>` : ''}
                <ol class="voice-qq-group-thread" data-preserve-scroll="qq-group-thread">
                    ${groupMessages.length ? groupMessages.map(message => renderGroupMessage(message, openGroup, selectedGroupMessages)).join('') : '<li class="voice-qq-group-empty">还没有消息，先在下面说句话吧。</li>'}
                </ol>
                <form class="voice-qq-group-composer" data-qq-group-message-form>
                    <input name="message" type="text" maxlength="12000" placeholder="发送群消息" autocomplete="off">
                    <button type="submit" aria-label="发送">${icon('send', 16)}</button>
                    <button type="button" data-qq-group-reply ${state.featureBusy ? 'disabled' : ''}>${state.featureBusy === 'group-chat-reply' ? '回复中…' : '角色回复'}</button>
                </form>
                <details class="voice-qq-group-members">
                    <summary>${openGroup.members.length} 名群成员</summary>
                    <div class="voice-qq-list">
                        <button type="button" class="voice-qq-row is-current" data-route="chat">
                            ${qqFriendAvatar({ name: currentName })}
                            <span class="voice-qq-copy"><strong>${safe(currentName)}</strong><small>群主</small></span><i>当前</i>
                        </button>
                        ${openGroup.members.map(name => `<button type="button" class="voice-qq-row" data-qq-open-friend="${safe(name)}">
                            ${qqFriendAvatar({ name })}
                            <span class="voice-qq-copy"><strong>${safe(name)}</strong><small>群成员</small></span>
                            ${icon('messageCircle', 15)}
                        </button>`).join('')}
                    </div>
                </details>
            </section>` : ''}
        </section>`;
}
