/**
 * 正文 TTS 运行时：
 * - 监听酒馆消息渲染事件，把正文里的 `[TTS:角色:情绪:文本]`（兼容旧 `[TTSVoice:…]`）
 *   控制标签替换为可点击的播放控件，可见译文保留；
 * - 总开关关闭时不解析、不装饰、不生成；
 * - 自动渲染开启时后台生成并缓存语音，不自动播放；
 * - 点击控件播放（命中 IndexedDB 缓存则直接播放，否则现场合成）。
 */

import { eventSource, event_types } from '/script.js';
import { TTS_ProviderRegistry } from '../tts/provider-registry.js';
import { TTS_AudioCache, cacheKey } from '../tts/cache.js';
import { decorateTextNodeFragment, hasBodySpeechTag, parseBodySpeechTags } from './body-speech.js';

let initialized = false;
let scheduled = false;
let activeAudio = null;
let activeButton = null;
let prerenderChain = Promise.resolve();
const prerenderPending = new Set();

function getBodyFlags() {
    const playback = TTS_ProviderRegistry.getPlaybackSettings?.() || {};
    const ui = TTS_ProviderRegistry.getUiSettings?.() || {};
    return {
        enabled: playback.enabled !== false,
        autoRender: ui.bodyAutoRender !== false,
    };
}

function scheduleProcess() {
    if (scheduled || typeof requestAnimationFrame !== 'function') return;
    scheduled = true;
    requestAnimationFrame(() => {
        scheduled = false;
        processRenderedMessages();
    });
}

function stopActiveAudio() {
    if (!activeAudio) return;
    activeAudio.pause();
    activeAudio.removeAttribute('src');
    activeAudio.load?.();
    activeAudio = null;
    if (activeButton) {
        activeButton.classList.remove('is-playing', 'is-loading');
        activeButton = null;
    }
}

function speechSignature(speeches) {
    return speeches.map(segment => `${segment.speaker}\u0001${segment.emotion}\u0001${segment.sourceText}`).join('\u0002');
}

/**
 * 只对 .mes_text 里现存的文字节点做标签替换，绝不整体覆盖 innerHTML，
 * 避免破坏酒馆正则脚本或其他插件已经渲染好的 DOM。
 */
function decorateExistingTextNodes(textElement) {
    let decorated = 0;
    for (const node of [...textElement.childNodes]) {
        if (node.nodeType !== Node.TEXT_NODE || !node.nodeValue) continue;
        if (!hasBodySpeechTag(node.nodeValue)) continue;
        node.replaceWith(decorateTextNodeFragment(node.nodeValue));
        decorated += 1;
    }
    return decorated;
}

function processRenderedMessages() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;
    const context = window.SillyTavern?.getContext?.() || null;
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    if (!chat.length) return;
    const flags = getBodyFlags();
    chatContainer.querySelectorAll('.mes[mesid]').forEach(element => {
        const mesId = Number(element.getAttribute('mesid'));
        if (!Number.isInteger(mesId) || mesId < 0 || mesId >= chat.length) return;
        const message = chat[mesId];
        if (!message || typeof message.mes !== 'string') return;
        const textElement = element.querySelector('.mes_text');
        if (!textElement) return;
        const segments = parseBodySpeechTags(message.mes);
        const speeches = segments.filter(segment => segment.type === 'speech');
        if (!speeches.length) {
            // 编辑后不再有标签：清掉我们的签名标记，让酒馆自己渲染纯文本。
            if (element.dataset.phonieSig) {
                delete element.dataset.phonieSig;
                textElement.classList.remove('phonie-body-tts-text');
            }
            return;
        }
        if (!flags.enabled) return; // 总开关关闭：不解析、不装饰、不生成。
        const signature = speechSignature(speeches);
        if (element.dataset.phonieSig === signature) {
            if (flags.autoRender) prerenderBodyAudio(speeches);
            return;
        }
        // 小铅笔编辑 / 滑动重选后 ST 会重新渲染 .mes_text，标签重新出现在文字节点里。
        if (decorateExistingTextNodes(textElement) > 0) {
            element.dataset.phonieSig = signature;
            textElement.classList.add('phonie-body-tts-text');
            try {
                message.extra = message.extra || {};
                message.extra.phonie_v2 = {
                    segments: speeches.map(segment => ({
                        speaker: segment.speaker,
                        emotion: segment.emotion,
                        sourceText: segment.sourceText,
                    })),
                };
            } catch {
                // 写入 message.extra 失败不影响渲染。
            }
            if (flags.autoRender) prerenderBodyAudio(speeches);
        }
        // 标签不在文字节点里（可能被其他脚本处理过）：不动 DOM，等下一次渲染事件再试。
    });
}

