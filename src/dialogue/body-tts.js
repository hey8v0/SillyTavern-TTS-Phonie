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
import {
    createBodySpeechButton,
    decorateTextNodeFragment,
    findBodySpeechTags,
    hasBodySpeechTag,
    parseBodySpeechTags,
} from './body-speech.js';

let initialized = false;
let scheduled = false;
let activeAudio = null;
let activeButton = null;
let prerenderChain = Promise.resolve();
const prerenderPending = new Map();

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
    const hadPlayed = (activeAudio.currentTime || 0) > 0;
    activeAudio.pause();
    activeAudio.removeAttribute('src');
    activeAudio.load?.();
    activeAudio = null;
    if (activeButton) {
        if (hadPlayed) activeButton.classList.add('is-played', 'is-ready');
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
 * 递归扫描全部后代文字节点：正文经 Markdown/正则处理后标签经常包在 <p>/<span> 里，
 * 只查第一层会永远抓不到。
 */
function decorateExistingTextNodes(textElement) {
    let decorated = 0;
    const walker = document.createTreeWalker(
        textElement,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                if (!node.nodeValue || !hasBodySpeechTag(node.nodeValue)) {
                    return NodeFilter.FILTER_REJECT;
                }
                const parent = node.parentElement;
                if (
                    !parent
                    || parent.closest('.voice-body-speech, script, style, textarea, code, pre')
                ) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            },
        },
    );
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
        node.replaceWith(decorateTextNodeFragment(node.nodeValue));
        decorated += 1;
    }
    return decorated;
}

/**
 * Markdown 或正则插件偶尔会把一个 TTS 标签拆进数个相邻文字节点（常见于台词含「」时）。
 * 用 DOM Range 只替换标签覆盖的范围，不重写整段 innerHTML，也不破坏标签外的其他插件节点。
 */
function decorateSplitSpeechTags(textElement) {
    const nodes = [];
    const walker = document.createTreeWalker(textElement, NodeFilter.SHOW_TEXT);
    let combined = '';
    while (walker.nextNode()) {
        const node = walker.currentNode;
        const parent = node.parentElement;
        if (!node.nodeValue || !parent || parent.closest('.voice-body-speech, script, style, textarea, code, pre')) continue;
        const start = combined.length;
        combined += node.nodeValue;
        nodes.push({ node, start, end: combined.length });
    }
    const matches = findBodySpeechTags(combined).filter(match => {
        const startNode = nodes.find(item => match.start >= item.start && match.start < item.end);
        const endNode = nodes.find(item => match.end > item.start && match.end <= item.end);
        return startNode && endNode && startNode.node !== endNode.node;
    });
    let decorated = 0;
    for (const match of matches.reverse()) {
        const startNode = nodes.find(item => match.start >= item.start && match.start < item.end);
        const endNode = nodes.find(item => match.end > item.start && match.end <= item.end);
        if (!startNode || !endNode) continue;
        try {
            const range = document.createRange();
            range.setStart(startNode.node, match.start - startNode.start);
            range.setEnd(endNode.node, match.end - endNode.start);
            range.deleteContents();
            range.insertNode(createBodySpeechButton(match));
            range.detach?.();
            decorated += 1;
        } catch (error) {
            console.warn('[Phonie 正文TTS] 跨节点标签装饰失败，将等待下一次渲染。', error);
        }
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
            if (element.dataset.phonieSig) delete element.dataset.phonieSig;
            return;
        }
        speeches.forEach(segment => TTS_ProviderRegistry.addBodySpeaker?.(segment.speaker));
        if (!flags.enabled) return; // 总开关关闭：不解析、不装饰、不生成。
        const signature = speechSignature(speeches);
        // 酒馆的小铅笔会保留 .mes 元素但重建 .mes_text，因此“签名相同”不代表 DOM 仍已装饰，
        // 必须同时确认正文里还有我们的播放按钮，否则重新扫描替换。
        const alreadyDecorated = Boolean(textElement.querySelector('.voice-body-speech'));
        if (element.dataset.phonieSig === signature && alreadyDecorated) {
            if (flags.autoRender) prerenderBodyAudio(speeches, textElement);
            else inspectCachedBodyAudio(speeches, textElement);
            return;
        }
        // 小铅笔编辑 / 滑动重选后 ST 会重新渲染 .mes_text，标签重新出现在文字节点里。
        const decoratedCount = decorateExistingTextNodes(textElement) + decorateSplitSpeechTags(textElement);
        if (decoratedCount > 0) {
            element.dataset.phonieSig = signature;
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
            if (flags.autoRender) prerenderBodyAudio(speeches, textElement);
            else inspectCachedBodyAudio(speeches, textElement);
        }
        // 标签不在文字节点里（可能被其他脚本处理过）：不动 DOM，等下一次渲染事件再试。
    });
}

