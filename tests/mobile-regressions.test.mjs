import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    buildVoiceContacts,
    validateCallParticipants,
    validateSingleCallParticipant,
} from '../src/ui/mobile/contacts.js';
import {
    batchDeleteMessages,
    buildAllowedGroupMemberNames,
    buildQqMemberCandidates,
    partitionQqFriendSelection,
    removeQqFriends,
} from '../src/ui/mobile/qq-data.js';
import {
    normalizeStickerLibrary,
    parseStickerBatchText,
    resolveSticker,
} from '../src/ui/mobile/stickers.js';
import {
    NOVELAI_MODELS,
    buildNovelAiRequest,
    novelAiParamsVersion,
} from '../src/ui/mobile/novelai.js';
import { readOpenAICompatibleResponse } from '../src/dialogue/llm_client.js';
import { requestNovelAiImage } from '../src/ui/mobile/drawing.js';
import {
    normalizeChatTranslation,
    shouldRestoreGeneratedChat,
} from '../src/ui/mobile/chat-response.js';
import {
    decorateBodyText,
    findBodySpeechTags,
    parseBodySpeechTags,
} from '../src/dialogue/body-speech.js';
import { isPublicSingleCall, virtualNumber } from '../src/ui/mobile/phone.js';

test('通讯录只包含手动与正文发声角色，并应用隐藏名单', () => {
    const contacts = buildVoiceContacts({
        manualCharacters: ['手动角色', '重复角色'],
        bodySpeakers: ['正文角色', '重复角色', '隐藏角色'],
        hiddenCharacters: ['隐藏角色'],
        userName: '用户',
    });
    assert.deepEqual(contacts.map(item => item.name), ['手动角色', '正文角色', '重复角色']);
    assert.deepEqual(contacts.find(item => item.name === '重复角色').sources, ['manual', 'body']);
});

test('通用参与者校验保留给 QQ 与旧数据，公开电话严格单选', () => {
    assert.deepEqual(validateCallParticipants(['甲']), ['甲']);
    assert.deepEqual(validateCallParticipants(['甲', '乙', '甲']), ['甲', '乙']);
    assert.throws(() => validateCallParticipants([]), /至少选择 1 位/);
    assert.throws(() => validateCallParticipants(['1', '2', '3', '4', '5', '6', '7']), /最多选择 6 位/);
    assert.equal(validateSingleCallParticipant(['甲']), '甲');
    assert.throws(() => validateSingleCallParticipant(['甲', '乙']), /只能选择 1 位/);
    assert.equal(isPublicSingleCall({ kind: 'single', participants: ['甲'] }), true);
    assert.equal(isPublicSingleCall({ kind: 'group', participants: ['甲', '乙'] }), false);
    assert.equal(isPublicSingleCall({ speakers: ['甲', '乙'] }), false);
});

test('QQ 批量删除消息会保留线程并修复悬空引用', () => {
    const messages = [
        { id: 'a', content: '原消息' },
        { id: 'b', content: '回复', replyToId: 'a' },
        { id: 'c', content: '保留' },
    ];
    const result = batchDeleteMessages(messages, ['a']);
    assert.deepEqual(result.map(item => item.id), ['b', 'c']);
    assert.equal(result[0].replyToId, '');
    assert.equal(result[0].replyPreview, '原消息已删除');
});

test('QQ 批量删除好友同步群成员，并解散不足两人的群', () => {
    const result = removeQqFriends({
        friends: [{ name: '甲' }, { name: '乙' }, { name: '丙' }],
        groups: [
            { id: 'g1', members: ['甲', '乙', '丙'], messages: [{ id: 'm' }] },
            { id: 'g2', members: ['甲', '乙'], messages: [] },
        ],
    }, ['甲']);
    assert.deepEqual(result.friends.map(item => item.name), ['乙', '丙']);
    assert.deepEqual(result.groups.map(item => item.id), ['g1']);
    assert.deepEqual(result.groups[0].members, ['乙', '丙']);
    assert.deepEqual(result.dissolvedGroupIds, ['g2']);
});

test('QQ 群聊候选包含当前角色，并对重复好友去重', () => {
    assert.deepEqual(buildQqMemberCandidates({
        currentName: '夏尔',
        friends: [{ name: 'Mary' }, { name: '夏尔' }, { name: 'Mary' }],
    }).map(item => item.name), ['夏尔', 'Mary']);
    assert.deepEqual(buildQqMemberCandidates({
        currentName: '夏尔',
        hiddenCurrent: true,
        friends: [{ name: 'Mary' }],
    }).map(item => item.name), ['Mary']);
});

test('群聊服务层允许当前角色，即使它尚未进入通讯录来源名单', () => {
    assert.deepEqual(buildAllowedGroupMemberNames([{ name: 'Mary' }], '夏尔'), ['Mary', '夏尔']);
});

test('QQ 管理删除会把当前角色与普通好友拆开处理', () => {
    assert.deepEqual(partitionQqFriendSelection(['夏尔', 'Mary'], '夏尔'), {
        hideCurrent: true,
        friendNames: ['Mary'],
    });
});

test('表情包导入兼容名称紧接 URL、逗号与末尾逗号', () => {
    const source = '来啦来啦https://files.catbox.moe/afuns1.png,那咋了https://files.catbox.moe/dhp2gr.png,';
    const parsed = parseStickerBatchText(source);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].name, '来啦来啦');
    assert.equal(parsed[1].url, 'https://files.catbox.moe/dhp2gr.png');
    const library = normalizeStickerLibrary(parsed);
    assert.ok(library.every(item => item.id && item.status === 'unchecked'));
    assert.equal(resolveSticker(library, { name: ' 来啦来啦 ' })?.url, parsed[0].url);
});

