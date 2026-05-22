let currentAgenda = [];
let currentIndex = 0;
let isScreenSharing = false;

// Listen for messages from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateProgress') {
    currentAgenda = request.agenda;
    currentIndex = request.currentIndex;
    const overlay = document.getElementById('meeting-progress-overlay');

    if (!overlay) {
      sendResponse({ success: false, error: 'Overlay not found' });
      return;
    }

    // If items aren't rendered yet, render them now
    if (overlay.querySelectorAll('.mp-item').length === 0) {
      renderAgendaItems(overlay);
    }

    updateOverlayProgress(request.agenda, request.currentIndex, request.overallProgress);
    sendResponse({ success: true });
  } else if (request.action === 'injectOverlay') {
    const existing = document.getElementById('meeting-progress-overlay');
    if (existing) {
      sendResponse({ success: true, message: 'Overlay already present' });
      return;
    }

    injectOverlay();
    sendResponse({ success: true });
  } else if (request.action === 'extractMeetingDescription') {
    const description = extractMeetingDescription();
    sendResponse({ success: true, description });
  } else if (request.action === 'parseDescriptionWithAI') {
    parseDescriptionWithAI(request.description, request.apiKey, (result) => {
      sendResponse(result);
    });
    return true; // Async response
  }
});

// Detect when meeting is joined by watching for Meet's UI elements
function detectMeetingJoined() {
  const isMeetingActive = () => {
    // Check for various indicators that a meeting is active
    // Be more lenient with detection - Google Meet DOM can vary

    // Check for video element (primary indicator)
    const hasVideo = !!document.querySelector('video');

    // Check for various leave/end call buttons
    const hasLeaveButton = !!document.querySelector('[aria-label*="Leave call"]') ||
                           !!document.querySelector('[aria-label*="End call"]') ||
                           !!document.querySelector('[aria-label*="leave"]');

    // Check for participant elements
    const hasParticipants = !!document.querySelector('[aria-label*="participant"]') ||
                            !!document.querySelector('[data-participant-id]') ||
                            document.querySelectorAll('video').length > 0;

    // Check for meet's main container (various possible selectors)
    const hasMainArea = !!document.querySelector('[role="main"]') ||
                        !!document.querySelector('[jsname="DvxXL"]') || // Meet's main container class
                        !!document.querySelector('[data-is-presenter]');

    // Check for call controls (microphone, camera, etc.)
    const hasCallControls = !!document.querySelector('[aria-label*="microphone"]') ||
                            !!document.querySelector('[aria-label*="camera"]') ||
                            !!document.querySelector('[aria-label*="mute"]');

    // If we're on meet.google.com and see multiple indicators, likely in a call
    const indicators = [hasVideo, hasLeaveButton, hasParticipants, hasMainArea, hasCallControls].filter(Boolean).length;

    return indicators >= 2; // At least 2 indicators suggest we're in a meeting
  };

  const observer = new MutationObserver(() => {
    if (isMeetingActive() && !document.getElementById('meeting-progress-overlay')) {
      console.log('[Meeting Progress] Meeting detected, injecting overlay');
      injectOverlay();
      observer.disconnect();
    }
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true
  });

  // Also check immediately
  if (isMeetingActive() && !document.getElementById('meeting-progress-overlay')) {
    console.log('[Meeting Progress] Meeting detected immediately, injecting overlay');
    injectOverlay();
  } else if (location.hostname === 'meet.google.com') {
    console.log('[Meeting Progress] On meet.google.com but no active meeting detected yet. Waiting...');
  }
}

