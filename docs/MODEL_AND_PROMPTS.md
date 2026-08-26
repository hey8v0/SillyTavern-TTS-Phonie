# Model and prompt settings

## Phone reply model

The **模型** app controls text generation for Phonie private chat and turn-based calls.

- **跟随酒馆主模型** uses SillyTavern's current generation API and model.
- **连接管理器配置** lists profiles from SillyTavern Connection Manager. Phonie stores only the selected profile ID; credentials, presets, and instruct settings remain managed by SillyTavern.
- **自定义 OpenAI** accepts an OpenAI-compatible base URL, saves the API key into SillyTavern's protected `Custom OpenAI` secret slot, tests the connection through SillyTavern's backend proxy, and fetches the endpoint's model list.
- The custom API key is never placed in `extension_settings.phonie`, chat metadata, exported prompt presets, or the extension directory. Saving a key replaces the value currently held in SillyTavern's shared `Custom OpenAI` secret slot.
- **回复上限** accepts 80–1200 tokens for the current phone reply.
- Custom OpenAI requests also expose temperature and a separate 80–65536 maximum-token limit.
- Voice synthesis remains routed through SillyTavern TTS and is independent of the reply model.

## Phone prompt preset

The **提示词** app edits the active phone reply preset. Changes save automatically to `extension_settings.phonie`.

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
