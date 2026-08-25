# Phoen architecture

## Boundaries

`src/dialogue` contains pure parsing and prompt logic. `src/phone` owns the call state machine and per-chat phone records. `src/tts` defines provider-neutral contracts. `src/integrations` is the only layer allowed to import SillyTavern modules. `src/ui` owns DOM rendering and interaction. `phone-home.js` declares the app map and phone shell markup; `orb-gesture.js` keeps touch classification pure and testable.

## Persistence

- `extension_settings.phoen`: global display, language, and playback preferences.
- `chatMetadata.phoen`: private messages and call summaries for the active SillyTavern chat.
- `message.extra.phoen`: reserved for source-message speech metadata.
- IndexedDB `phoen-audio`: generated audio blobs keyed by chat, message, text, and provider.

Audio is not embedded into chat JSON.

## Generation

Phone replies use `generateQuietPrompt` with a JSON schema. The visible main reply is never required to emit hidden Phoen tags. A compact, bounded summary of recent phone activity is injected into the main prompt for continuity.

## Audio focus

One owner may play audio at a time. Calls take precedence over phone messages, which take precedence over cached inline playback. SillyTavern's TTS events remain the source of truth for newly generated audio.
