// Load settings on page load
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadTemplates();
  setupTemplateHandlers();
});

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
  const apiKeyInput = document.getElementById('apiKey').value.trim();

  // Validate API key format if provided (basic check)
  if (apiKeyInput && !apiKeyInput.startsWith('sk-')) {
    showStatus('Warning: API key should start with "sk-"', 'warning');
    // Still save it though, in case format requirements change
  }

  const settings = {
    apiKey: apiKeyInput,
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

// ===== Template Management =====

let editingTemplateId = null;

function setupTemplateHandlers() {
  document.getElementById('createTemplateBtn').addEventListener('click', () => {
    editingTemplateId = null;
    document.getElementById('templateName').value = '';
    document.getElementById('templateItems').value = '';
    document.getElementById('templateEditForm').classList.add('show');
    document.getElementById('templateName').focus();
  });

  document.getElementById('cancelEditBtn').addEventListener('click', () => {
    document.getElementById('templateEditForm').classList.remove('show');
    editingTemplateId = null;
  });

  document.getElementById('saveTemplateBtn').addEventListener('click', saveTemplate);
}

function loadTemplates() {
  chrome.storage.sync.get(['templates'], (result) => {
    const templates = result.templates || [];
    renderTemplatesList(templates);
  });
}

function renderTemplatesList(templates) {
  const templatesList = document.getElementById('templatesList');
  const noTemplatesMsg = document.getElementById('noTemplatesMsg');

  if (templates.length === 0) {
    templatesList.innerHTML = '';
    noTemplatesMsg.style.display = 'block';
    return;
  }

  noTemplatesMsg.style.display = 'none';
  templatesList.innerHTML = templates.map((template, index) => {
    let timeLabel = '';
    if (template.startTime && template.endTime) {
      timeLabel = ` • ${template.startTime}-${template.endTime}`;
    } else if (template.startTime) {
      timeLabel = ` • ${template.startTime}`;
    }
    return `
      <div class="template-item" data-template-index="${index}">
        <div class="template-info">
          <div class="template-name">${escapeHtml(template.name)}</div>
          <div class="template-items-count">${template.items.length} items${timeLabel}</div>
        </div>
        <div class="template-actions">
          <button class="secondary template-edit-btn">Edit</button>
          <button class="danger template-delete-btn">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  // Add event listeners with delegation
  templatesList.querySelectorAll('.template-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.closest('.template-item').dataset.templateIndex);
      editTemplate(index);
    });
  });

  templatesList.querySelectorAll('.template-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.closest('.template-item').dataset.templateIndex);
      deleteTemplate(index);
    });
  });
}

function editTemplate(index) {
  chrome.storage.sync.get(['templates'], (result) => {
    const templates = result.templates || [];
    const template = templates[index];

    if (!template) return;

    editingTemplateId = index;
    document.getElementById('templateName').value = template.name;

    // Build items text with start and end times
    let itemsText = '';
    if (template.startTime) {
      itemsText = template.startTime + '\n';
    }
    itemsText += template.items
      .map(item => `${item.description} ${item.minutes} m`)
      .join('\n');
    if (template.endTime) {
      itemsText += '\n' + template.endTime;
    }

    document.getElementById('templateItems').value = itemsText;
    document.getElementById('templateEditForm').classList.add('show');
    document.getElementById('templateName').focus();
  });
}

function saveTemplate() {
  const name = document.getElementById('templateName').value.trim();
  const itemsText = document.getElementById('templateItems').value.trim();

  // Validation
  if (!name) {
    showStatus('Please enter a template name', 'error');
    return;
  }

  if (!itemsText) {
    showStatus('Please add at least one item', 'error');
    return;
  }

  // Parse items and optional start time
  const result = parseAgendaItemsWithTime(itemsText);
  if (result.items.length === 0) {
    showStatus('No valid items found. Use format: "Item Name X min"', 'error');
    return;
  }

  const newTemplate = { name, items: result.items };
  if (result.startTime) {
    newTemplate.startTime = result.startTime;
  }
  if (result.endTime) {
    newTemplate.endTime = result.endTime;
  }

  chrome.storage.sync.get(['templates'], (result) => {
    let templates = result.templates || [];

    if (editingTemplateId !== null && editingTemplateId < templates.length) {
      // Update existing
      templates[editingTemplateId] = newTemplate;
    } else {
      // Create new
      templates.push(newTemplate);
    }

    chrome.storage.sync.set({ templates }, () => {
      showStatus(editingTemplateId !== null ? 'Template updated!' : 'Template created!', 'success');
      document.getElementById('templateEditForm').classList.remove('show');
      editingTemplateId = null;
      loadTemplates();
    });
  });
}

function deleteTemplate(index) {
  if (!confirm('Delete this template? This cannot be undone.')) {
    return;
  }

  chrome.storage.sync.get(['templates'], (result) => {
    let templates = result.templates || [];
    templates.splice(index, 1);
    chrome.storage.sync.set({ templates }, () => {
      showStatus('Template deleted', 'success');
      loadTemplates();
    });
  });
}

function parseAgendaItems(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const items = [];
  const timeRangePattern = /\|\s*(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/i;
  const durationWithEndPattern = /^(.+?)\s+(\d+)\s*(?:min(?:ute)?s?|m)\s*\|\s*(\d{1,2}):(\d{2})$/i;
  const durationOnlyPattern = /^(.+?)\s+(\d+)\s*(?:min(?:ute)?s?|m)$/i;

  for (const line of lines) {
    let item = null;

    // Try time range format: "Item | 14:30-14:35"
    if (timeRangePattern.test(line)) {
      const match = line.match(/^(.+?)\s*\|\s*(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/i);
      if (match) {
        const startHours = parseInt(match[2]);
        const startMins = parseInt(match[3]);
        const endHours = parseInt(match[4]);
        const endMins = parseInt(match[5]);

        // Calculate duration in minutes
        const startTotalMins = startHours * 60 + startMins;
        const endTotalMins = endHours * 60 + endMins;
        const duration = Math.max(0, endTotalMins - startTotalMins);

        item = {
          description: match[1].trim(),
          minutes: duration,
          endTime: `${match[4].padStart(2, '0')}:${match[5]}`
        };
      }
    }
    // Try duration with end time: "Item 5m | 14:35"
    else if (durationWithEndPattern.test(line)) {
      const match = line.match(durationWithEndPattern);
      if (match) {
        item = {
          description: match[1].trim(),
          minutes: parseInt(match[2], 10),
          endTime: `${match[3].padStart(2, '0')}:${match[4]}`
        };
      }
    }
    // Try duration only: "Item 5m"
    else if (durationOnlyPattern.test(line)) {
      const match = line.match(durationOnlyPattern);
      if (match) {
        item = {
          description: match[1].trim(),
          minutes: parseInt(match[2], 10)
        };
      }
    }

    if (item) {
      items.push(item);
    }
  }

  return items;
}

function parseAgendaItemsWithTime(text) {
  let lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const items = [];
  let startTime = null;
  let endTime = null;
  const timePattern = /^(\d{1,2}):(\d{2})$/;

  // Check if first line is a time (HH:MM format)
  if (lines.length > 0 && timePattern.test(lines[0])) {
    const timeMatch = lines[0].match(timePattern);
    const hours = timeMatch[1].padStart(2, '0');
    const minutes = timeMatch[2];
    startTime = `${hours}:${minutes}`;
    lines = lines.slice(1); // Remove start time from lines to parse
  }

  // Check if last line is a time (HH:MM format) - optional end time
  if (lines.length > 0 && timePattern.test(lines[lines.length - 1])) {
    const timeMatch = lines[lines.length - 1].match(timePattern);
    const hours = timeMatch[1].padStart(2, '0');
    const minutes = timeMatch[2];
    endTime = `${hours}:${minutes}`;
    lines = lines.slice(0, -1); // Remove end time from lines to parse
  }

  // Parse remaining lines as items
  const durationOnlyPattern = /^(.+?)\s+(\d+)\s*(?:min(?:ute)?s?|m)$/i;

  for (const line of lines) {
    const match = line.match(durationOnlyPattern);
    if (match) {
      items.push({
        description: match[1].trim(),
        minutes: parseInt(match[2], 10)
      });
    }
  }

  const result = { items, startTime };
  if (endTime) {
    result.endTime = endTime;
  }
  return result;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
