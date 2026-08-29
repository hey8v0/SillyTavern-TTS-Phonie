import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
    APPS,
    DOCK_APP_IDS,
    DEFAULT_SETTINGS,
    ENGINES,
    ISLAND_STATES,
    PROMPT_WORKFLOWS,
    SCREENS,
    THEMES,
    THEME_PALETTES,
} from '../src/core/constants.js';
import { extractJsonObject, QQ_GENERATION_SCHEMA, SINGLE_CALL_SCHEMA, GROUP_CALL_SCHEMA } from '../src/core/contracts.js';
import { createId, virtualPhoneNumber } from '../src/core/id.js';
import { createStore } from '../src/core/store.js';
import { icon } from '../src/core/icons.js';
import {
    addPromptEntry,
    addPromptPreset,
    compilePresetMessages,
    findUnresolvedVariables,
    movePromptEntry,
    normalizePromptLibrary,
    removePromptEntry,
    removePromptPreset,
    resolveVariables,
    selectPromptPreset,
    updateActivePromptPreset,
    updatePromptEntry,
} from '../src/dialogue/prompts.js';
import { parseBodySpeechTags, hasBodySpeechTag, decorateBodyText } from '../src/dialogue/body-speech.js';
import { createMessage, recallMessage, createCallRecord } from '../src/phone/records.js';
import { findContactByVirtualNumber } from '../src/phone/virtual-number.js';
import { typingDelay, parseStickerImport, clamp } from '../src/ui/dom.js';
import { normalizeBatteryStatus, normalizeNetworkStatus, createDeviceStatusSnapshot } from '../src/device/device-status.js';
import { normalizeEmotion, stripSoundTags, SOUND_TAGS, MINIMAX_EMOTIONS } from '../src/tts/emotion.js';
import { createDefaultPromptPreset, MINIMAX_ADAPT_CONTENT } from '../src/core/constants.js';

test('主页 APP 按两行四列固定顺序排列', () => {
    assert.deepEqual(APPS.map((app) => app.id), [SCREENS.QQ, SCREENS.PHONE, SCREENS.CONTACTS, SCREENS.TRACE, SCREENS.ENGINES, SCREENS.DRAWING, SCREENS.THEMES, SCREENS.SETTINGS]);
    assert.equal(APPS.length, 8);
});

test('Dock 固定为 QQ、电话、绘画、设置', () => {
    assert.deepEqual(DOCK_APP_IDS, ['qq', 'phone', 'drawing', 'settings']);
});

test('只保留六个 TTS 引擎', () => {
    assert.deepEqual(ENGINES.map((engine) => engine.id), ['indextts2', 'gpt-sovits', 'voxcpm2', 'edge', 'elevenlabs', 'minimax']);
});

test('灵动岛状态机包含全部六个状态', () => {
    assert.deepEqual(Object.values(ISLAND_STATES).sort(), ['connected', 'generating', 'idle', 'preparing_call', 'ringing', 'synthesizing'].sort());
});

test('五种提示词工作流固定', () => {
    assert.deepEqual(PROMPT_WORKFLOWS.map((workflow) => workflow.id), ['body', 'single_call', 'group_call', 'chat', 'image']);
});

test('主题提供语义化颜色令牌', () => {
    for (const theme of [THEMES.DAY, THEMES.NIGHT]) {
        for (const key of ['--phonie-bg', '--phonie-surface', '--phonie-accent', '--phonie-text']) {
            assert.ok(THEME_PALETTES[theme][key]);
        }
    }
});

test('store 支持 setState、函数式更新与订阅', () => {
    const store = createStore({ count: 0 });
    const seen = [];
    const unsubscribe = store.subscribe((state) => seen.push(state.count));
    store.setState({ count: 1 });
    store.setState((state) => ({ count: state.count + 1 }));
    assert.deepEqual(seen, [1, 2]);
    unsubscribe();
});

test('图标库为每个 APP 提供非空内联 SVG', () => {
    for (const app of APPS) {
        const svg = icon(app.icon);
        assert.ok(svg.startsWith('<svg'));
        assert.ok(svg.includes('phonie-icon'));
    }
});

