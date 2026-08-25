# Model and prompt settings

## Phone reply model

The **模型** app controls text generation for Phoen private chat and turn-based calls.

- **跟随酒馆** uses SillyTavern's current generation API and model.
- Other choices come from SillyTavern Connection Manager profiles.
- Phoen stores only the selected profile ID. API URLs, credentials, presets, and instruct settings remain managed by SillyTavern.
- **回复上限** accepts 80–1200 tokens for the current phone reply.
- Voice synthesis remains routed through SillyTavern TTS and is independent of the reply model.

## Phone prompt preset

The **提示词** app edits the active phone reply preset. Changes save automatically to `extension_settings.phoen`.

Each entry has:

- a stable ID and editable name;
- an enabled switch;
- a `system`, `user`, or `assistant` role;
- editable content;
- explicit up/down ordering controls.

**插入深度** counts backwards from the newest recent phone-history message. Depth `0` places the preset block after recent history; depth `2` places it before the newest two history messages. The value is clamped to 0–20.

Available variables:

| Variable | Meaning |
|---|---|
| `{{角色}}` | Current SillyTavern character name |
| `{{用户}}` | Current user or Persona name |
| `{{语言}}` | Source dialogue language |
| `{{译文语言}}` | Translation language |
| `{{模式}}` | Private chat or live phone call |
| `{{历史}}` | Compact recent phone history |
| `{{输入}}` | Latest outgoing user text |
| `{{格式}}` | Mode-specific reply constraint |

English aliases such as `{{character}}`, `{{user}}`, `{{sourceLanguage}}`, `{{targetLanguage}}`, `{{history}}`, and `{{input}}` are also accepted. Unknown variables are preserved so they can be diagnosed instead of silently deleted.