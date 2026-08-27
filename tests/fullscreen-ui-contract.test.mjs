import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const callCss = await readFile(new URL('../styles/call.css', import.meta.url), 'utf8');
const workflowCss = await readFile(new URL('../styles/workflows.css', import.meta.url), 'utf8');

test('call screen owns the handset below the real status bar', () => {
    assert.match(callCss, /data-screen='call'[^{}]*\.phonie-header[\s\S]*?data-screen='call'[^{}]*\.phonie-dock\s*\{\s*display:\s*none/);
    assert.match(callCss, /\.phonie-screen\[data-screen='call'\]\s*\{[\s\S]*?margin:\s*0;[\s\S]*?border:\s*0;/);
});

test('chat and prompt screens drop the redundant global app header', () => {
    assert.match(workflowCss, /data-screen='chat'[^{}]*\.phonie-header/);
    assert.match(workflowCss, /data-screen='prompts'[^{}]*\.phonie-header/);
});

test('preset switcher cannot expand the phone horizontally', () => {
    assert.match(workflowCss, /\.phonie-preset-switcher\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,/);
    assert.match(workflowCss, /\.phonie-preset-switcher select\s*\{[\s\S]*?width:\s*100%;[\s\S]*?text-overflow:\s*ellipsis;/);
});
