import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_FILES = [
    'index.js',
    'manifest.json',
    'style.css',
    'styles/voice-console.css',
    'src/dialogue/body-speech.js',
    'src/dialogue/body-tts.js',
    'src/dialogue/llm_client.js',
    'src/dialogue/voice-tools.js',
    'src/tts/cache.js',
    'src/tts/provider-registry.js',
    'src/ui/mobile/index.js',
    'src/ui/mobile/shell.js',
    'src/ui/mobile/contacts.js',
    'src/ui/mobile/phone.js',
    'src/ui/mobile/qq.js',
    'src/ui/mobile/qq-data.js',
    'src/ui/mobile/stickers.js',
    'src/ui/mobile/drawing.js',
    'src/ui/mobile/settings.js',
    'server-plugins/phonie-novelai-v5/index.mjs',
    'server-plugins/tts-minimax-resources/index.mjs',
];

const FORBIDDEN_RUNTIME_FILES = [
    'src/ui/mobile-ui-v3.js',
    'src/ui/phone-view.js',
    'src/app.js',
];

function fail(message) {
    console.error(`\u2717 ${message}`);
    process.exitCode = 1;
}

function ok(message) {
    console.log(`\u2713 ${message}`);
}

// 1. 必需文件存在且非空。
for (const file of REQUIRED_FILES) {
    const path = join(ROOT, file);
    if (!existsSync(path)) {
        fail(`缺少文件：${file}`);
    } else if (readFileSync(path, 'utf8').trim().length === 0) {
        fail(`文件为空：${file}`);
    } else {
        ok(`文件就绪：${file}`);
    }
}

// 2. manifest.json 合法。
try {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
    if (manifest.js !== 'index.js') fail('manifest.json 的 js 入口应为 index.js');
    if (manifest.hooks?.activate !== 'init') fail('manifest.json 缺少 hooks.activate = init');
    if (manifest.version !== '1.1.2') fail('manifest.json 版本应为 1.1.2');
    if (manifest.auto_update !== false) fail('manifest.json 必须关闭 auto_update');
    ok(`manifest 合法：${manifest.display_name} v${manifest.version}，自动更新已关闭`);
} catch (error) {
    fail(`manifest.json 解析失败：${error.message}`);
}

// 3. 当前入口必须只加载无版本号手机，旧运行时不可复活。
const entrySource = readFileSync(join(ROOT, 'index.js'), 'utf8');
if (!entrySource.includes('./src/ui/mobile/index.js')) fail('index.js 未加载当前无版本号手机入口');
if (/mobile-ui-v\d|phone-view|src\/app/u.test(entrySource)) fail('index.js 仍引用旧手机入口');
for (const file of FORBIDDEN_RUNTIME_FILES) {
    if (existsSync(join(ROOT, file))) fail(`旧运行时仍存在：${file}`);
}
const rootCss = readFileSync(join(ROOT, 'style.css'), 'utf8');
if (!rootCss.includes('./styles/voice-console.css')) fail('style.css 未收口到统一手机样式');
if (/\.phonie-/u.test(readFileSync(join(ROOT, 'styles/voice-console.css'), 'utf8'))) fail('统一样式中仍有 .phonie-* 旧选择器');
ok('当前入口无旧版回退，样式加载已合并');

// 4. 递归收集 JS 文件并做语法检查（跳过 node_modules 与历史交接文档）。
function collectJs(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '.git' || entry === 'PHOEN_ORIGINAL_HANDOFF_2026-08-25') continue;
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) collectJs(path, out);
        else if (extname(entry) === '.js' || extname(entry) === '.mjs') out.push(path);
    }
    return out;
}

const jsFiles = collectJs(ROOT);
let syntaxFailures = 0;
for (const file of jsFiles) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
        fail(`语法错误：${file}\n${result.stderr}`);
        syntaxFailures += 1;
    }
}
if (syntaxFailures === 0) ok(`语法检查通过（${jsFiles.length} 个文件）`);

if (!process.exitCode) {
    console.log('\n\u2713 Phonie 项目检查全部通过。');
}
