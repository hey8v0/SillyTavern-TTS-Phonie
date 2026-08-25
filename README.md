# Phoen Voice Phone

Phoen is an original voice-phone extension for SillyTavern. It treats inline narration, private phone messages, and calls as three views of one conversation system.

## Installation

Use `https://github.com/hey8v0/SillyTavern-TTS-Phoen.git` in **Extensions → Install Extension**. Android and Termux troubleshooting, including a no-credential clone and ZIP fallback, is documented in [Mobile installation](docs/MOBILE_INSTALL.md).

## Current scope

- Edge-docked floating orb with tap-safe Android WebView gestures.
- Original Resonance OS handset with a physical frame, hardware rails, status island, safe-area insets, gesture indicator, eight app tiles, and five-item dock.
- Character wallpaper with a soft lower fade and day, night, and SillyTavern-following contrast veils.
- Low-density resonance curtain that pauses outside the home screen, during audio work, and when reduced motion is requested.
- Bilingual inline dialogue player with Japanese-first speech planning.
- Private text and synthesized voice messages.
- Turn-based calls with bilingual captions and TTS playback.
- Phone reply generation through the current SillyTavern model or a saved Connection Manager profile; secrets remain managed by SillyTavern.
- Editable phone prompt preset with ordered entries, `system`/`user`/`assistant` roles, enable switches, insertion depth, variables, and automatic persistence.
- Per-chat phone history, global settings, and IndexedDB audio caching.

Model routing and prompt variables are documented in [Model and prompt settings](docs/MODEL_AND_PROMPTS.md).

## Development

Run checks from this directory:

```powershell
npm test
npm run check
```

The project has no build step and does not download runtime dependencies.