test('六个 TTS 引擎使用六个独立 SVG 图标', () => {
    const names = ENGINES.map((engine) => engine.icon);
    assert.equal(new Set(names).size, 6);
    const svgs = names.map((name) => icon(name));
    assert.equal(new Set(svgs).size, 6);
    assert.ok(svgs.every((markup) => markup.startsWith('<svg')));
});

test('交接包通用 SVG 资产全部进入统一图标注册表', () => {
    const handoffIcons = [
        'activity', 'arrowLeft', 'arrowUp', 'arrowDown', 'bell', 'bookmark', 'chevronRight', 'cloud', 'database',
        'download', 'edit', 'upload', 'users', 'globe', 'grid', 'grip', 'home', 'info',
        'key', 'library', 'messageCircle', 'microphone', 'orbit', 'radio', 'repeat',
        'search', 'sun', 'tasks', 'undo', 'volume', 'moon', 'waveform', 'gift',
    ];
    assert.ok(handoffIcons.every((name) => icon(name).startsWith('<svg')));
});

test('extractJsonObject 稳健抽取 JSON', () => {
    assert.deepEqual(extractJsonObject({ messages: [] }), { messages: [] });
    assert.deepEqual(extractJsonObject({ content: '{"messages":[]}' }), { messages: [] });
    assert.deepEqual(extractJsonObject('```json\n{"dynamicPositiveTags":"cat"}\n```'), { dynamicPositiveTags: 'cat' });
    assert.deepEqual(extractJsonObject({ output: [{ content: [{ type: 'output_text', text: '{"messages":[]}' }] }] }), { messages: [] });
    assert.deepEqual(extractJsonObject('说明文字\n```json\n[{"kind":"text"}]\n```'), { messages: [{ kind: 'text' }] });
});

test('虚拟号码稳定且不指向真实号码', () => {
    const a = virtualPhoneNumber('card:abc');
    const b = virtualPhoneNumber('card:abc');
    assert.equal(a, b);
    assert.match(a, /^\+00 \d{3} \d{4} \d{4}$/);
    assert.ok(virtualPhoneNumber('card:abc') !== virtualPhoneNumber('card:def'));
});

test('按虚拟号码精确匹配联系人', () => {
    const contacts = [{ id: 'card:a', name: 'A' }];
    assert.equal(findContactByVirtualNumber(contacts, virtualPhoneNumber('card:a'))?.name, 'A');
    assert.equal(findContactByVirtualNumber(contacts, '+00 000 0000 0000'), null);
});

test('提示词变量解析中英文别名', () => {
    const out = resolveVariables('{{char}} 和 {{user}}', { '{{char}}': '角色', '{{user}}': '我' });
    assert.equal(out, '角色 和 我');
    assert.equal(resolveVariables('{{角色}} {{用户}}', { '{{char}}': 'A', '{{user}}': 'B' }), 'A B');
    assert.equal(resolveVariables('{{unknown}} {{char}}', {}), '{{unknown}} {{char}}');
    assert.deepEqual(findUnresolvedVariables('{{unknown}} {{char}} {{unknown}}'), ['unknown', 'char']);
});

test('提示词条目按深度插入且保留角色', () => {
    const preset = {
        id: 'p',
        entries: [
            { id: 'e1', role: 'system', depth: 1, content: 'SYS', enabled: true },
            { id: 'e2', role: 'user', depth: 0, content: 'USR', enabled: true },
        ],
    };
    const messages = compilePresetMessages({ preset, vars: {}, extra: [] });
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[0].content, 'SYS');
    assert.equal(messages[1].role, 'user');
});

test('提示词深度按实际消息列表从末尾插入', () => {
    const preset = { entries: [
        { id: 'deep', role: 'system', depth: 2, content: 'DEEP', enabled: true },
        { id: 'tail', role: 'user', depth: 0, content: 'TAIL', enabled: true },
    ] };
    const messages = compilePresetMessages({ preset, vars: {}, extra: [
        { role: 'user', content: 'A' },
        { role: 'assistant', content: 'B' },
        { role: 'user', content: 'C' },
    ] });
    assert.deepEqual(messages.map((item) => item.content), ['A', 'DEEP', 'B', 'C', 'TAIL']);
});

