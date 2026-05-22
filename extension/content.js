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

    updateOverlayProgress(request.agenda, request.currentIndex, request.overallProgress, request.meetingEndTime);
    sendResponse({ success: true });
  } else if (request.action === 'injectOverlay') {
    const existing = document.getElementById('meeting-progress-overlay');
    if (existing) {
      sendResponse({ success: true, message: 'Overlay already present' });
      return;
    }

    injectOverlay();
    sendResponse({ success: true });
  } else if (request.action === 'removeOverlay') {
    const overlay = document.getElementById('meeting-progress-overlay');
    if (overlay) {
      overlay.remove();
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Overlay not found' });
    }
  } else if (request.action === 'checkOverlayStatus') {
    const overlay = document.getElementById('meeting-progress-overlay');
    sendResponse({ overlayInjected: !!overlay });
  } else if (request.action === 'extractMeetingDescription') {
    const description = extractMeetingDescription();
    if (description) {
      const items = parseDescriptionToAgenda(description);
      sendResponse({ success: true, description, items });
    } else {
      sendResponse({ success: false, error: 'No description found' });
    }
  }
});

// Drawer management functions
function setupDrawerHandlers(overlay) {
  const drawer = overlay.querySelector('.mp-side-drawer');
  const drawerToggle = overlay.querySelector('.mp-drawer-toggle');
  const drawerClose = overlay.querySelector('.mp-drawer-close');
  const parseBtn = overlay.querySelector('.mp-overlay-parse-btn');
  const startTimerBtn = overlay.querySelector('.mp-overlay-start-timer-btn');
  const pasteInput = overlay.querySelector('.mp-overlay-paste-input');
  const startTimeInput = overlay.querySelector('.mp-overlay-start-time-input');
  const templateSelect = overlay.querySelector('.mp-overlay-template-select');
  const loadTemplateBtn = overlay.querySelector('.mp-overlay-load-template-btn');
  const addItemBtn = overlay.querySelector('.mp-overlay-add-item-btn');

  // Load templates into dropdown
  loadTemplatesIntoDropdown(templateSelect);

  // Handle load template button
  loadTemplateBtn.addEventListener('click', () => {
    const selectedValue = templateSelect.value;
    if (!selectedValue) {
      console.log('[Meeting Progress] No template selected');
      return;
    }

    chrome.storage.sync.get(['templates'], (result) => {
      const templates = result.templates || [];
      const selectedIndex = parseInt(selectedValue);
      const template = templates[selectedIndex];

      if (template && template.items) {
        // Build template text to populate into Quick Parse textarea
        let templateText = '';

        // Add start time if present
        if (template.startTime) {
          templateText += template.startTime + '\n';
        }

        // Add items
        templateText += template.items
          .map(item => `${item.description} ${item.minutes}m`)
          .join('\n');

        // Add end time if present
        if (template.endTime) {
          templateText += '\n' + template.endTime;
        }

        // Populate the Quick Parse textarea
        pasteInput.value = templateText;
        console.log(`[Meeting Progress] Loaded template into Quick Parse: ${template.name}`);

        // Reset dropdown
        templateSelect.value = '';
      }
    });
  });

  // Toggle drawer visibility with animation
  drawerToggle.addEventListener('click', () => {
    const isOpen = drawer.style.display !== 'none';
    if (isOpen) {
      drawer.classList.add('closing');
      setTimeout(() => {
        drawer.style.display = 'none';
        drawer.classList.remove('closing');
      }, 300);
    } else {
      drawer.style.display = 'block';
    }
  });

  // Close drawer with animation
  drawerClose.addEventListener('click', () => {
    drawer.classList.add('closing');
    setTimeout(() => {
      drawer.style.display = 'none';
      drawer.classList.remove('closing');
    }, 300);
  });

  // Close drawer when clicking overlay outside drawer
  document.addEventListener('click', (e) => {
    if (drawer.style.display !== 'none' &&
        !drawer.contains(e.target) &&
        !drawerToggle.contains(e.target) &&
        !overlay.querySelector('.mp-container').contains(e.target)) {
      drawer.classList.add('closing');
      setTimeout(() => {
        drawer.style.display = 'none';
        drawer.classList.remove('closing');
      }, 300);
    }
  });

  // Parse and add
  parseBtn.addEventListener('click', () => overlayParseAndAdd(overlay));

  // Add individual item
  addItemBtn.addEventListener('click', () => overlayAddItem(overlay));

  // Start timer
  startTimerBtn.addEventListener('click', () => overlayStartTimer(overlay));
}

