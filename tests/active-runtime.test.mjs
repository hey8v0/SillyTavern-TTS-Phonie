import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('唯一入口加载无版本号手机且没有旧版回退', () => {
    const entry = read('index.js');
    assert.match(entry, /src\/ui\/mobile\/index\.js/);
    assert.doesNotMatch(entry, /mobile-ui-v\d|phone-view|src\/app/);
    assert.equal(existsSync(new URL('../src/ui/mobile-ui-v3.js', import.meta.url)), false);
    assert.equal(existsSync(new URL('../src/ui/phone-view.js', import.meta.url)), false);
});

test('两个入口使用酒馆原生抽屉、Font Awesome 手机图标和展开箭头', () => {
    const shell = read('src/ui/mobile/shell.js');
    assert.match(shell, /inline-drawer-toggle inline-drawer-header/);
    assert.match(shell, /fa-mobile-screen-button/);
    assert.match(shell, /fa-chevron-down/);
    assert.match(shell, /extensionsMenuExtensionButton/);
});

test('当前样式只有一个加载源且旧 .phonie-* 选择器已清除', () => {
    assert.match(read('style.css'), /styles\/voice-console\.css/);
    const css = read('styles/voice-console.css');
    assert.doesNotMatch(css, /\.phonie-/);
    assert.match(css, /max-height:\s*min\(38dvh, 280px\)/);
    assert.match(css, /max-height:\s*min\(48dvh, 420px\)/);
});

test('QQ 和表情 UI 提供批量操作、图片状态与图片纯气泡', () => {
    const mobile = `${read('src/ui/mobile/index.js')}\n${read('src/ui/mobile/qq.js')}`;
    for (const token of [
        'data-qq-delete-friends',
        'data-chat-delete-selected',
        'data-chat-select-all',
        'data-group-delete-selected',
        'data-group-select-all',
        'data-qq-group-message-form',
        '原消息已删除',
        'data-sticker-retry',
        '图床不可达',
    ]) assert.ok(mobile.includes(token), `缺少 ${token}`);
    assert.doesNotMatch(mobile, /<small>表情包<\/small><strong>/);
});

test('手机外壳、电话、通讯录、QQ、绘图、设置与表情包均由独立模块加载', () => {
    const mobile = read('src/ui/mobile/index.js');
    for (const moduleName of ['shell', 'phone', 'contacts', 'qq', 'drawing', 'settings', 'stickers']) {
        assert.match(mobile, new RegExp(`from './${moduleName}\\.js'`), `主入口没有加载 ${moduleName}.js`);
    }
    assert.doesNotMatch(mobile, /function renderQqApp\(/);
    assert.doesNotMatch(mobile, /function renderPhoneSetup\(/);
    assert.doesNotMatch(mobile, /function mountSettingsLauncher\(/);
});

test('模型设置显示流式选项和 NovelAI 新模型', () => {
    const mobile = read('src/ui/mobile/index.js');
    assert.match(mobile, /name="responseMode"/);
    const novelai = read('src/ui/mobile/novelai.js');
    for (const model of ['nai-diffusion-5-full', 'nai-diffusion-5-curated', 'nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated']) {
        assert.ok(novelai.includes(model), `缺少 ${model}`);
    }
});

test('QQ 群聊使用独立提示词工作流并可在设置中编辑', () => {
    const tools = read('src/dialogue/voice-tools.js');
    const mobile = read('src/ui/mobile/index.js');
    assert.match(tools, /group_chat:\s*'QQ 群聊'/);
    assert.match(tools, /buildPromptWorkflowMessages\('group_chat'/);
    assert.match(tools, /群成员可以保持沉默/);
    assert.match(mobile, /data-open-prompt-workflow="group_chat"/);
    assert.match(mobile, /group_chat:\s*'群聊'/);
});