test('提示词条目增删改移不可变', () => {
    const preset = { id: 'p', entries: [{ id: 'e1', role: 'system', depth: 1, content: 'a', enabled: true }] };
    assert.equal(addPromptEntry(preset).entries.length, 2);
    assert.equal(updatePromptEntry(preset, 'e1', { content: 'b' }).entries[0].content, 'b');
    assert.equal(removePromptEntry(preset, 'e1').entries.length, 0);
    assert.equal(movePromptEntry(preset, 'e1', 'up').entries.length, 1);
});

test('每种提示词工作流支持多个命名预设和当前预设', () => {
    const library = normalizePromptLibrary(createDefaultPromptPreset('chat'), 'chat');
    const second = addPromptPreset(library, { kind: 'chat', name: '夜间聊天' });
    assert.equal(second.presets.length, 2);
    assert.equal(second.name, '夜间聊天');
    const selected = selectPromptPreset(second, library.activePresetId, 'chat');
    assert.equal(selected.activePresetId, library.activePresetId);
    const renamed = updateActivePromptPreset(selected, { ...selected, name: '主聊天' }, 'chat');
    assert.equal(renamed.presets.find((item) => item.id === renamed.activePresetId).name, '主聊天');
    assert.equal(removePromptPreset(renamed, renamed.activePresetId, 'chat').presets.length, 1);
});

test('正文 TTS 标签解析：前三个冒号做分隔，剩余属于文本', () => {
    const segments = parseBodySpeechTags('你好 [TTS:小明:开心:今天a:b:c]');
    assert.equal(segments[1].type, 'speech');
    assert.equal(segments[1].speaker, '小明');
    assert.equal(segments[1].emotion, '开心');
    assert.equal(segments[1].sourceText, '今天a:b:c');
});

test('渲染后删除控制标签并保留播放标记', () => {
    const html = decorateBodyText('「你好」[TTS:小明:开心:hello]');
    assert.ok(!html.includes('[TTS:'));
    assert.ok(html.includes('phonie-body-speech'));
});

test('消息撤回是状态变化且保留内容', () => {
    const message = createMessage({ originalText: 'secret' });
    const recalled = recallMessage(message);
    assert.equal(recalled.kind, 'recalled');
    assert.equal(recalled.originalText, 'secret');
});

test('通话记录保留重播数据', () => {
    const record = createCallRecord({ contactName: '小明', messageIds: ['m1'], messages: [{ id: 'm1' }] });
    assert.equal(record.contactName, '小明');
    assert.equal(record.messageIds.length, 1);
});

test('打字延迟在 320–2600ms 范围内', () => {
    assert.ok(typingDelay('') >= 280);
    assert.ok(typingDelay('x'.repeat(500)) <= 2600);
});

test('表情包导入按每项第一个 URL 拆分', () => {
    const items = parseStickerImport('开心https://a.png,生气https://b.gif');
    assert.equal(items.length, 2);
    assert.equal(items[0].name, '开心');
    assert.equal(items[1].url, 'https://b.gif');
});

test('电池与网络诚实降级', () => {
    assert.deepEqual(normalizeBatteryStatus(null), { available: false, percent: null, charging: false });
    assert.equal(normalizeNetworkStatus({ online: false }).kind, 'offline');
    assert.equal(normalizeNetworkStatus({ online: true, connection: { type: 'wifi' } }).kind, 'wifi');
});

test('设备状态快照包含时间、电量与网络', () => {
    const snapshot = createDeviceStatusSnapshot({ navigatorRef: { onLine: true, connection: null }, battery: { level: 0.9, charging: false }, now: 0 });
    assert.ok(snapshot.time);
    assert.equal(snapshot.battery.percent, 90);
});

test('三个生成契约 Schema 结构完整', () => {
    assert.ok(QQ_GENERATION_SCHEMA.properties.messages);
    assert.ok(SINGLE_CALL_SCHEMA.properties.segments);
    assert.ok(GROUP_CALL_SCHEMA.properties.threads);
});

test('clamp 限制数值范围', () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-1, 0, 10), 0);
    assert.equal(clamp(100, 0, 10), 10);
});

test('绘画参数遵守单图与 28 步契约', () => {
    assert.equal(DEFAULT_SETTINGS.novelAi.steps, 28);
    assert.match(DEFAULT_SETTINGS.novelAi.size, /^(832x1216|1216x832|1024x1024)$/);
    assert.ok(DEFAULT_SETTINGS.novelAi.prefix);
    assert.ok(DEFAULT_SETTINGS.novelAi.negative);
});

