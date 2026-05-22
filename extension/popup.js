let agenda = [];

// Load agenda on popup open
document.addEventListener('DOMContentLoaded', loadAgenda);

// Event listeners
document.getElementById('addBtn').addEventListener('click', addItem);
document.getElementById('itemInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') addItem();
});
document.getElementById('parseBtn').addEventListener('click', parseAndAdd);
document.getElementById('startBtn').addEventListener('click', startTimer);
document.getElementById('clearBtn').addEventListener('click', clearAgenda);
document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('injectBtn').addEventListener('click', manualInject);

function loadAgenda() {
  chrome.storage.sync.get(['agenda'], (result) => {
    agenda = result.agenda || [];
    renderAgenda();
  });
}

function addItem() {
  const itemInput = document.getElementById('itemInput');
  const minutesInput = document.getElementById('minutesInput');

  const description = itemInput.value.trim();
  const minutes = parseInt(minutesInput.value) || 0;

  if (!description || minutes <= 0) {
    alert('Please enter a description and duration');
    return;
  }

  agenda.push({
    id: Date.now(),
    description,
    minutes,
    startTime: null
  });

  saveAgenda();
  itemInput.value = '';
  minutesInput.value = '';
  itemInput.focus();
  renderAgenda();
}

function parseAndAdd() {
  const pasteInput = document.getElementById('pasteInput');
  const text = pasteInput.value.trim();

  if (!text) {
    alert('Paste content to parse');
    return;
  }

  const lines = text.split('\n');
  const pattern = /(\d+)\s*min(?:ute)?s?/i;
  let parsed = 0;

  lines.forEach((line) => {
    const match = line.match(pattern);
    if (match) {
      const minutes = parseInt(match[1]);
      const description = line.replace(pattern, '').trim();

      if (description && minutes > 0) {
        agenda.push({
          id: Date.now() + Math.random(),
          description,
          minutes,
          startTime: null
        });
        parsed++;
      }
    }
  });

  if (parsed > 0) {
    saveAgenda();
    pasteInput.value = '';
    renderAgenda();
  } else {
    alert('No items found. Use format: "Item name 5 min"');
  }
}

function deleteItem(id) {
  agenda = agenda.filter((item) => item.id !== id);
  saveAgenda();
  renderAgenda();
}

function clearAgenda() {
  if (confirm('Clear all agenda items?')) {
    agenda = [];
    saveAgenda();
    renderAgenda();
  }
}

function renderAgenda() {
  const list = document.getElementById('agendaList');

  if (agenda.length === 0) {
    list.innerHTML = '<div class="empty-state">No items yet</div>';
    return;
  }

  list.innerHTML = agenda
    .map(
      (item) => `
    <div class="agenda-item">
      <span>${item.description}</span>
      <span class="time">${item.minutes}m</span>
      <button class="delete-btn" data-id="${item.id}">✕</button>
    </div>
  `
    )
    .join('');

  list.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      deleteItem(parseInt(e.target.dataset.id));
    });
  });
}

function saveAgenda() {
  chrome.storage.sync.set({ agenda });
}

function startTimer() {
  if (agenda.length === 0) return;

  // Mark start time for each item
  const now = Date.now();
  agenda.forEach((item, index) => {
    if (item.startTime === null) {
      item.startTime = now;
    }
  });

  saveAgenda();

  // Send message to background to start timer
  chrome.runtime.sendMessage({ action: 'startTimer', agenda });
}

function openSettings() {
  chrome.runtime.openOptionsPage();
}

function manualInject() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs[0] || !tabs[0].url?.includes('meet.google.com')) return;

    chrome.tabs.sendMessage(tabs[0].id, { action: 'injectOverlay' }, (response) => {
      if (chrome.runtime.lastError) {
        // Silently handle error
      }
    });
  });
}