test('NovelAI 提供 V5/V4.5 并按模型发送参数版本', () => {
    const ids = NOVELAI_MODELS.map(item => item.id);
    for (const id of ['nai-diffusion-5-full', 'nai-diffusion-5-curated', 'nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated']) {
        assert.ok(ids.includes(id), `缺少 ${id}`);
    }
    assert.equal(novelAiParamsVersion('nai-diffusion-5-full'), 4);
    assert.equal(novelAiParamsVersion('nai-diffusion-4-5-full'), 3);
    assert.equal(buildNovelAiRequest({ model: 'nai-diffusion-5-curated', prompt: 'cat' }).params_version, 4);
});

test('NovelAI V5 原生不兼容时改走安全服务插件', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body) });
        return url.includes('/api/novelai/')
            ? new Response('older core cannot route V5', { status: 500 })
            : new Response('base64-png', { status: 200 });
    };
    const response = await requestNovelAiImage({ model: 'nai-diffusion-5-full', prompt: 'cat' }, { fetchImpl });
    assert.equal(await response.text(), 'base64-png');
    assert.deepEqual(calls.map(call => call.url), [
        '/api/novelai/generate-image',
        '/api/plugins/phonie-novelai-v5/generate',
    ]);
    assert.ok(calls.every(call => call.body.params_version === 4));
});

test('NovelAI V5 兼容服务插件随项目交付', () => {
    const plugin = readFileSync(new URL('../server-plugins/phonie-novelai-v5/index.mjs', import.meta.url), 'utf8');
    assert.match(plugin, /params_version:\s*4/);
    assert.match(plugin, /SECRET_KEYS\.NOVEL/);
    assert.doesNotMatch(plugin, /api[_-]?key\s*[:=]\s*['"][^'"]+/i);
});

test('OpenAI 兼容流式响应支持跨块 SSE 与 DONE', async () => {
    const encoder = new TextEncoder();
    const streamText = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: '{"ok' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: '":true}' } }] })}\n\n`,
        'data: [DONE]\n\n',
    ].join('');
    const response = new Response(new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(streamText.slice(0, 29)));
            controller.enqueue(encoder.encode(streamText.slice(29, 73)));
            controller.enqueue(encoder.encode(streamText.slice(73)));
            controller.close();
        },
    }), { headers: { 'content-type': 'text/event-stream' } });
    assert.equal(await readOpenAICompatibleResponse(response, { streaming: true }), '{"ok":true}');
});

test('OpenAI 非流式响应继续解析普通 JSON', async () => {
    const response = new Response(JSON.stringify({ choices: [{ message: { content: '完成' } }] }), {
        headers: { 'content-type': 'application/json' },
    });
    assert.equal(await readOpenAICompatibleResponse(response, { streaming: false }), '完成');
});

test('中文或中外文混合消息缺少 translation 时保留原文而不丢弃整批回复', () => {
    assert.equal(normalizeChatTranslation('今天辛苦啦，Kurohaちゃん～', ''), '今天辛苦啦，Kurohaちゃん～');
    assert.equal(normalizeChatTranslation('纯中文消息', ''), '纯中文消息');
    assert.equal(normalizeChatTranslation('当然可以呀', '缺失翻译'), '当然可以呀');
    assert.equal(normalizeChatTranslation('おやすみ', '晚安'), '晚安');
    assert.equal(normalizeChatTranslation('good night', ''), 'good night');
});

test('生成期间没有手动切换会话时恢复原目标线程，手动切换后不抢走界面', () => {
    assert.equal(shouldRestoreGeneratedChat({ route: 'chat', revisionAtStart: 2, currentRevision: 2 }), true);
    assert.equal(shouldRestoreGeneratedChat({ route: 'chat', revisionAtStart: 2, currentRevision: 3 }), false);
    assert.equal(shouldRestoreGeneratedChat({ route: 'qq', revisionAtStart: 2, currentRevision: 2 }), false);
});

test('通讯录虚拟号码由拨号界面和点击事件共享，点击号码会切换到唯一联系人', () => {
    assert.match(virtualNumber('Mary'), /^\+00 \d{3} \d{4} \d{3}$/);
    const mobile = readFileSync(new URL('../src/ui/mobile/index.js', import.meta.url), 'utf8');
    assert.match(mobile, /virtualNumber \} from '\.\/phone\.js'/);
    assert.match(mobile, /const match = number \? contacts\.find/);
    assert.match(mobile, /if \(number && !match\)/);
    assert.match(mobile, /participants = readSelectedParticipants\(form\)/);
});

test('正文 TTS 台词含直角引号时仍能解析并生成主题音波播放条', () => {
    const source = '「可见译文」[TTS:夏尔:轻声:「你终于来了。」]';
    const speeches = parseBodySpeechTags(source).filter(item => item.type === 'speech');
    assert.equal(speeches.length, 1);
    assert.equal(speeches[0].sourceText, '「你终于来了。」');
    assert.deepEqual(findBodySpeechTags(source).map(item => [item.speaker, item.sourceText]), [['夏尔', '「你终于来了。」']]);
    const html = decorateBodyText(source);
    assert.match(html, /voice-body-speech/);
    assert.match(html, /voice-body-wave/);
    assert.match(html, /data-text="「你终于来了。」"/);
    assert.match(html, /<span class="sr-only">夏尔<\/span>/);
    assert.doesNotMatch(html, />夏尔<\/button>/);
});

test('清单关闭自动更新并升级到 1.2.0', () => {
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    assert.equal(manifest.auto_update, false);
    assert.equal(manifest.version, '1.2.0');
});
