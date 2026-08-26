# Phonie Voice Phone

Phonie is an original voice-phone extension for SillyTavern. It treats inline narration, private phone messages, and calls as three views of one conversation system.

## Installation

Use `https://github.com/hey8v0/SillyTavern-TTS-Phonie.git` in **Extensions → Install Extension**. Android and Termux troubleshooting, including a no-credential clone and ZIP fallback, is documented in [Mobile installation](docs/MOBILE_INSTALL.md).

## Current scope

- Selectable entry through an edge-docked floating orb, the SillyTavern magic-wand menu, or both.
- Original Resonance OS handset with a physical frame, hardware rails, status island, safe-area insets, gesture indicator, eight app tiles, and five-item dock.
- Character wallpaper with a soft lower fade and day, night, and SillyTavern-following contrast veils.
- Low-density resonance curtain that pauses outside the home screen, during audio work, and when reduced motion is requested.
- Chinese body-TTS workflow injected before every normal generation, with editable ordered roles, provider-aware emotion controls, visible translation, and a tiny per-line play button.
- Live SillyTavern TTS provider list and switching inside the Voice app.
- Private text and synthesized voice messages.
- Turn-based calls with bilingual captions and TTS playback.
- Phone reply generation through the current SillyTavern model, a saved Connection Manager profile, or an OpenAI-compatible endpoint with model discovery; secrets remain managed by SillyTavern.
- Separate editable body-TTS and phone prompt workflows with ordered entries, `system`/`user`/`assistant` roles, enable switches, insertion depth, variables, and automatic persistence.
- Per-chat phone history, global settings, and IndexedDB audio caching.

Model routing and prompt variables are documented in [Model and prompt settings](docs/MODEL_AND_PROMPTS.md).

## Development

Run checks from this directory:

```powershell
npm test
npm run check
```

The project has no build step and does not download runtime dependencies.