function markSpeechButtonsReady(root, segment) {
    root?.querySelectorAll?.('.voice-body-speech').forEach(button => {
        if (
            button.dataset.speaker === segment.speaker
            && button.dataset.emotion === segment.emotion
            && button.dataset.text === segment.sourceText
        ) {
            button.classList.remove('is-loading');
            button.classList.add('is-ready');
        }
    });
}

function markSpeechButtonsLoading(root, segment) {
    root?.querySelectorAll?.('.voice-body-speech').forEach(button => {
        if (
            !button.classList.contains('is-ready')
            && button.dataset.speaker === segment.speaker
            && button.dataset.emotion === segment.emotion
            && button.dataset.text === segment.sourceText
        ) button.classList.add('is-loading');
    });
}

function clearSpeechButtonsLoading(root, segment) {
    root?.querySelectorAll?.('.voice-body-speech').forEach(button => {
        if (
            button.dataset.speaker === segment.speaker
            && button.dataset.emotion === segment.emotion
            && button.dataset.text === segment.sourceText
        ) button.classList.remove('is-loading');
    });
}

function getBodyAudioRequest(segment) {
    const route = TTS_ProviderRegistry.resolveRoute?.(segment.speaker) || {};
    const providerId = route.providerId || 'gpt_sovits';
    const key = cacheKey({
        text: segment.sourceText,
        provider: providerId,
        voice: String(route.voice || ''),
    });
    return { key, providerId, route };
}

/** 不触发合成，只检查旧缓存，让“未渲染”和“已经渲染”在关闭自动渲染时仍有颜色差别。 */
function inspectCachedBodyAudio(speeches, root = document) {
    for (const segment of speeches) {
        const { key } = getBodyAudioRequest(segment);
        TTS_AudioCache.get(key)
            .then(cached => {
                if (cached) markSpeechButtonsReady(root, segment);
            })
            .catch(() => {});
    }
}

function prerenderBodyAudio(speeches, root = document) {
    for (const segment of speeches) {
        const { key, providerId, route } = getBodyAudioRequest(segment);
        markSpeechButtonsLoading(root, segment);
        let pending = prerenderPending.get(key);
        if (!pending) {
            pending = prerenderChain.then(() => generateBodyAudio(key, providerId, route, segment));
            prerenderPending.set(key, pending);
            prerenderChain = pending.catch(() => {});
            pending.finally(() => prerenderPending.delete(key));
        }
        pending.then(ready => {
            if (ready) markSpeechButtonsReady(root, segment);
            else clearSpeechButtonsLoading(root, segment);
        }).catch(() => clearSpeechButtonsLoading(root, segment));
    }
}

async function generateBodyAudio(key, providerId, route, segment) {
    try {
        const cached = await TTS_AudioCache.get(key);
        if (cached) return true;
        const blob = await TTS_ProviderRegistry.synthesize(providerId, {
            text: segment.sourceText,
            voice: String(route.voice || ''),
            model: String(route.model || ''),
            emotion: segment.emotion,
        });
        await TTS_AudioCache.put(key, blob, { providerId });
        return true;
    } catch (error) {
        console.warn(`[Phonie 正文TTS] 后台生成失败（${segment.speaker}）`, error);
        return false;
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
            button.classList.add('is-played', 'is-ready');
            button.classList.remove('is-playing');
            return;
        }
        try {
            await activeAudio.play();
            button.classList.add('is-ready');
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
    button.classList.add('is-ready');
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    activeAudio = audio;
    activeButton = button;
    button.classList.add('is-playing');
    const cleanup = ({ played = false } = {}) => {
        URL.revokeObjectURL(url);
        if (activeAudio === audio) {
            activeAudio = null;
            activeButton = null;
        }
        if (played) button.classList.add('is-played', 'is-ready');
        button.classList.remove('is-playing');
    };
    audio.addEventListener('ended', () => cleanup({ played: true }));
    audio.addEventListener('error', () => cleanup());
    try {
        await audio.play();
    } catch {
        cleanup();
    }
}

function onDocumentClick(event) {
    const button = event.target.closest?.('.voice-body-speech');
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
