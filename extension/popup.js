let overlayStatus = false;

// Load overlay status on popup open
document.addEventListener('DOMContentLoaded', () => {
  checkOverlayStatus();
  setupEventListeners();
});

function setupEventListeners() {
  document.getElementById('injectBtn').addEventListener('click', toggleOverlay);
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
}

function checkOverlayStatus() {
  // Check if we can access the active Meet tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs[0]) return;

    if (tabs[0].url?.includes('meet.google.com')) {
      // Send message to check if overlay is injected
      chrome.tabs.sendMessage(tabs[0].id, { action: 'checkOverlayStatus' }, (response) => {
        if (chrome.runtime.lastError) {
          overlayStatus = false;
          updateStatusBadge();
          return;
        }
        overlayStatus = response?.overlayInjected || false;
        updateStatusBadge();
      });
    } else {
      overlayStatus = false;
      updateStatusBadge();
    }
  });
}

function updateStatusBadge() {
  const badge = document.getElementById('statusBadge');
  if (overlayStatus) {
    badge.textContent = '✓ Overlay: Injected';
    badge.classList.remove('inactive');
    badge.classList.add('active');
  } else {
    badge.textContent = 'Overlay: Not Injected';
    badge.classList.remove('active');
    badge.classList.add('inactive');
  }
}

function toggleOverlay() {
  const btn = document.getElementById('injectBtn');
  btn.disabled = true;
  btn.textContent = overlayStatus ? 'Removing...' : 'Injecting...';

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs[0] || !tabs[0].url?.includes('meet.google.com')) {
      btn.disabled = false;
      btn.textContent = '📍 Inject Overlay';
      console.log('[Meeting Progress] Not on a Google Meet tab');
      return;
    }

    const action = overlayStatus ? 'removeOverlay' : 'injectOverlay';
    chrome.tabs.sendMessage(tabs[0].id, { action }, (response) => {
      btn.disabled = false;
      btn.textContent = '📍 Inject Overlay';

      if (chrome.runtime.lastError) {
        console.log('[Meeting Progress] Error toggling overlay');
      } else {
        overlayStatus = !overlayStatus;
        updateStatusBadge();
      }
    });
  });
}

function openSettings() {
  chrome.runtime.openOptionsPage();
}