test('精修界面包含聊天管理、多选电话、追踪和完整绘画参数', () => {
    const source = readFileSync(new URL('../src/ui/phone-view.js', import.meta.url), 'utf8');
    for (const token of ['toggle-chat-settings', 'multiple size="3"', 'favorite-call', 'rerender-call', 'data-novelai-setting="steps"', 'clear-stickers']) {
        assert.ok(source.includes(token), `缺少界面能力：${token}`);
    }
});

test('首页不包含额外品牌说明文案', () => {
    const source = readFileSync(new URL('../src/ui/phone-view.js', import.meta.url), 'utf8');
    assert.ok(!source.includes('PHONIE · VOICE OS'));
    assert.ok(!source.includes('让每段对话'));
    assert.ok(!source.includes('真正有声音'));
    assert.ok(!/fa-(solid|regular|brands)|fa-[a-z]/.test(source));
});

test('视觉系统遵循精确过渡与 reduced-motion', () => {
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.ok(css.includes('2026 精修视觉层'));
    assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
    assert.ok(!css.includes('transition: all'));
});

// ---- 交接包资产集成 -------------------------------------------------------
test('MiniMax 情绪归一化映射中英文', () => {
    assert.equal(normalizeEmotion('开心'), 'happy');
    assert.equal(normalizeEmotion('sad'), 'sad');
    assert.equal(normalizeEmotion('平静'), 'neutral');
    assert.equal(normalizeEmotion('不存在的情绪'), '');
    assert.ok(MINIMAX_EMOTIONS.includes('fearful'));
});

test('Sound Tags 可从可见文本中剥离', () => {
    assert.ok(SOUND_TAGS.includes('(laughs)'));
    assert.equal(stripSoundTags('你好 (laughs) 世界 (sighs)'), '你好 世界');
});

test('默认提示词预设包含可关闭的 MiniMax 适配条目', () => {
    for (const kind of ['body', 'single_call', 'group_call', 'chat']) {
        const preset = createDefaultPromptPreset(kind);
        const adapt = preset.entries.find((entry) => entry.name === 'MiniMax 适配');
        assert.ok(adapt, `${kind} 缺少 MiniMax 适配条目`);
        assert.ok(adapt.content.includes('happy'));
        assert.ok(adapt.enabled);
    }
    const image = createDefaultPromptPreset('image');
    assert.ok(!image.entries.some((entry) => entry.name === 'MiniMax 适配'));
    assert.ok(MINIMAX_ADAPT_CONTENT.includes('(laughs)'));
    assert.ok(createDefaultPromptPreset('chat').entries[0].content.includes('{{outputSchema}}'));
    assert.ok(createDefaultPromptPreset('single_call').entries[0].content.includes('{{storyHistory}}'));
});

test('MiniMax 服务插件资产已随项目交付', () => {
    const exists = existsSync(new URL('../server-plugins/tts-minimax-resources/index.mjs', import.meta.url));
    assert.ok(exists, '缺少 MiniMax 服务插件');
    const plugin = readFileSync(new URL('../server-plugins/tts-minimax-resources/index.mjs', import.meta.url), 'utf8');
    assert.ok(plugin.includes('/generate'));
    assert.ok(plugin.includes('/catalog'));
});

test('OpenAI 与 ElevenLabs 设置只保存 secretId，不回写明文密钥', () => {
    const constants = readFileSync(new URL('../src/core/constants.js', import.meta.url), 'utf8');
    const view = readFileSync(new URL('../src/ui/phone-view.js', import.meta.url), 'utf8');
    const bridge = readFileSync(new URL('../src/integrations/sillytavern.js', import.meta.url), 'utf8');
    const secrets = readFileSync(new URL('../src/integrations/secrets.js', import.meta.url), 'utf8');
    assert.ok(!constants.includes("apiKey: ''"));
    assert.ok(!view.includes('preset.apiKey'));
    assert.ok(!view.includes('config.apiKey'));
    assert.ok(bridge.includes('preset.secretId'));
    assert.ok(secrets.includes('writeSecret'));
    assert.ok(secrets.includes('deleteSecret'));
});
