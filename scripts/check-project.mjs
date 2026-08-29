import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_FILES = [
    'index.js',
    'manifest.json',
    'style.css',
    'src/app.js',
    'src/core/constants.js',
    'src/core/store.js',
    'src/core/icons.js',
    'src/device/device-status.js',
    'src/integrations/sillytavern.js',
    'src/ui/dom.js',
    'src/ui/phone-view.js',
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
    ok(`manifest 合法：${manifest.display_name} v${manifest.version}`);
} catch (error) {
    fail(`manifest.json 解析失败：${error.message}`);
}

// 3. 递归收集 JS 文件并做语法检查（跳过 node_modules）。
function collectJs(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '.git') continue;
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
