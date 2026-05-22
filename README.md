# Meeting Progress

A Chrome extension for tracking agenda progress during Google Meet calls.

## Phase 1 ✓ — Scaffold

The extension is now scaffolded and ready for testing.

### Features (Phase 1)

- **Floating overlay** — Appears automatically when you join a Google Meet call (or use "📍 Inject Overlay" button)
- **Draggable & minimizable** — Drag the header to move; click − to collapse
- **Agenda editor** — Add items with durations in the popup
- **Quick parse** — Paste lines like "Welcome 5 min" and auto-extract agenda
- **Real-time progress bars** — Updates every 5 seconds during meeting
- **Over-time alerts** — Item text/bar turns red with "+Xm" badge when overrun
- **Prev/Next buttons** — Click to navigate through agenda (smart disable at edges)
- **Keyboard shortcut** — `Option+N` (Mac) / `Alt+N` (Windows) also works
- **Settings** — Configure API key and display options

### Files

```
extension/
├── manifest.json           # Manifest v3 configuration
├── content.js              # Injects overlay, detects meeting join
├── background.js           # Service worker, timer logic
├── popup.html/js           # Agenda editor UI
├── options.html/js         # Settings page
└── README.md
```

## Local Testing

### Load the extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` directory from this project

### Test the flow

1. Go to https://meet.google.com and start/join a call
2. Click the extension icon in the toolbar → "Meeting Progress" popup appears
3. Click **"📍 Inject Overlay"** button (yellow, if overlay hasn't appeared yet)
4. Add agenda items:
   - Type "Welcome" + "5" → Click Add
   - Or paste:
     ```
     Intro 5 min
     Demo 15 min
     Q&A 10 min
     ```
     Then click Parse and Add
5. Click **Start Timer** when meeting is ready
6. The overlay appears on the right with:
   - Current item highlighted in blue
   - Progress bars for each item
   - Overall progress bar (green → amber at 60% → red at 90%)
   - **Next/Prev buttons** to navigate
7. When an item exceeds its time limit:
   - Item name turns **red**
   - Progress bar turns **red**
   - Displays **"+Xm"** showing minutes over
8. Click **−** to minimize overlay, or drag to reposition
9. Click **×** to close the overlay

### Known issues in Phase 1

- **Auto-detection** — Overlay may not auto-inject; use "📍 Inject Overlay" button as fallback
- **No wrap-up feature yet** — Phase 4 feature, depends on Claude API key in settings

## Next phases

- **Phase 2** — Auto-detect meeting state more reliably
- **Phase 3** — Implement `chrome.alarms` timer sync and real progress tracking
- **Phase 4** — Draggable overlay, collapse to pill, auto-hide on screen share, end-of-meeting summary
- **Wrap-up suggestions** — Claude API integration for closing prompts

## Settings

Click the ⚙️ icon in the popup to open settings:
- **API Key** — Optional. For Phase 4 wrap-up suggestions (leave blank for now)
- **Border pulse** — Visual nudge at 60s warning (default: on)
- **Default position** — Where overlay appears (default: top right)

**Note:** All Phase 1-3 features work without an API key.

## Technical notes

- Uses `chrome.storage.sync` for agenda persistence across devices
- Uses `chrome.alarms` for background timer (survives tab switching)
- Content script targets `meet.google.com` with Manifest v3
- Relies on `data-is-meeting-joined="true"` attribute for join detection
- Keyboard events use `Alt+N` to avoid conflicts with Meet hotkeys