function prerenderBodyAudio(speeches) {
    for (const segment of speeches) {
        const route = TTS_ProviderRegistry.resolveRoute?.(segment.speaker) || {};
        const providerId = route.providerId || 'gpt_sovits';
        const key = cacheKey({
            text: segment.sourceText,
            provider: providerId,
            voice: String(route.voice || ''),
        });
        if (prerenderPending.has(key)) continue;
        prerenderPending.add(key);
        prerenderChain = prerenderChain
            .then(() => generateBodyAudio(key, providerId, route, segment))
            .catch(() => {});
    }
}

async function generateBodyAudio(key, providerId, route, segment) {
    try {
        const cached = await TTS_AudioCache.get(key);
        if (cached) return;
        const blob = await TTS_ProviderRegistry.synthesize(providerId, {
            text: segment.sourceText,
            voice: String(route.voice || ''),
            model: String(route.model || ''),
            emotion: segment.emotion,
        });
        await TTS_AudioCache.put(key, blob, { providerId });
    } catch (error) {
        console.warn(`[Phonie 正文TTS] 后台生成失败（${segment.speaker}）`, error);
    } finally {
        prerenderPending.delete(key);
    }
}

async function playBodySpeech(button) {
    const text = String(button.dataset.text || '').trim();
    const speaker = String(button.dataset.speaker || '').trim();
    const emotion = String(button.dataset.emotion || '').trim();
    if (!text) return;
    const flags = getBodyFlags();
    if (!flags.enabled) return;

    if (activeButton && activeButton !== button) stopActiveAudio();
    if (activeAudio && activeButton === button) {
        if (!activeAudio.paused) {
            activeAudio.pause();
            button.classList.remove('is-playing');
            return;
        }
        try {
            await activeAudio.play();
            button.classList.add('is-playing');
        } catch {
            // 自动播放受限时忽略。
        }
        return;
    }

    const route = TTS_ProviderRegistry.resolveRoute?.(speaker) || {};
    const providerId = route.providerId || 'gpt_sovits';
    const key = cacheKey({
        text,
        provider: providerId,
        voice: String(route.voice || ''),
    });
    button.classList.add('is-loading');
    let blob = null;
    try {
        blob = await TTS_AudioCache.get(key);
        if (!blob) {
            blob = await TTS_ProviderRegistry.synthesize(providerId, {
                text,
                voice: String(route.voice || ''),
                model: String(route.model || ''),
                emotion,
            });
            await TTS_AudioCache.put(key, blob, { providerId });
        }
    } catch (error) {
        button.classList.remove('is-loading');
        console.warn(`[Phonie 正文TTS] 播放失败（${speaker}）`, error);
        button.setAttribute('title', `播放失败：${error?.message || '合成失败'}`);
        return;
    }
    button.classList.remove('is-loading');
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    activeAudio = audio;
    activeButton = button;
    button.classList.add('is-playing');
    const cleanup = () => {
        URL.revokeObjectURL(url);
        if (activeAudio === audio) {
            activeAudio = null;
            activeButton = null;
        }
        button.classList.remove('is-playing');
    };
    audio.addEventListener('ended', cleanup);
    audio.addEventListener('error', cleanup);
    try {
        await audio.play();
    } catch {
        cleanup();
    }
}

function onDocumentClick(event) {
    const button = event.target.closest?.('.phonie-body-speech');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    playBodySpeech(button);
}

export function initBodyTtsRuntime() {
    if (initialized || typeof eventSource?.on !== 'function') return;
    initialized = true;
    const renderEvents = new Set([
        event_types.CHARACTER_MESSAGE_RENDERED,
        event_types.USER_MESSAGE_RENDERED,
        event_types.MESSAGE_RECEIVED,
        event_types.MESSAGE_UPDATED,
        event_types.CHAT_CHANGED,
    ].filter(Boolean));
    renderEvents.forEach(eventName => eventSource.on(eventName, scheduleProcess));
    document.addEventListener('click', onDocumentClick, true);
    scheduleProcess();
}
