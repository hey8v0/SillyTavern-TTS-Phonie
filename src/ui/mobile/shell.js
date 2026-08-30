export function getLauncherMode({ TTS_ProviderRegistry }) {
    const mode = TTS_ProviderRegistry.getUiSettings()?.launcherMode;
    return ['orb', 'wand', 'both'].includes(mode) ? mode : 'both';
}

export function applyLauncherVisibility({ TTS_ProviderRegistry }) {
    const mode = getLauncherMode({ TTS_ProviderRegistry });
    const trigger = document.getElementById('tts-mobile-trigger');
    if (trigger) trigger.style.display = mode === 'wand' ? 'none' : '';
    const wandItem = document.getElementById('phonie-wand-menu-item');
    if (wandItem) wandItem.hidden = mode === 'orb';
    const modeSelect = document.getElementById('phonie-launcher-mode');
    if (modeSelect) modeSelect.value = mode;
}

export function mountPhonieLaunchers({ TTS_ProviderRegistry, TTS_Mobile }) {
    const apply = () => applyLauncherVisibility({ TTS_ProviderRegistry });
    const mountSettings = (attempt = 0) => {
        if (document.getElementById('phonie-settings-launcher')) return;
        const container = document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
        if (!container) {
            if (attempt < 10) window.setTimeout(() => mountSettings(attempt + 1), 700);
            return;
        }
        const launcher = document.createElement('div');
        launcher.id = 'phonie-settings-launcher';
        launcher.className = 'extension_container voice-settings-launcher';
        launcher.innerHTML = `<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b><i class="fa-solid fa-mobile-screen-button" aria-hidden="true"></i> Phonie 手机</b><div class="inline-drawer-icon fa-solid fa-chevron-down down" aria-hidden="true"></div></div><div class="inline-drawer-content"><label for="phonie-launcher-mode">打开入口</label><select id="phonie-launcher-mode" class="text_pole"><option value="orb">悬浮球</option><option value="wand">酒馆扩展菜单</option><option value="both">两者都显示</option></select><button class="menu_button" type="button" data-launcher-open><i class="fa-solid fa-mobile-screen-button" aria-hidden="true"></i><span>打开 Phonie 手机</span></button></div></div>`;
        launcher.querySelector('[data-launcher-open]')?.addEventListener('click', () => TTS_Mobile.open());
        launcher.querySelector('#phonie-launcher-mode')?.addEventListener('change', event => {
            TTS_ProviderRegistry.updateUiSettings({ launcherMode: event.currentTarget.value });
            apply();
        });
        container.append(launcher);
        apply();
    };
    const mountWand = (attempt = 0) => {
        if (document.getElementById('phonie-wand-menu-item')) return;
        const container = document.getElementById('extensionsMenu') || document.getElementById('tts_wand_container');
        if (!container) {
            if (attempt < 10) window.setTimeout(() => mountWand(attempt + 1), 700);
            return;
        }
        const item = document.createElement('div');
        item.id = 'phonie-wand-menu-item';
        item.className = 'list-group-item flex-container flexGap5 voice-wand-menu-item';
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.innerHTML = `<div class="extensionsMenuExtensionButton"><i class="fa-solid fa-mobile-screen-button" aria-hidden="true"></i></div><span>Phonie 手机</span>`;
        const open = () => TTS_Mobile.open();
        item.addEventListener('click', open);
        item.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                open();
            }
        });
        container.append(item);
        apply();
    };
    mountSettings();
    mountWand();
    apply();
}