function loadTemplatesIntoDropdown(selectElement) {
  if (!selectElement) {
    console.log('[Meeting Progress] Template select element not found');
    return;
  }

  chrome.storage.sync.get(['templates'], (result) => {
    const templates = result.templates || [];
    console.log('[Meeting Progress] Loaded templates from storage:', templates);

    // Clear existing options (except the first placeholder)
    while (selectElement.options.length > 1) {
      selectElement.removeChild(selectElement.lastChild);
    }

    // Add template options
    templates.forEach((template, index) => {
      const option = document.createElement('option');
      option.value = index.toString();
      option.textContent = template.name;
      selectElement.appendChild(option);
      console.log(`[Meeting Progress] Added template option: ${template.name}`);
    });

    if (templates.length === 0) {
      console.log('[Meeting Progress] No templates found');
    }
  });
}

function overlayAddItem(overlay) {
  const itemInput = overlay.querySelector('.mp-overlay-item-input');
  const minutesInput = overlay.querySelector('.mp-overlay-minutes-input');

  const description = itemInput.value.trim();
  const minutes = parseInt(minutesInput.value) || 0;

  if (!description || minutes <= 0) {
    console.log('[Meeting Progress] Invalid item');
    return;
  }

  currentAgenda.push({
    id: Date.now() + Math.random(),
    description,
    minutes,
    startTime: null
  });

  chrome.storage.sync.set({ agenda: currentAgenda });
  itemInput.value = '';
  minutesInput.value = '5';
  renderAgendaItems(overlay);
  console.log('[Meeting Progress] Item added');
}

function overlayParseAndAdd(overlay) {
  const pasteInput = overlay.querySelector('.mp-overlay-paste-input');
  const startTimeInput = overlay.querySelector('.mp-overlay-start-time-input');
  const text = pasteInput.value.trim();

  if (!text) {
    console.log('[Meeting Progress] No text to parse');
    return;
  }

  let lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const timePattern = /^(\d{1,2}):(\d{2})$/;
  let parsed = 0;
  let endTime = null;

  // Clear the agenda to replace it
  currentAgenda = [];

  // Check if first line is a time (HH:MM format) - start time
  if (lines.length > 0 && timePattern.test(lines[0])) {
    const timeMatch = lines[0].match(timePattern);
    const hours = timeMatch[1].padStart(2, '0');
    const minutes = timeMatch[2];
    startTimeInput.value = `${hours}:${minutes}`;
    console.log('[Meeting Progress] Start time set to ' + startTimeInput.value);
    lines = lines.slice(1);
  }

  // Check if last line is a time (HH:MM format) - end time (store it)
  if (lines.length > 0 && timePattern.test(lines[lines.length - 1])) {
    const endTimeMatch = lines[lines.length - 1].match(timePattern);
    const hours = endTimeMatch[1].padStart(2, '0');
    const minutes = endTimeMatch[2];
    endTime = `${hours}:${minutes}`;
    console.log('[Meeting Progress] Meeting end time: ' + endTime);
    lines = lines.slice(0, -1);
  }

  const durationOnlyPattern = /^(.+?)\s+(\d+)\s*(?:min(?:ute)?s?|m)$/i;

  lines.forEach((line) => {
    const match = line.match(durationOnlyPattern);
    if (match) {
      currentAgenda.push({
        id: Date.now() + Math.random(),
        description: match[1].trim(),
        minutes: parseInt(match[2], 10),
        startTime: null
      });
      parsed++;
    }
  });

  if (parsed > 0) {
    // Store end time if it was parsed
    if (endTime) {
      currentAgenda.meetingEndTime = endTime;
    }
    chrome.storage.sync.set({ agenda: currentAgenda });
    // Don't clear pasteInput - keep it so user can quickly modify and re-parse
    renderAgendaItems(overlay);
    console.log(`[Meeting Progress] Parsed and updated agenda with ${parsed} items`);
  } else if (lines.length > 0) {
    console.log('[Meeting Progress] No valid items found in parse');
  }
}

