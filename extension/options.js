// Load settings on page load
document.addEventListener('DOMContentLoaded', loadSettings);

// Save button
document.getElementById('saveBtn').addEventListener('click', saveSettings);

function loadSettings() {
  chrome.storage.sync.get(['apiKey', 'borderPulse', 'defaultPosition'], (result) => {
    document.getElementById('apiKey').value = result.apiKey || '';
    document.getElementById('borderPulse').checked = result.borderPulse !== false;
    document.getElementById('position').value = result.defaultPosition || 'top-right';
  });
}

function saveSettings() {
  const settings = {
    apiKey: document.getElementById('apiKey').value,
    borderPulse: document.getElementById('borderPulse').checked,
    defaultPosition: document.getElementById('position').value
  };

  chrome.storage.sync.set(settings, () => {
    showStatus('Settings saved!', 'success');
  });
}

function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = 'status show ' + type;

  setTimeout(() => {
    status.classList.remove('show');
  }, 2000);
}
