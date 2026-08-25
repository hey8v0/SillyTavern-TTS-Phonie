# Phonie design contract

## Aesthetic direction

Phonie uses a refined near-future glass terminal with tactile controls and quiet organic colour. Its recognition anchor is the voice seam: a narrow illuminated rail that continues the dynamic status island down one side of the handset. The seam and island change only to communicate audio and call state.

The home screen is an operating hub rather than a decorative launcher: its time card, eight app tiles, voice-service card, five-item dock, physical frame, hardware rails, and gesture indicator expose live SillyTavern state. Character art becomes a softly faded portrait layer under theme-specific contrast veils instead of a blunt full-screen image.

The interface must remain recognisable without a logo. It does not imitate a commercial phone operating system, reuse an existing SillyTavern phone layout, or rely on emoji as interface symbols.

## Themes

- Day: warm mineral paper, carbon text, oxide signal accent.
- Night: blue-black glass, parchment text, sea-glass signal accent.
- Tavern: SillyTavern theme variables mapped into Phonie tokens with local contrast guards.

Each theme has one dominant surface story, one signal accent, and a neutral hierarchy.

## Motion contract

- Orb press feedback: 120 ms.
- Handset entrance: 240 ms, strong ease-out, originating from the docked edge.
- Handset exit: 180 ms.
- Screen change: 160 ms opacity and 6 px translation.
- Dragging is direct manipulation with boundary damping and pointer capture.
- Repeated navigation never waits for decorative motion.
- Reduced motion removes spatial travel while keeping brief opacity feedback.

Only transform and opacity are animated continuously. The dynamic island changes width only during generation or playback. The home screen uses a native twelve-line resonance curtain derived from the rain-curtain motion vocabulary; it has no pointer interaction, no external P5 runtime, pauses while generation or speech is active, and disappears under `prefers-reduced-motion`.

## Bilingual hierarchy

The source line is authoritative and is the default TTS input. The Chinese translation is supporting text and is never spoken unless the user explicitly changes the speech language.

## Responsive modes

- Desktop: a 390 by 790 logical handset, clamped to the viewport.
- Mobile WebView: a safe-area inset handset that fills the useful viewport while retaining a 5–6 px physical frame, rounded shell, inner glint, hardware rails, and external shadow.
- Very narrow screens: the shell radius and frame thickness reduce slightly, but the interface never becomes a borderless rectangle.