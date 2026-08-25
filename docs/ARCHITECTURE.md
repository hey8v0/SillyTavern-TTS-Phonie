# Phonie architecture

## Boundaries

`src/dialogue` contains pure parsing, prompt-preset normalization, variable resolution, and message assembly. `src/phone` owns the call state machine and per-chat phone records. `src/tts` defines provider-neutral contracts. `src/integrations` is the only layer allowed to import SillyTavern modules. `src/ui` owns DOM rendering and interaction. `phone-home.js` declares the application map, `system-settings.js` declares model and prompt system apps, and `orb-gesture.js` keeps touch classification pure and testable.

## 0.3.1 namespace reset

The product namespace is now `phonie` throughout settings, chat metadata, message extras, DOM, CSS, prompts, logs, and IndexedDB. This release intentionally does not read or migrate data from any earlier namespace.

## Persistence

- `extension_settings.phonie`: global display, language, model profile, phone prompt preset, and playback preferences.
- `chatMetadata.phonie`: private messages and call summaries for the active SillyTavern chat.
- `message.extra.phonie`: reserved for source-message speech metadata.
- IndexedDB `phonie-audio`: generated audio blobs keyed by chat, message, text, and provider.

Audio and API secrets are not embedded in extension settings or chat JSON. Connection Manager profile IDs are stored, while the corresponding endpoint and secret remain under SillyTavern control.

## Generation

Phone replies compile the enabled preset entries into real chat-completion messages without flattening their `system`, `user`, or `assistant` roles. The preset block is inserted at the configured depth in recent phone history. Generation follows SillyTavern by default or uses a selected Connection Manager profile, with the same JSON schema in either path.

The response parser accepts direct structured objects, fenced JSON, `choices[].message.content`, and `messages` wrappers. A compact, bounded summary of recent phone activity can still be injected into the main prompt for story continuity.

## Audio focus

One owner may play audio at a time. Calls take precedence over phone messages, which take precedence over cached inline playback. SillyTavern's TTS events remain the source of truth for newly generated audio.