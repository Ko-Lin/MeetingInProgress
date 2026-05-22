# Meeting Progress Extension

Chrome extension for tracking agenda progress during Google Meet calls.

## Build Plan

**Scope:** Google Meet only for v1.

### Phase 1 — Scaffold ✓ Complete
- ✅ Manifest v3 with content script targeting `meet.google.com`
- ✅ Injected floating overlay (not side panel)
- ✅ Auto-detection of meeting-joined state
- ✅ Background service worker for timer management
- ✅ Agenda editor: add items with durations
- ✅ Quick parse: paste "Item 5 min" format
- ✅ Real-time progress bars (update every second)
- ✅ Per-item elapsed time display (e.g., "1m 30s / 5m")
- ✅ Over-time indicators (red badge showing "+Xm")
- ✅ Prev/Next buttons to navigate agenda
- ✅ Draggable overlay with saved position
- ✅ Minimize button to collapse overlay
- ✅ Manual "Inject Overlay" button as fallback
- ✅ Settings page for API key and preferences
- ✅ End-of-meeting summary storage (24h)

### Phase 2 — Refinements
- Better auto-detection of meeting state
- Keyboard shortcut fallback (Option+N / Alt+N)

### Phase 3 — Auto-hide & polish
- Auto-hide on screen share
- Border pulse at item overrun

### Phase 4 — Wrap-up suggestions
- Claude API integration for closing prompts
- Needs design pass before implementing

### Wrap-up suggestions (differentiating feature)
- Wrap button → Claude API for closing prompt
- API key in settings (chrome.storage.sync)
- Needs design pass before coding

## Known hard problems
- **Meet DOM instability:** Use `aria-label` and role selectors, fallback toggle
- **Host detection:** None reliable; treat all as potential hosts
- **API key first-run:** Need clear prompt, not blank input
