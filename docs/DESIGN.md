# Phoen design contract

## Aesthetic direction

Phoen uses a warm editorial surface with restrained industrial detail. Its recognition anchor is the voice seam: a narrow illuminated rail running down one side of the handset. The rail changes only to communicate audio and call state.

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

Only transform and opacity are animated continuously. The optional P5 lock screen is not part of version 0.1.

## Bilingual hierarchy

The source line is authoritative and is the default TTS input. The Chinese translation is supporting text and is never spoken unless the user explicitly changes the speech language.

## Responsive modes

- Desktop: a 360 by 720 logical handset, clamped to the viewport.
- Compact viewport: a borderless, safe-area-aware full-screen phone surface.
