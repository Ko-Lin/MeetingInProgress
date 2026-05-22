// Service worker for background tasks and timer management

let currentAgenda = [];
let currentIndex = 0;
let timerRunning = false;
let updateIntervalId = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startTimer') {
    const success = startTimer(request.agenda);
    sendResponse({ success });
  } else if (request.action === 'advanceItem') {
    advanceItem();
    sendResponse({ success: true });
  } else if (request.action === 'previousItem') {
    previousItem();
    sendResponse({ success: true });
  } else if (request.action === 'stopTimer') {
    stopTimer();
    sendResponse({ success: true });
  }
});

function startTimer(agenda) {
  if (!agenda || agenda.length === 0) return false;

  currentAgenda = agenda;
  currentIndex = 0;
  timerRunning = true;

  // Clear any existing interval
  if (updateIntervalId) clearInterval(updateIntervalId);

  // Set up frequent updates every 1 second for real-time progress
  updateIntervalId = setInterval(() => {
    if (timerRunning) {
      updateOverlay();
    }
  }, 1000);

  // Immediately send current state to overlay
  updateOverlay();
  return true;
}

function stopTimer() {
  timerRunning = false;
  if (updateIntervalId) {
    clearInterval(updateIntervalId);
    updateIntervalId = null;
  }
}

function advanceItem() {
  if (!timerRunning || currentIndex >= currentAgenda.length - 1) return;

  currentIndex++;
  updateOverlay();
}

function previousItem() {
  if (!timerRunning || currentIndex <= 0) return;

  currentIndex--;
  updateOverlay();
}

function updateOverlay() {
  if (!timerRunning || currentAgenda.length === 0) return;

  const now = Date.now();

  // Calculate total time allocated and elapsed
  const totalMinutes = currentAgenda.reduce((sum, item) => sum + item.minutes, 0);
  let totalElapsedMinutes = 0;
  let carryOverTime = 0;

  // Sum elapsed time for all previous items (including overruns)
  for (let i = 0; i < currentIndex; i++) {
    const item = currentAgenda[i];
    const itemElapsedMs = now - item.startTime;
    const itemElapsedMinutes = itemElapsedMs / (1000 * 60);
    totalElapsedMinutes += itemElapsedMinutes;
    if (itemElapsedMinutes > item.minutes) {
      carryOverTime += itemElapsedMinutes - item.minutes;
    }
  }

  // Add elapsed time for current item (including carry-over from previous items)
  if (currentIndex < currentAgenda.length) {
    const item = currentAgenda[currentIndex];
    const elapsedMs = now - item.startTime;
    const elapsedMinutes = elapsedMs / (1000 * 60);
    totalElapsedMinutes += elapsedMinutes;
  }

  const overallProgress = Math.min(totalElapsedMinutes / totalMinutes, 1);

  chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(
        tab.id,
        {
          action: 'updateProgress',
          agenda: currentAgenda,
          currentIndex,
          overallProgress
        },
        (response) => {
          // Silently handle errors if content script isn't ready
          if (chrome.runtime.lastError) {
            // Expected for tabs without content script injected
          }
        }
      );
    });
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Clean up if Meet tab is closed
  if (changeInfo.status === 'discarded' && tab.url?.includes('meet.google.com')) {
    // Save end-of-meeting summary
    if (timerRunning) {
      saveEndOfMeetingSummary();
    }
  }
});

function saveEndOfMeetingSummary() {
  if (currentAgenda.length === 0) return;

  const now = Date.now();
  const summary = {
    date: new Date().toISOString(),
    items: currentAgenda.map((item, index) => ({
      description: item.description,
      minutes: item.minutes,
      status: index < currentIndex ? 'completed' : index === currentIndex ? 'in-progress' : 'skipped'
    })),
    totalScheduledMinutes: currentAgenda.reduce((sum, item) => sum + item.minutes, 0),
    totalElapsedMinutes: Math.round((now - currentAgenda[0].startTime) / (1000 * 60))
  };

  chrome.storage.local.get(['meetingSummaries'], (result) => {
    const summaries = result.meetingSummaries || [];
    summaries.push(summary);

    // Keep only last 24 hours
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const filtered = summaries.filter(
      (s) => new Date(s.date).getTime() > oneDayAgo
    );

    chrome.storage.local.set({ meetingSummaries: filtered });
  });
}