function injectOverlay() {
  console.log('[Meeting Progress] Injecting overlay...');
  const overlay = document.createElement('div');
  overlay.id = 'meeting-progress-overlay';
  overlay.innerHTML = `
    <div class="mp-container">
      <div class="mp-header mp-draggable">
        <span class="mp-title">Meeting Progress</span>
        <div class="mp-header-buttons">
          <button class="mp-minimize" aria-label="Minimize">−</button>
          <button class="mp-close" aria-label="Close overlay">×</button>
        </div>
      </div>
      <div class="mp-controls mp-controls-top">
        <button class="mp-btn-prev" disabled>← Prev</button>
        <button class="mp-btn-next" disabled>Next →</button>
      </div>
      <div class="mp-content">
        <div class="mp-agenda-empty">Waiting for agenda...</div>
        <div class="mp-overall-bar">
          <div class="mp-progress" style="width: 0%"></div>
        </div>
      </div>
      <div class="mp-suggestion-area" style="display: none; padding: 12px 16px; border-top: 1px solid #e8eaed; background: #f8f9fa; font-size: 12px; color: #202124; line-height: 1.4;"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Load and apply stored styles
  chrome.storage.local.get(['overlayPosition'], (result) => {
    if (result.overlayPosition) {
      const { x, y } = result.overlayPosition;
      overlay.style.left = x + 'px';
      overlay.style.top = y + 'px';
    }
  });

  // Load borderPulse setting
  chrome.storage.sync.get(['borderPulse'], (result) => {
    overlay.dataset.borderPulseEnabled = result.borderPulse !== false ? 'true' : 'false';
  });

  // Inject styles
  injectStyles();

  // Set up close handler
  overlay.querySelector('.mp-close').addEventListener('click', () => {
    overlay.remove();
  });

  // Set up minimize handler
  overlay.querySelector('.mp-minimize').addEventListener('click', () => {
    const container = overlay.querySelector('.mp-container');
    container.classList.toggle('mp-minimized');
  });

  // Set up next button
  overlay.querySelector('.mp-btn-next').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'advanceItem' });
  });

  // Set up prev button
  overlay.querySelector('.mp-btn-prev').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'previousItem' });
  });

  // Set up wrap-up button
  chrome.storage.sync.get(['apiKey'], (result) => {
    const wrapupBtn = document.createElement('button');
    wrapupBtn.className = 'mp-btn-wrapup';
    wrapupBtn.textContent = '🎬 Wrap Up';
    wrapupBtn.title = 'Get AI suggestions for closing this agenda item';

    const controls = overlay.querySelector('.mp-controls');
    controls.appendChild(wrapupBtn);

    wrapupBtn.addEventListener('click', () => {
      if (!result.apiKey) {
        showSuggestion(overlay, 'Please set your Claude API key in settings', 'error');
        return;
      }

      generateWrapupSuggestion(overlay, currentAgenda, currentIndex, result.apiKey);
    });

    // Initially disable if no API key
    if (!result.apiKey) {
      wrapupBtn.disabled = true;
      wrapupBtn.style.opacity = '0.5';
      wrapupBtn.style.cursor = 'not-allowed';
    }
  });

  // Set up dragging
  makeDraggable(overlay);

  // Keep keyboard shortcut as bonus (still works if user tries)
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'n') {
      e.preventDefault();
      chrome.runtime.sendMessage({ action: 'advanceItem' });
    }
  });

  // Load current agenda
  chrome.storage.sync.get(['agenda'], (result) => {
    if (result.agenda && result.agenda.length > 0) {
      currentAgenda = result.agenda;
      renderAgendaItems(overlay);
    }
  });

  console.log('[Meeting Progress] Overlay injected successfully');
}

function renderAgendaItems(overlay) {
  const content = overlay.querySelector('.mp-content');

  if (currentAgenda.length === 0) {
    content.innerHTML = `
      <div class="mp-agenda-empty">No agenda set</div>
      <div class="mp-overall-bar">
        <div class="mp-progress" style="width: 0%"></div>
      </div>
    `;
    return;
  }

  const agendaHTML = currentAgenda
    .map(
      (item, index) => `
    <div class="mp-item ${index === currentIndex ? 'mp-item-active' : ''} ${index < currentIndex ? 'mp-item-completed' : ''}">
      <div class="mp-item-header">
        <div class="mp-item-name">${item.description}</div>
        <div class="mp-item-time-info">
          <span class="mp-item-elapsed">0m 0s</span>
          <span class="mp-item-divider">/</span>
          <span class="mp-item-time">${item.minutes}m</span>
          <span class="mp-item-overtime" style="display: none;"></span>
        </div>
      </div>
      <div class="mp-item-progress">
        <div class="mp-item-bar">
          <div class="mp-item-fill" style="width: 0%"></div>
        </div>
      </div>
    </div>
  `
    )
    .join('');

  content.innerHTML = `
    <div class="mp-agenda-items">
      ${agendaHTML}
    </div>
    <div class="mp-overall-section">
      <div class="mp-overall-label">Overall Progress</div>
      <div class="mp-overall-bar">
        <div class="mp-progress" style="width: 0%"></div>
      </div>
      <div class="mp-overall-time" style="display: none;"></div>
    </div>
  `;
}

function isUserScreenSharing() {
  // Check for "Stop sharing" button or screen share indicator
  const hasStopSharingBtn = !!document.querySelector('[aria-label*="Stop sharing"]') ||
                            !!document.querySelector('[aria-label*="sharing"]');
  return hasStopSharingBtn;
}

function updateOverlayVisibility() {
  const overlay = document.getElementById('meeting-progress-overlay');
  if (!overlay) return;

  const newSharingState = isUserScreenSharing();

  // If sharing state changed, update overlay visibility
  if (newSharingState !== isScreenSharing) {
    isScreenSharing = newSharingState;
    if (isScreenSharing) {
      // User started sharing - hide overlay
      overlay.style.display = 'none';
    } else {
      // User stopped sharing - show overlay
      overlay.style.display = '';
    }
  }
}

function updateOverlayProgress(agenda, index, overallProgress) {
  const overlay = document.getElementById('meeting-progress-overlay');
  if (!overlay) return;

  // Check screen share state and update visibility
  updateOverlayVisibility();

  const now = Date.now();
  const items = overlay.querySelectorAll('.mp-item');

  items.forEach((itemEl, i) => {
    const elapsedEl = itemEl.querySelector('.mp-item-elapsed');
    const itemBar = itemEl.querySelector('.mp-item-fill');
    const overtimeEl = itemEl.querySelector('.mp-item-overtime');

    if (i === index) {
      itemEl.classList.add('mp-item-active');
      itemEl.classList.remove('mp-item-completed');

      // Update current item's progress bar and elapsed time
      if (itemBar && agenda[i]) {
        // Calculate total elapsed time since meeting started
        const totalElapsedMs = now - agenda[0].startTime;
        const totalElapsedMinutes = totalElapsedMs / (1000 * 60);

        // Calculate time allocated to all previous items
        let previousItemsAllocated = 0;
        for (let j = 0; j < i; j++) {
          previousItemsAllocated += agenda[j].minutes;
        }

        // This item's elapsed time (including carryover from previous items)
        const itemElapsed = Math.max(0, totalElapsedMinutes - previousItemsAllocated);
        const itemProgress = Math.min(itemElapsed / agenda[i].minutes, 1);
        itemBar.style.width = Math.round(itemProgress * 100) + '%';

        // Display elapsed time
        const minutes = Math.floor(itemElapsed);
        const seconds = Math.round((itemElapsed - minutes) * 60);
        if (elapsedEl) {
          elapsedEl.textContent = `${minutes}m ${seconds}s`;
        }

        // Check if border pulse setting is enabled and item has <= 60 seconds remaining
        const borderPulseEnabled = overlay.dataset.borderPulseEnabled === 'true';
        const secondsRemaining = Math.max(0, (agenda[i].minutes - itemElapsed) * 60);
        if (borderPulseEnabled && secondsRemaining <= 60 && itemElapsed < agenda[i].minutes) {
          itemEl.classList.add('mp-pulse');
        } else {
          itemEl.classList.remove('mp-pulse');
        }

        // Show over-time badge if this item exceeded its allocated time
        if (itemElapsed > agenda[i].minutes) {
          const overTime = Math.round((itemElapsed - agenda[i].minutes) * 10) / 10;
          overtimeEl.textContent = `+${overTime.toFixed(1)}m`;
          overtimeEl.style.display = 'inline';
          overtimeEl.classList.add('mp-overtime-badge');
          itemEl.classList.add('mp-item-overtime');
          itemBar.classList.add('mp-fill-overtime');
          // Remove pulse once item goes overtime
          itemEl.classList.remove('mp-pulse');
        } else {
          overtimeEl.style.display = 'none';
          itemEl.classList.remove('mp-item-overtime');
          itemBar.classList.remove('mp-fill-overtime');
        }
      }
    } else if (i < index) {
      itemEl.classList.add('mp-item-completed');
      itemEl.classList.remove('mp-item-active');

      // Completed items show full bar
      if (itemBar) itemBar.style.width = '100%';

      // Show actual elapsed time for completed items (including any overrun)
      if (agenda[i] && elapsedEl) {
        const totalElapsedMs = now - agenda[0].startTime;
        const totalElapsedMinutes = totalElapsedMs / (1000 * 60);

        let previousItemsAllocated = 0;
        for (let j = 0; j < i; j++) {
          previousItemsAllocated += agenda[j].minutes;
        }

        const itemElapsed = Math.max(0, totalElapsedMinutes - previousItemsAllocated);
        const minutes = Math.floor(itemElapsed);
        const seconds = Math.round((itemElapsed - minutes) * 60);
        elapsedEl.textContent = `${minutes}m ${seconds}s`;
      }

      if (overtimeEl) overtimeEl.style.display = 'none';
    } else {
      itemEl.classList.remove('mp-item-active', 'mp-item-completed');

      // Future items show empty bar
      if (itemBar) itemBar.style.width = '0%';

      // Show 0 elapsed for future items
      if (elapsedEl) {
        elapsedEl.textContent = '0m 0s';
      }

      if (overtimeEl) overtimeEl.style.display = 'none';
    }
  });

  // Update overall progress bar
  const progressBar = overlay.querySelector('.mp-progress');
  const progressPct = Math.round(overallProgress * 100);
  progressBar.style.width = progressPct + '%';

  // Color based on progress
  if (overallProgress >= 0.9) {
    progressBar.classList.add('red');
    progressBar.classList.remove('amber');
  } else if (overallProgress >= 0.6) {
    progressBar.classList.add('amber');
    progressBar.classList.remove('red');
  } else {
    progressBar.classList.remove('amber', 'red');
  }

  // Update time display
  if (agenda && agenda.length > 0) {
    const now = Date.now();
    const totalElapsedMs = now - agenda[0].startTime;
    const totalElapsedMinutes = totalElapsedMs / (1000 * 60);
    const totalDurationMinutes = agenda.reduce((sum, item) => sum + item.minutes, 0);

    const elapsedMins = Math.floor(totalElapsedMinutes);
    const elapsedSecs = Math.round((totalElapsedMinutes - elapsedMins) * 60);

    const timeEl = overlay.querySelector('.mp-overall-time');
    timeEl.textContent = `${elapsedMins}m ${elapsedSecs}s / ${totalDurationMinutes}m`;
    timeEl.style.display = 'block';
  }

  // Update button states
  const prevBtn = overlay.querySelector('.mp-btn-prev');
  const nextBtn = overlay.querySelector('.mp-btn-next');
  if (prevBtn && nextBtn) {
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index >= agenda.length - 1;
  }
}

function injectStyles() {
  if (document.getElementById('meeting-progress-styles')) return;

  const style = document.createElement('style');
  style.id = 'meeting-progress-styles';
  style.textContent = `
    #meeting-progress-overlay {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      user-select: none;
    }

    .mp-container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
      width: 300px;
      overflow: hidden;
      max-height: 500px;
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .mp-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: #f8f9fa;
      border-bottom: 1px solid #e0e0e0;
      flex-shrink: 0;
      cursor: grab;
    }

    .mp-header:active {
      cursor: grabbing;
    }

    .mp-draggable {
      user-select: none;
    }

    .mp-title {
      font-weight: 600;
      font-size: 14px;
      color: #202124;
    }

    .mp-header-buttons {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .mp-minimize,
    .mp-close {
      background: none;
      border: none;
      font-size: 20px;
      color: #5f6368;
      cursor: pointer;
      padding: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .mp-minimize:hover,
    .mp-close:hover {
      color: #202124;
    }

    .mp-content {
      padding: 16px;
      overflow-y: auto;
      flex: 1;
    }

    .mp-agenda-empty {
      color: #80868b;
      font-size: 13px;
      text-align: center;
      padding: 20px 0;
    }

    .mp-agenda-items {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 12px;
    }

    .mp-item {
      padding: 8px;
      border-radius: 6px;
      border-left: 3px solid #dadce0;
      background: #f8f9fa;
      font-size: 12px;
    }

    .mp-item-active {
      border-left-color: #1f73e8;
      background: #e8f0fe;
      border: 1px solid #1f73e8;
      border-left: 3px solid #1f73e8;
    }

    .mp-item-completed {
      border-left-color: #34a853;
      opacity: 0.6;
    }

    .mp-item-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 4px;
    }

    .mp-item-name {
      font-weight: 500;
      color: #202124;
      flex: 1;
    }

    .mp-item-time-info {
      display: flex;
      align-items: center;
      gap: 3px;
      flex-shrink: 0;
      margin-left: 8px;
    }

    .mp-item-elapsed {
      color: #5f6368;
      font-size: 11px;
      white-space: nowrap;
      font-family: monospace;
      font-weight: 500;
    }

    .mp-item-divider {
      color: #dadce0;
      font-size: 10px;
    }

    .mp-item-time {
      color: #5f6368;
      font-size: 11px;
      white-space: nowrap;
    }

    .mp-item-overtime {
      border-left: 1px solid #dadce0;
      padding-left: 3px;
      margin-left: 2px;
    }

    .mp-overtime-badge {
      color: #ea4335;
      font-weight: 600;
      font-size: 11px;
      white-space: nowrap;
    }

    .mp-item-bar {
      height: 6px;
      background: #e8eaed;
      border-radius: 3px;
      overflow: hidden;
    }

    .mp-item-fill {
      height: 100%;
      background: #34a853;
      transition: width 0.15s ease-out;
    }

    .mp-item-active .mp-item-fill {
      background: #1f73e8;
    }

    .mp-item-overtime {
      border-left-color: #ea4335 !important;
    }

    .mp-fill-overtime {
      background: #ea4335 !important;
    }

    .mp-item-overtime .mp-item-name {
      color: #ea4335;
    }

    .mp-overall-section {
      padding-top: 8px;
      border-top: 1px solid #e8eaed;
    }

    .mp-overall-label {
      font-size: 11px;
      color: #5f6368;
      text-transform: uppercase;
      font-weight: 600;
      margin-bottom: 6px;
    }

    .mp-overall-time {
      font-size: 11px;
      color: #5f6368;
      text-align: center;
      margin-top: 6px;
      font-family: monospace;
      font-weight: 500;
    }

    .mp-overall-bar {
      height: 8px;
      background: #e8eaed;
      border-radius: 4px;
      overflow: hidden;
    }

    .mp-progress {
      height: 100%;
      background: #34a853;
      transition: background-color 0.3s, width 0.2s;
    }

    .mp-progress.amber {
      background: #fbbc04;
    }

    .mp-progress.red {
      background: #ea4335;
    }

    .mp-controls {
      display: flex;
      gap: 8px;
      padding: 12px 16px;
      flex-shrink: 0;
    }

    .mp-controls-top {
      border-bottom: 1px solid #e8eaed;
      order: -1;
    }

    .mp-btn-prev,
    .mp-btn-next {
      flex: 1;
      padding: 8px 12px;
      background: white;
      border: 1px solid #dadce0;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      color: #1f73e8;
      transition: all 0.2s;
    }

    .mp-btn-prev:hover:not(:disabled),
    .mp-btn-next:hover:not(:disabled) {
      background: #f8f9fa;
      border-color: #1f73e8;
    }

    .mp-btn-prev:disabled,
    .mp-btn-next:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .mp-btn-wrapup {
      width: 100%;
      padding: 8px 12px;
      background: #1f73e8;
      border: none;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      color: white;
      transition: all 0.2s;
      margin-top: 8px;
    }

    .mp-btn-wrapup:hover:not(:disabled) {
      background: #1665d0;
    }

    .mp-btn-wrapup:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .mp-suggestion-area {
      max-height: 120px;
      overflow-y: auto;
    }

    .mp-suggestion-loading {
      color: #5f6368;
      font-style: italic;
    }

    .mp-suggestion-error {
      color: #ea4335;
    }

    .mp-suggestion-success {
      color: #0f652d;
      font-weight: 500;
    }

    .mp-container.mp-minimized {
      height: auto;
    }

    .mp-container.mp-minimized .mp-content {
      display: none;
    }

    .mp-container.mp-minimized .mp-suggestion-area {
      display: none;
    }

    .mp-container.mp-minimized .mp-controls-top {
      display: flex;
    }

    .mp-container.mp-minimized {
      width: 220px;
    }

    @keyframes pulseOutline {
      0%, 100% {
        box-shadow: inset 0 0 0 2px rgba(251, 188, 4, 0.8);
      }
      50% {
        box-shadow: inset 0 0 0 2px rgba(251, 188, 4, 0.3);
      }
    }

    .mp-pulse {
      animation: pulseOutline 0.6s ease-in-out infinite !important;
    }
  `;
  document.head.appendChild(style);
}

function showSuggestion(overlay, message, type) {
  const area = overlay.querySelector('.mp-suggestion-area');
  area.innerHTML = `<div class="mp-suggestion-${type}">${message}</div>`;
  area.style.display = 'block';

  // Auto-hide after 5 seconds unless it's an error
  if (type !== 'error') {
    setTimeout(() => {
      area.style.display = 'none';
    }, 5000);
  }
}

let lastWrapupCall = 0;

async function generateWrapupSuggestion(overlay, agenda, index, apiKey) {
  // Debounce: only allow 1 API call every 10 seconds
  const now = Date.now();
  if (now - lastWrapupCall < 10000) {
    showSuggestion(overlay, 'Please wait before requesting another suggestion', 'error');
    return;
  }
  lastWrapupCall = now;

  if (!agenda || index < 0 || index >= agenda.length) {
    showSuggestion(overlay, 'No current agenda item', 'error');
    return;
  }

  const currentItem = agenda[index];

  // Calculate elapsed and remaining time
  const totalElapsedMs = Date.now() - agenda[0].startTime;
  const totalElapsedMinutes = totalElapsedMs / (1000 * 60);

  let previousItemsAllocated = 0;
  for (let i = 0; i < index; i++) {
    previousItemsAllocated += agenda[i].minutes;
  }

  const itemElapsed = Math.max(0, totalElapsedMinutes - previousItemsAllocated);
  const itemRemaining = Math.max(0, currentItem.minutes - itemElapsed);

  showSuggestion(overlay, 'Getting suggestion...', 'loading');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: `The meeting is discussing "${currentItem.description}". We've spent ${Math.round(itemElapsed)} minutes on this and have ${Math.round(itemRemaining)} minutes remaining. Suggest a brief closing statement in 1 sentence to wrap this up.`
          }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      if (response.status === 401) {
        showSuggestion(overlay, 'API key invalid', 'error');
      } else {
        showSuggestion(overlay, `API error: ${error.error?.message || 'Unknown error'}`, 'error');
      }
      return;
    }

    const data = await response.json();
    const suggestion = data.content?.[0]?.text || 'No suggestion generated';
    showSuggestion(overlay, suggestion, 'success');
  } catch (error) {
    showSuggestion(overlay, `Error: ${error.message}`, 'error');
  }
}

