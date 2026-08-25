import { readFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const required = [
    'manifest.json',
    'index.js',
    'style.css',
    'src/app.js',
    'src/integrations/sillytavern.js',
    'src/ui/phone-view.js',
    'src/ui/inline-player.js',
    'assets/icons/sprite.svg',
];

async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await walk(fullPath));
        else files.push(fullPath);
    }
    return files;
}

const errors = [];
for (const relativePath of required) {
    try {
        if (!(await stat(path.join(root, relativePath))).isFile()) errors.push(`Missing file: ${relativePath}`);
    } catch {
        errors.push(`Missing file: ${relativePath}`);
    }
}

for (const relativePath of ['manifest.json', 'package.json', 'locales/zh-cn.json', 'locales/ja-jp.json', 'locales/en.json']) {
    try {
        JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
    } catch (error) {
        errors.push(`Invalid JSON ${relativePath}: ${error.message}`);
    }
}

const files = await walk(root);
const textFiles = files.filter((file) => /\.(?:js|mjs|css|html|md|json|svg)$/.test(file));
const emojiPattern = /\p{Extended_Pictographic}/u;
for (const file of textFiles) {
    const text = await readFile(file, 'utf8');
    const relative = path.relative(root, file);
    if (emojiPattern.test(text)) errors.push(`Emoji found in ${relative}`);
    if (/\.css$/.test(file) && /transition\s*:\s*all\b/i.test(text)) errors.push(`transition: all found in ${relative}`);
}

for (const file of files.filter((entry) => /\.(?:js|mjs)$/.test(entry))) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) errors.push(`Syntax error in ${path.relative(root, file)}:\n${result.stderr.trim()}`);
}

const relativeImportPattern = /(?:from\s+|import\s*\()(['"])(\.[^'"]+)\1/g;
for (const file of files.filter((entry) => /\.(?:js|mjs)$/.test(entry))) {
    const text = await readFile(file, 'utf8');
    let match;
    while ((match = relativeImportPattern.exec(text)) !== null) {
        const resolved = path.resolve(path.dirname(file), match[2]);
        try {
            await stat(resolved);
        } catch {
            errors.push(`Broken relative import in ${path.relative(root, file)}: ${match[2]}`);
        }
    }
}

if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exit(1);
}

console.log(`Phoen project check passed: ${files.length} files verified.`);