function overlayDeleteItem(overlay, itemId) {
  currentAgenda = currentAgenda.filter((item) => item.id !== itemId);
  chrome.storage.sync.set({ agenda: currentAgenda });
  renderAgendaItems(overlay);
}

function overlayStartTimer(overlay) {
  if (currentAgenda.length === 0) return;

  const startTimeInput = overlay.querySelector('.mp-overlay-start-time-input');
  let startTime = Date.now();

  // If a start time was specified, use that instead
  if (startTimeInput && startTimeInput.value) {
    const [hours, minutes] = startTimeInput.value.split(':');
    const today = new Date();
    today.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    startTime = today.getTime();

    console.log('[Meeting Progress] Start time set to ' + startTimeInput.value);
  }

  currentAgenda.forEach((item) => {
    if (item.startTime === null) {
      item.startTime = startTime;
    }
  });

  chrome.storage.sync.set({ agenda: currentAgenda });

  chrome.runtime.sendMessage({ action: 'startTimer', agenda: currentAgenda }, (response) => {
    if (response?.success) {
      const startTimeFormatted = new Date(startTime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      console.log(`[Meeting Progress] Timer started at ${startTimeFormatted}`);
      // Close drawer after starting
      const drawer = overlay.querySelector('.mp-side-drawer');
      drawer.classList.add('closing');
      setTimeout(() => {
        drawer.style.display = 'none';
        drawer.classList.remove('closing');
      }, 300);
    }
  });
}

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
          <button class="mp-drawer-toggle" aria-label="Toggle agenda drawer" title="Edit agenda">📋</button>
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

      <!-- Side drawer for agenda management -->
      <div class="mp-side-drawer" style="display: none;">
        <div class="mp-drawer-header">
          <span>Agenda</span>
          <button class="mp-drawer-close" aria-label="Close drawer">×</button>
        </div>

        <div class="mp-drawer-content">
          <!-- Hidden start time input for timer -->
          <input type="time" class="mp-overlay-start-time-input" style="display: none;">

          <!-- Load Template Section -->
          <div class="mp-drawer-section">
            <label class="mp-drawer-label">Load Template</label>
            <select class="mp-overlay-template-select" style="width: 100%; padding: 8px; border: 1px solid #dadce0; border-radius: 4px; font-size: 12px; margin-bottom: 6px;">
              <option value="">Select a template...</option>
            </select>
            <button class="mp-overlay-load-template-btn" style="width: 100%; padding: 8px 12px; background: #34a853; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;">Load Template</button>
            <div style="font-size: 11px; color: #5f6368; margin-top: 6px;">Quickly load preset agenda items from your templates</div>
          </div>

          <!-- Quick Parse Section -->
          <div class="mp-drawer-section">
            <label class="mp-drawer-label">Quick Parse</label>
            <textarea class="mp-overlay-paste-input" placeholder="11:00&#10;Warm up 5m&#10;Stand up 20m&#10;Tech dive 20m&#10;11:55" style="width: 100%; height: 100px; padding: 8px; border: 1px solid #dadce0; border-radius: 4px; font-size: 11px; font-family: monospace; resize: vertical;"></textarea>
            <div style="font-size: 11px; color: #5f6368; margin-top: 4px;">Start time (opt), items, end time (opt). Times as HH:MM. Items as "Name Xm"</div>
            <button class="mp-overlay-parse-btn" style="width: 100%; margin-top: 6px; padding: 8px 12px; background: white; color: #1f73e8; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;">Parse and Update</button>
          </div>

          <!-- Add Item Section -->
          <div class="mp-drawer-section">
            <label class="mp-drawer-label">Add Item</label>
            <div style="display: flex; gap: 6px; margin-bottom: 6px;">
              <input type="text" class="mp-overlay-item-input" placeholder="Item name" style="flex: 1; padding: 6px; border: 1px solid #dadce0; border-radius: 4px; font-size: 12px;">
              <input type="number" class="mp-overlay-minutes-input" placeholder="min" min="1" value="5" style="width: 50px; padding: 6px; border: 1px solid #dadce0; border-radius: 4px; font-size: 12px;">
            </div>
            <button class="mp-overlay-add-item-btn" style="width: 100%; padding: 6px 12px; background: white; color: #1f73e8; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;">+ Add</button>
          </div>

          <!-- Start Timer Section -->
          <div class="mp-drawer-section">
            <button class="mp-overlay-start-timer-btn" style="width: 100%; padding: 8px 12px; background: #1f73e8; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500;">Start Timer</button>
          </div>
        </div>
      </div>
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

  // Load current agenda and render in drawer
  chrome.storage.sync.get(['agenda'], (result) => {
    if (result.agenda && result.agenda.length > 0) {
      currentAgenda = result.agenda;
      renderAgendaItems(overlay);
    }
  });

  // Set up drawer toggle
  setupDrawerHandlers(overlay);

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
    <div class="mp-item ${index === currentIndex ? 'mp-item-active' : ''} ${index < currentIndex ? 'mp-item-completed' : ''}" data-item-id="${item.id}">
      <div class="mp-item-header">
        <div class="mp-item-name">${item.description}</div>
        <div class="mp-item-time-info">
          <span class="mp-item-elapsed">0m 0s</span>
          <span class="mp-item-divider">/</span>
          <span class="mp-item-time">${item.minutes}m</span>
          <span class="mp-item-overtime" style="display: none;"></span>
          <button class="mp-item-delete" data-item-id="${item.id}" title="Delete item" style="background: none; border: none; color: #ea4335; cursor: pointer; padding: 0; margin-left: 4px; font-size: 14px;">✕</button>
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
      <div class="mp-meeting-times" style="display: none;"></div>
    </div>
  `;

  // Add delete button handlers
  const deleteButtons = content.querySelectorAll('.mp-item-delete');
  deleteButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const itemId = parseInt(btn.dataset.itemId);
      deleteAgendaItemFromOverlay(itemId);
    });
  });
}

function deleteAgendaItemFromOverlay(itemId) {
  // Remove item from currentAgenda
  currentAgenda = currentAgenda.filter((item) => item.id !== itemId);

  // Save updated agenda
  chrome.storage.sync.set({ agenda: currentAgenda });

  // Re-render the agenda items
  const overlay = document.getElementById('meeting-progress-overlay');
  if (overlay) {
    renderAgendaItems(overlay);
  }

  console.log(`[Meeting Progress] Item ${itemId} deleted from overlay`);
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

function updateOverlayProgress(agenda, index, overallProgress, meetingEndTime) {
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

    // Calculate overtime
    const overtimeMinutes = totalElapsedMinutes - totalDurationMinutes;
    let timeText = `${elapsedMins}m ${elapsedSecs}s / ${totalDurationMinutes}m`;

    const timeEl = overlay.querySelector('.mp-overall-time');
    if (overtimeMinutes > 0.1) { // Show overtime if more than 6 seconds
      const overtimeMins = Math.floor(overtimeMinutes);
      const overtimeSecs = Math.round((overtimeMinutes - overtimeMins) * 60);
      timeText += ` (+${overtimeMins}m ${overtimeSecs}s over)`;
      timeEl.classList.add('overtime');
    } else {
      timeEl.classList.remove('overtime');
    }

    timeEl.textContent = timeText;
    timeEl.style.display = 'block';

    // Calculate and display meeting times
    const startTimeMs = agenda[0].startTime;
    const startDate = new Date(startTimeMs);
    const startTimeStr = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    // Scheduled end time
    let scheduledEndMs, scheduledEndDate, scheduledEndStr;

    if (meetingEndTime) {
      // Use the specified end time from template
      const [endHours, endMinutes] = meetingEndTime.split(':').map(Number);
      scheduledEndDate = new Date(startTimeMs);
      scheduledEndDate.setHours(endHours, endMinutes, 0, 0);
      scheduledEndMs = scheduledEndDate.getTime();
      scheduledEndStr = scheduledEndDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } else {
      // Calculate from start time + duration
      scheduledEndMs = startTimeMs + (totalDurationMinutes * 60 * 1000);
      scheduledEndDate = new Date(scheduledEndMs);
      scheduledEndStr = scheduledEndDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }

    // Actual end time (if running over)
    const actualEndMs = now;
    const actualEndDate = new Date(actualEndMs);
    const actualEndStr = actualEndDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    let timesText = `Started: ${startTimeStr}<br>Ends: ${scheduledEndStr}`;
    if (overtimeMinutes > 0.1) {
      timesText += `<br><span style="color: #ea4335;">Actually: ${actualEndStr}</span>`;
    }

    const timesEl = overlay.querySelector('.mp-meeting-times');
    timesEl.innerHTML = timesText;
    timesEl.style.display = 'block';
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

    .mp-item-delete {
      opacity: 0.5;
      transition: opacity 0.2s, color 0.2s;
    }

    .mp-item-delete:hover {
      opacity: 1;
      color: #d33b27;
    }

    .mp-item:hover .mp-item-delete {
      opacity: 0.7;
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
      line-height: 1.4;
    }

    .mp-overall-time.overtime {
      color: #ea4335;
      font-weight: 600;
    }

    .mp-meeting-times {
      font-size: 10px;
      color: #5f6368;
      text-align: center;
      margin-top: 8px;
      line-height: 1.6;
      font-family: monospace;
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

    /* Side drawer styles */
    .mp-side-drawer {
      position: fixed;
      top: 0;
      right: 0;
      width: 300px;
      height: 100vh;
      background: white;
      box-shadow: -2px 0 8px rgba(0, 0, 0, 0.15);
      z-index: 9999;
      display: flex;
      flex-direction: column;
      animation: slideInRight 0.3s ease-out;
      overflow: hidden;
    }

    @keyframes slideInRight {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }

    @keyframes slideOutRight {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(100%);
        opacity: 0;
      }
    }

    .mp-side-drawer.closing {
      animation: slideOutRight 0.3s ease-in forwards;
    }

    .mp-drawer-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      background: #f8f9fa;
      border-bottom: 1px solid #e8eaed;
      font-weight: 600;
      font-size: 14px;
      color: #202124;
      flex-shrink: 0;
    }

    .mp-drawer-close {
      background: none;
      border: none;
      font-size: 18px;
      color: #5f6368;
      cursor: pointer;
      padding: 4px;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .mp-drawer-close:hover {
      color: #202124;
      background: #e8eaed;
      border-radius: 4px;
    }

    .mp-drawer-content {
      padding: 16px;
      overflow-y: auto;
      flex: 1;
    }

    .mp-drawer-section {
      margin-bottom: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .mp-drawer-section:last-child {
      margin-bottom: 0;
    }

    .mp-drawer-label {
      font-size: 11px;
      font-weight: 600;
      color: #5f6368;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .mp-drawer-input-group {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .mp-drawer-toggle {
      background: none;
      border: none;
      font-size: 18px;
      cursor: pointer;
      padding: 0;
      color: #5f6368;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .mp-drawer-toggle:hover {
      color: #202124;
    }

    .mp-container {
      display: flex;
      flex-direction: column;
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
  console.log('[Meeting Progress] Starting description extraction...');

  // Approach 1: Look for meeting info panel / details area
  // Google Meet stores description in the details panel
  const detailsPanel = document.querySelector('[aria-label*="Details"]') ||
                      document.querySelector('[aria-label*="details"]') ||
                      document.querySelector('[role="region"][aria-label*="details" i]');

  if (detailsPanel) {
    const text = detailsPanel.textContent?.trim();
    if (text && text.length > 0) {
      console.log('[Meeting Progress] Found description in details panel');
      return text;
    }
  }

  // Approach 2: Look in the right panel area
  const rightPanel = document.querySelector('[data-is-open-right-panel="true"]') ||
                    document.querySelector('[jsname="FDy41c"]'); // Google Meet's right panel class

  if (rightPanel) {
    const text = rightPanel.textContent?.trim();
    if (text && text.length > 20) {
      console.log('[Meeting Progress] Found description in right panel');
      return text;
    }
  }

  // Approach 3: Search for text containing agenda-like keywords
  console.log('[Meeting Progress] Searching for agenda-like text...');
  const allElements = document.querySelectorAll('span, div, p, li');

  for (const element of allElements) {
    const text = element.textContent?.trim();

    if (!text || text.length < 20 || text.length > 3000) continue;

    // Look for elements that contain time specifications
    if (/\d+\s*min/i.test(text)) {
      console.log('[Meeting Progress] Found text with time specification');
      return text;
    }
  }

  // Approach 4: Look for description after "Description" label
  const allText = document.body.innerText;
  const descriptionMatch = allText.match(/description\s*[:\-]?\s*(.+?)(?=\n\n|\ndate|\ntime|$)/is);
  if (descriptionMatch) {
    console.log('[Meeting Progress] Found description using text matching');
    return descriptionMatch[1].trim();
  }

  console.log('[Meeting Progress] No description found');
  return null;
}

function parseDescriptionToAgenda(description) {
  // Parse agenda items from description using regex
  // Supports formats like:
  // - "Item name 5 min"
  // - "Item name (10 minutes)"
  // - "• Item name 5m"
  // - Bullet points on separate lines

  const lines = description.split('\n').filter(line => line.trim().length > 0);
  const pattern = /(\d+)\s*min(?:ute)?s?/i;
  const items = [];

  lines.forEach((line) => {
    // Skip lines that are too short or don't look like agenda items
    const trimmed = line.replace(/^[\s•\-*]+/, '').trim();
    if (trimmed.length < 3) return;

    const match = trimmed.match(pattern);
    if (match) {
      const minutes = parseInt(match[1]);
      const description = trimmed.replace(pattern, '').trim();

      if (description && minutes > 0) {
        items.push({
          description,
          minutes: Math.max(1, minutes)
        });
      }
    }
  });

  // If we found items with times, return them
  if (items.length > 0) {
    return items;
  }

  // If no times found, try to split by bullets/lines and estimate time
  const estimatedItems = [];
  const estimatedMinutes = 5; // Default per item

  lines.forEach((line) => {
    const trimmed = line.replace(/^[\s•\-*]+/, '').trim();
    // Remove any time notation first
    const withoutTime = trimmed.replace(/[\(\[].*?[\)\]]/g, '')
      .replace(pattern, '')
      .trim();

    if (withoutTime.length >= 3) {
      estimatedItems.push({
        description: withoutTime,
        minutes: estimatedMinutes
      });
    }
  });

  return estimatedItems.length > 0 ? estimatedItems : [];
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