function extractMeetingDescription() {
  // Try multiple selectors to find the meeting description
  const selectors = [
    // Google Meet details panel
    '[aria-label*="description" i]',
    '[aria-label*="Details" i]',
    '[aria-label*="info" i]',
    // Various Meet DOM structures
    '[data-tooltip*="description" i]',
    // Text content that might contain description
    'div[role="document"]',
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const text = element.textContent?.trim();
      if (text && text.length > 20) { // Must be substantial
        return text;
      }
    }
  }

  // Try to find description in the main content area
  const mainArea = document.querySelector('[role="main"]');
  if (mainArea) {
    const allText = mainArea.textContent;
    // Look for common patterns like "Agenda:" or bullet points
    if (allText && allText.includes('agenda')) {
      return allText;
    }
  }

  return null;
}

async function parseDescriptionWithAI(description, apiKey, callback) {
  if (!description) {
    callback({ success: false, error: 'No description found' });
    return;
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: `Extract agenda items from this meeting description. Return a JSON array with objects like {description: "item name", minutes: estimated_minutes}.

Only return the JSON array, no other text. If no specific times are mentioned, estimate 5-10 minutes per item.

Meeting description:
${description}`
          }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      callback({
        success: false,
        error: error.error?.message || 'API error'
      });
      return;
    }

    const data = await response.json();
    const responseText = data.content?.[0]?.text || '';

    // Parse the JSON response
    try {
      const agenda = JSON.parse(responseText);
      if (Array.isArray(agenda)) {
        callback({
          success: true,
          agenda: agenda.map(item => ({
            description: item.description || item.name || '',
            minutes: parseInt(item.minutes) || 5
          })).filter(item => item.description)
        });
      } else {
        callback({
          success: false,
          error: 'Invalid response format'
        });
      }
    } catch (e) {
      callback({
        success: false,
        error: 'Failed to parse AI response'
      });
    }
  } catch (error) {
    callback({
      success: false,
      error: error.message
    });
  }
}

function makeDraggable(element) {
  const container = element.querySelector('.mp-container');
  const header = element.querySelector('.mp-header');
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

  header.addEventListener('mousedown', dragStart);

  function dragStart(e) {
    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.addEventListener('mouseup', dragStop);
    document.addEventListener('mousemove', dragMove);
  }

  function dragMove(e) {
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;

    const top = element.offsetTop - pos2;
    const left = element.offsetLeft - pos1;

    element.style.top = top + 'px';
    element.style.left = left + 'px';

    // Save position
    chrome.storage.local.set({
      overlayPosition: { x: left, y: top }
    });
  }

  function dragStop() {
    document.removeEventListener('mouseup', dragStop);
    document.removeEventListener('mousemove', dragMove);
  }
}

// Start detection when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', detectMeetingJoined);
} else {
  detectMeetingJoined();
}
