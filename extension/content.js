let currentAgenda = [];
let currentIndex = 0;

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
  }
});

// Detect when meeting is joined by watching for Meet's UI elements
function detectMeetingJoined() {
  const isMeetingActive = () => {
    // Check for various indicators that a meeting is active
    // Look for video elements, participant grid, or meeting controls
    return !!(
      document.querySelector('[role="main"]') && // Main meeting area
      (document.querySelector('video') || // Video stream
        document.querySelector('[aria-label*="participant"]') || // Participant list
        document.querySelector('[aria-label*="Leave call"]')) // Leave button
    );
  };

  const observer = new MutationObserver(() => {
    if (isMeetingActive() && !document.getElementById('meeting-progress-overlay')) {
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
    injectOverlay();
  }
}

function injectOverlay() {
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
      <div class="mp-content">
        <div class="mp-agenda-empty">Waiting for agenda...</div>
        <div class="mp-overall-bar">
          <div class="mp-progress" style="width: 0%"></div>
        </div>
      </div>
      <div class="mp-controls">
        <button class="mp-btn-prev" disabled>← Prev</button>
        <button class="mp-btn-next" disabled>Next →</button>
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
    </div>
  `;
}

function updateOverlayProgress(agenda, index, overallProgress) {
  const overlay = document.getElementById('meeting-progress-overlay');
  if (!overlay) return;

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

        // Show over-time badge if this item exceeded its allocated time
        if (itemElapsed > agenda[i].minutes) {
          const overTime = Math.round((itemElapsed - agenda[i].minutes) * 10) / 10;
          overtimeEl.textContent = `+${overTime.toFixed(1)}m`;
          overtimeEl.style.display = 'inline';
          overtimeEl.classList.add('mp-overtime-badge');
          itemEl.classList.add('mp-item-overtime');
          itemBar.classList.add('mp-fill-overtime');
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
      border-top: 1px solid #e8eaed;
      flex-shrink: 0;
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

    .mp-container.mp-minimized {
      height: auto;
    }

    .mp-container.mp-minimized .mp-content {
      display: none;
    }

    .mp-container.mp-minimized .mp-controls {
      display: none;
    }

    .mp-container.mp-minimized {
      width: 220px;
    }
  `;
  document.head.appendChild(style);
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
