let agenda = [];

// Load agenda on popup open
document.addEventListener('DOMContentLoaded', () => {
  loadAgenda();
  checkTimerStatus();
});

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
document.getElementById('importDescBtn').addEventListener('click', importFromDescription);

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
  itemInput.value = ''; // Clear description
  // Keep minutes value for adding multiple items with same duration
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
    <div class="agenda-item" data-id="${item.id}" style="cursor: pointer;">
      <span class="item-desc">${item.description}</span>
      <span class="time">${item.minutes}m</span>
      <button class="delete-btn" data-id="${item.id}" title="Remove item">✕</button>
    </div>
  `
    )
    .join('');

  // Delete button handler
  list.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteItem(parseInt(e.target.dataset.id));
    });
  });

  // Inline edit handler
  list.querySelectorAll('.agenda-item').forEach((itemEl) => {
    itemEl.addEventListener('click', (e) => {
      // Check if clicking on delete button or its contents
      if (e.target.closest('.delete-btn')) return;

      const id = parseInt(itemEl.dataset.id);
      const item = agenda.find((a) => a.id === id);
      if (item) {
        console.log('[Meeting Progress] Editing item:', item);
        editItemInline(itemEl, item);
      }
    });
  });
}

function editItemInline(itemEl, item) {
  console.log('[Meeting Progress] editItemInline called for:', item);

  if (itemEl.classList.contains('editing')) {
    console.log('[Meeting Progress] Already editing this item, ignoring click');
    return;
  }

  const desc = itemEl.querySelector('.item-desc');
  const timeEl = itemEl.querySelector('.time');

  if (!desc || !timeEl) {
    console.error('[Meeting Progress] Could not find description or time elements');
    return;
  }

  const originalDesc = item.description;
  const originalMins = item.minutes;

  // Create inline edit inputs
  const descInput = document.createElement('input');
  descInput.type = 'text';
  descInput.value = originalDesc;
  descInput.className = 'inline-edit-input';
  descInput.style.flex = '1';
  descInput.style.padding = '4px 8px';
  descInput.style.border = '1px solid #1f73e8';
  descInput.style.borderRadius = '3px';

  const minsInput = document.createElement('input');
  minsInput.type = 'number';
  minsInput.value = originalMins;
  minsInput.className = 'inline-edit-input';
  minsInput.style.width = '50px';
  minsInput.style.padding = '4px 8px';
  minsInput.style.border = '1px solid #1f73e8';
  minsInput.style.borderRadius = '3px';
  minsInput.min = '1';

  const saveEdit = () => {
    const newDesc = descInput.value.trim();
    const newMins = parseInt(minsInput.value) || 0;

    console.log('[Meeting Progress] Saving edit:', { newDesc, newMins });

    if (newDesc && newMins > 0) {
      item.description = newDesc;
      item.minutes = newMins;
      saveAgenda();
      console.log('[Meeting Progress] Item updated and saved');
    } else {
      console.log('[Meeting Progress] Invalid input, not saving');
    }

    itemEl.classList.remove('editing');
    renderAgenda();
  };

  descInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    }
  });

  minsInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    }
  });

  itemEl.classList.add('editing');
  desc.replaceWith(descInput);
  timeEl.replaceWith(minsInput);

  // Set focus after a brief delay to ensure DOM is updated
  setTimeout(() => {
    descInput.focus();
    descInput.select();
    console.log('[Meeting Progress] Input focused and selected');
  }, 0);

  // Save on blur
  const blurHandler = () => {
    console.log('[Meeting Progress] Input blur, saving');
    saveEdit();
  };
  descInput.addEventListener('blur', blurHandler);
  minsInput.addEventListener('blur', blurHandler);
}

function saveAgenda() {
  chrome.storage.sync.set({ agenda });
}

function checkTimerStatus() {
  // Check if timer is already running in background
  chrome.runtime.sendMessage({ action: 'getTimerStatus' }, (response) => {
    if (response?.timerRunning) {
      const startBtn = document.getElementById('startBtn');
      startBtn.disabled = true;
      startBtn.textContent = 'Timer Running...';
      startBtn.style.opacity = '0.6';
      startBtn.style.cursor = 'not-allowed';
    }
  });
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
  chrome.runtime.sendMessage({ action: 'startTimer', agenda }, (response) => {
    if (response?.success) {
      // Update button state
      const startBtn = document.getElementById('startBtn');
      startBtn.disabled = true;
      startBtn.textContent = 'Timer Running...';
      startBtn.style.opacity = '0.6';
      startBtn.style.cursor = 'not-allowed';
    }
  });
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

function importFromDescription() {
  const importBtn = document.getElementById('importDescBtn');
  if (!importBtn) return;

  importBtn.disabled = true;
  importBtn.textContent = 'Importing...';

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs[0] || !tabs[0].url?.includes('meet.google.com')) {
      importBtn.disabled = false;
      importBtn.textContent = '📋 Import from Description';
      console.log('[Meeting Progress] Not on a Google Meet tab');
      return;
    }

    // Extract description and parse agenda items
    chrome.tabs.sendMessage(tabs[0].id, { action: 'extractMeetingDescription' }, (response) => {
      importBtn.disabled = false;
      importBtn.textContent = '📋 Import from Description';

      if (chrome.runtime.lastError || !response?.success) {
        console.log('[Meeting Progress] Failed to extract meeting description');
        return;
      }

      const items = response.items || [];

      if (items.length === 0) {
        console.log('[Meeting Progress] No agenda items detected in description');
        return;
      }

      // Add parsed items to agenda
      let added = 0;
      items.forEach((item) => {
        if (item.description && item.minutes > 0) {
          agenda.push({
            id: Date.now() + Math.random(),
            description: item.description,
            minutes: item.minutes,
            startTime: null
          });
          added++;
        }
      });

      if (added > 0) {
        console.log(`[Meeting Progress] Imported ${added} agenda items from description`);
        saveAgenda();
        renderAgenda();
        console.log('[Meeting Progress] Agenda rendered with click handlers attached');

        // Re-enable start button if timer isn't running
        const startBtn = document.getElementById('startBtn');
        if (startBtn && !startBtn.dataset.timerRunning) {
          startBtn.disabled = false;
          startBtn.textContent = 'Start Timer';
          startBtn.style.opacity = '1';
          startBtn.style.cursor = 'pointer';
        }
      }
    });
  });
}
