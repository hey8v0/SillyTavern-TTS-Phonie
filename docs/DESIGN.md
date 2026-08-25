# Phoen design contract

## Aesthetic direction

Phoen uses a refined near-future glass terminal with tactile controls and quiet organic colour. Its recognition anchor is the voice seam: a narrow illuminated rail that continues the dynamic status island down one side of the handset. The seam and island change only to communicate audio and call state.

The home screen is an operating hub rather than a decorative launcher: its time card, eight app tiles, voice-service card, five-item dock, hardware rails, and gesture indicator expose live SillyTavern state. Character art may become the wallpaper under theme-specific contrast veils.

The interface must remain recognisable without a logo. It does not imitate a commercial phone operating system, reuse an existing SillyTavern phone layout, or rely on emoji as interface symbols.

## Themes

- Day: warm mineral paper, carbon text, oxide signal accent.
- Night: blue-black glass, parchment text, sea-glass signal accent.
- Tavern: SillyTavern theme variables mapped into Phoen tokens with local contrast guards.

Each theme has one dominant surface story, one signal accent, and a neutral hierarchy.

## Motion contract

- Orb press feedback: 120 ms.
- Handset entrance: 240 ms, strong ease-out, originating from the docked edge.
- Handset exit: 180 ms.
- Screen change: 160 ms opacity and 6 px translation.
- Dragging is direct manipulation with boundary damping and pointer capture.
- Repeated navigation never waits for decorative motion.
- Reduced motion removes spatial travel while keeping brief opacity feedback.

Only transform and opacity are animated continuously. The dynamic island changes width only during generation or playback. Decorative P5 animation is intentionally excluded from version 0.2.

## Bilingual hierarchy

The source line is authoritative and is the default TTS input. The Chinese translation is supporting text and is never spoken unless the user explicitly changes the speech language.

## Responsive modes

- Desktop: a 390 by 790 logical handset, clamped to the viewport.
- Compact viewport: a borderless, safe-area-aware full-screen phone surface.
