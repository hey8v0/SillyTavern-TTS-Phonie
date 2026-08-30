import { validateCallParticipants } from './contacts.js';

export function readSelectedParticipants(form) {
    return validateCallParticipants(
        [...(form?.querySelectorAll('input[name="participants"]:checked') || [])]
            .map(input => String(input.value || '').trim()),
    );
}

function virtualNumber(name) {
    let hash = 0;
    const value = String(name || '');
    for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    const digits = String(Math.abs(hash)).padStart(10, '0').slice(0, 10);
    return `+00 ${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
}

export function renderIncomingPanel({ FrontendVoiceTools, state, safe, icon, renderCallerAvatar, formatCallDuration }) {
    const renderSetup = (tools, context) => {
        const busy = ['phone-plan', 'phone-regenerate'].includes(state.featureBusy);
        const voiceCharacters = FrontendVoiceTools.getAvailableVoiceCharacters();
        const contacts = FrontendVoiceTools.getVoiceContacts?.() || [];
        const sourceIsTopic = state.phoneContentSource === 'topic';
        const selectedParticipants = state.phoneParticipants.length
            ? state.phoneParticipants
            : (state.phoneCaller && state.phoneCaller !== 'auto' ? [state.phoneCaller] : [context.charName].filter(Boolean));
        const participantCount = selectedParticipants.length;
        const isGroup = participantCount > 1;
        return `
            <section class="voice-secondary-view voice-tool-view" aria-labelledby="voice-incoming-heading">
                <div class="voice-kicker">${icon('phone', 15)} 拨号通话</div>
                <h1 id="voice-incoming-heading">电话</h1>
                <div class="voice-context-chip ${context.available ? 'is-ready' : ''}">
                    <span>${context.available ? renderCallerAvatar(context, 'voice-context-avatar') : icon('info', 18)}</span>
                    <div><strong>${context.available ? safe(context.charName) : '未打开角色对话'}</strong><small>读取 ${context.includedFloorCount}/${context.floorCount} 层 · ${safe(FrontendVoiceTools.plannerLabel())}</small></div>
                </div>
                <section class="voice-dial-section" aria-label="拨号盘">
                    <div class="voice-dial-display">
                        <input id="tts-dial-input" type="tel" inputmode="tel" value="${safe(state.dialInput)}" placeholder="输入或点击号码" aria-label="拨号号码" autocomplete="off">
                        <button type="button" data-dial-key="back" aria-label="退格删除">${icon('undo', 17)}</button>
                    </div>
                    <div class="voice-dial-pad">
                        ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map(key => `<button type="button" data-dial-key="${key}">${key}</button>`).join('')}
                    </div>
                    <button class="voice-dial-call-button" type="button" data-dial-call ${busy ? 'disabled' : ''}>${icon(busy ? 'activity' : 'phone', 18)}${busy ? '正在规划' : '拨出'}</button>
                    ${contacts.length ? `<details class="voice-dial-contacts">
                        <summary>${icon('users', 15)} 通讯录号码 · ${contacts.length} 位</summary>
                        <div>${contacts.map(contact => `<button type="button" data-dial-fill="${safe(contact.name)}">
                            <span><strong>${safe(contact.name)}</strong><small>${contact.configured ? `${safe(contact.providerName)} · 已配声线` : '未配声线'}</small></span>
                            <em>${safe(virtualNumber(contact.name))}</em>
                        </button>`).join('')}</div>
                    </details>` : ''}
                </section>
                <form id="tts-phone-plan-form" class="voice-tool-form" data-phone-plan-form>
                    <fieldset class="voice-speaker-picker">
                        <legend>${isGroup ? `多人通话 · 已选 ${participantCount} 位` : '参与角色'}</legend>
                        ${voiceCharacters.length ? voiceCharacters.map(item => `
                            <label>
                                <input type="checkbox" name="participants" value="${safe(item.name)}" ${selectedParticipants.includes(item.name) ? 'checked' : ''}>
                                <span>${safe(item.name)}<small>${safe(item.providerName)}</small></span>
                            </label>`).join('') : '<small>还没有角色声线路由。</small>'}
                    </fieldset>
                    <label for="tts-phone-source">通话内容</label>
                    <select id="tts-phone-source" name="source">
                        <option value="context" ${state.phoneContentSource === 'context' ? 'selected' : ''}>延续当前酒馆上下文</option>
                        <option value="topic" ${state.phoneContentSource === 'topic' ? 'selected' : ''}>自定义主题</option>
                    </select>
                    <label for="tts-phone-brief" data-phone-topic-label ${sourceIsTopic ? '' : 'hidden'}>这通电话想谈什么</label>
                    <textarea id="tts-phone-brief" name="brief" rows="3" ${sourceIsTopic ? '' : 'hidden'}>${safe(state.phoneBrief)}</textarea>
                    ${isGroup ? '' : `
                    <label for="tts-phone-duration">长度</label>
                    <select id="tts-phone-duration" name="duration">
                        <option value="short" ${state.phoneLength === 'short' ? 'selected' : ''}>短 · 4–6 句</option>
                        <option value="medium" ${state.phoneLength === 'medium' ? 'selected' : ''}>普通 · 7–10 句</option>
                        <option value="long" ${state.phoneLength === 'long' ? 'selected' : ''}>长 · 12–18 句</option>
                    </select>`}
                </form>
            </section>`;
    };
    const renderRinging = (context, plan) => {
        const outgoing = state.phoneDirection === 'outgoing';
        return `
            <section class="voice-call-stage voice-call-ringing" aria-labelledby="tts-ringing-caller" aria-live="assertive">
                <div class="voice-call-topline"><span>语音通话</span><i></i><span>${outgoing ? '呼叫' : '来电'}</span></div>
                <div class="voice-call-caller">
                    <div class="voice-call-avatar-ring">${renderCallerAvatar(context, 'voice-call-avatar')}</div>
                    <small>${outgoing ? '正在呼叫角色' : '角色来电'}</small>
                    <h1 id="tts-ringing-caller">${safe(context.charName)}</h1>
                    <p>${safe(plan.reason || plan.title)}</p>
                </div>
                <div class="voice-call-actions" aria-label="${outgoing ? '呼叫操作' : '来电操作'}">
                    ${outgoing ? `<button class="is-decline is-solo" type="button" data-decline-call aria-label="取消呼叫">${icon('close', 27)}<span>取消</span></button>`
        : `<button class="is-decline" type="button" data-decline-call aria-label="拒绝来电">${icon('close', 27)}<span>拒绝</span></button>
                    <button class="is-answer" type="button" data-answer-call aria-label="接听来电">${icon('phone', 27)}<span>接听</span></button>`}
                </div>
            </section>`;
    };
    const renderConnecting = context => `
        <section class="voice-call-stage voice-call-connecting" aria-labelledby="tts-connecting-title" aria-live="polite">
            <div class="voice-call-caller">
                <div class="voice-call-avatar-ring">${renderCallerAvatar(context, 'voice-call-avatar')}</div>
                <small>正在接通角色声线</small>
                <h1 id="tts-connecting-title">${safe(context.charName)}</h1>
                <div class="voice-call-connect-wave" aria-hidden="true">${Array.from({ length: 9 }, (_, index) => `<i style="--bar:${index}"></i>`).join('')}</div>
            </div>
            <button class="voice-call-hangup" type="button" data-hangup-call aria-label="取消接听">${icon('close', 26)}</button>
        </section>`;
    const renderActive = (context, plan) => {
        const segment = plan.segments[state.phoneSegmentIndex] || plan.segments[0];
        return `
            <section class="voice-call-stage voice-call-active" aria-labelledby="tts-active-caller">
                <div class="voice-call-active-head"><span class="voice-call-live-dot" aria-hidden="true"></span><div><small>通话中</small><strong id="tts-call-duration">${formatCallDuration(state.phoneElapsed)}</strong></div></div>
                <div class="voice-call-active-person"><div class="voice-call-avatar-wrap">${renderCallerAvatar(context, 'voice-call-avatar')}</div><h1 id="tts-active-caller">${safe(context.charName)}</h1><small>${safe(plan.tone)}</small></div>
                <div class="voice-call-visualizer ${state.phoneNeedsResume ? 'is-paused' : ''}" aria-hidden="true">${Array.from({ length: 15 }, (_, index) => `<i style="--bar:${index}"></i>`).join('')}</div>
                <div class="voice-call-subtitle" aria-live="polite"><small id="tts-call-emotion">${safe(`${segment?.speaker || plan.charName} · ${segment?.emotion || '自然'}`)}</small><p id="tts-call-subtitle">${safe(segment?.text || '正在接通……')}</p><span id="tts-call-translation" ${segment?.translation && segment.translation !== segment.text ? '' : 'hidden'}>${safe(segment?.translation || '')}</span></div>
                <div class="voice-call-segments" aria-label="通话进度">${plan.segments.map((_, index) => `<i class="${index === state.phoneSegmentIndex ? 'is-active' : index < state.phoneSegmentIndex ? 'is-done' : ''}"></i>`).join('')}</div>
                ${state.phoneNeedsResume ? `<button class="voice-call-resume" type="button" data-resume-call>${icon('play', 18)} 继续播放</button>` : ''}
                <button class="voice-call-hangup" type="button" data-hangup-call aria-label="挂断电话">${icon('phone', 28)}<span>挂断</span></button>
            </section>`;
    };
    const renderEnded = (context, plan) => `
        <section class="voice-call-stage voice-call-ended" aria-labelledby="tts-call-ended-title">
            <div class="voice-call-ended-mark">${icon(state.phoneError ? 'info' : 'phone', 30)}</div><small>${state.phoneError ? '通话没有接通' : '通话结束'}</small>
            <h1 id="tts-call-ended-title">${safe(context.charName)}</h1><p>${safe(state.phoneError || plan?.reason || '这通电话已经结束。')}</p>
            <div>${plan ? `<button type="button" data-start-phone-call="${safe(plan.id)}">${icon('repeat', 17)} 再来一次</button>` : ''}<button type="button" data-close-call-result>${icon('arrowLeft', 17)} 返回来电</button></div>
        </section>`;

    const tools = FrontendVoiceTools.getSnapshot();
    const context = tools.context;
    const plan = state.phonePlan || null;
    const callContext = plan ? { ...context, charName: plan.charName || context.charName, avatarUrl: plan.avatarUrl || (plan.charName === context.charName ? context.avatarUrl : '') } : context;
    if (plan && state.phoneStage === 'ringing') return renderRinging(callContext, plan);
    if (plan && state.phoneStage === 'connecting') return renderConnecting(callContext);
    if (plan && state.phoneStage === 'active') return renderActive(callContext, plan);
    if (state.phoneStage === 'ended') return renderEnded(callContext, plan);
    return renderSetup(tools, context);
}
