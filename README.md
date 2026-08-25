# Phoen Voice Phone

Phoen is an original voice-phone extension for SillyTavern. It treats inline narration, private phone messages, and calls as three views of one conversation system.

## Installation

Use `https://github.com/hey8v0/SillyTavern-TTS-Phoen.git` in **Extensions → Install Extension**. Android and Termux troubleshooting, including a no-credential clone and ZIP fallback, is documented in [Mobile installation](docs/MOBILE_INSTALL.md).

## First release scope

- Edge-docked floating orb with tap-safe Android WebView gestures.
- Original Resonance OS home screen with a status island, character wallpaper, eight app tiles, five-item dock, and gesture indicator.
- Day, night, and SillyTavern-following themes.
- Bilingual inline dialogue player with Japanese-first speech planning.
- Private text and synthesized voice messages.
- Turn-based calls with bilingual captions and TTS playback.
- Structured quiet-generation prompts and compact main-chat continuity injection.
- Per-chat phone history, global settings, and IndexedDB audio caching.

## Development

Run checks from this directory:

```powershell
npm test
npm run check
```

The project has no build step and does not download runtime dependencies.
