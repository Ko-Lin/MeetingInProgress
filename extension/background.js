// Service worker for background tasks and timer management

let currentAgenda = [];
let currentIndex = 0;
let timerRunning = false;
let updateIntervalId = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startTimer') {
    const success = startTimer(request.agenda, request.meetingEndTime);
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
  } else if (request.action === 'getTimerStatus') {
    sendResponse({ timerRunning });
  }
});

function startTimer(agenda, meetingEndTime) {
  if (!agenda || agenda.length === 0) return false;

  currentAgenda = agenda;
  if (meetingEndTime) {
    currentAgenda.meetingEndTime = meetingEndTime;
  }
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

  // Calculate total time allocated to agenda items
  const agendaDurationMinutes = currentAgenda.reduce((sum, item) => sum + item.minutes, 0);

  // Calculate total meeting duration (if meeting end time is set)
  let totalMeetingMinutes = agendaDurationMinutes;
  if (currentAgenda.meetingEndTime) {
    const [endHours, endMinutes] = currentAgenda.meetingEndTime.split(':').map(Number);
    const startDate = new Date(currentAgenda[0].startTime);
    const endDate = new Date(currentAgenda[0].startTime);
    endDate.setHours(endHours, endMinutes, 0, 0);
    totalMeetingMinutes = (endDate.getTime() - currentAgenda[0].startTime) / (1000 * 60);
  }

  // Calculate actual elapsed time since meeting started
  const totalElapsedMs = now - currentAgenda[0].startTime;
  const totalElapsedMinutes = totalElapsedMs / (1000 * 60);

  // Auto-calculate currentIndex based on elapsed time (account for all completed items)
  let autoIndex = currentAgenda.length - 1; // Default to last item
  let accumulatedTime = 0;

  for (let i = 0; i < currentAgenda.length; i++) {
    accumulatedTime += currentAgenda[i].minutes;
    if (totalElapsedMinutes < accumulatedTime) {
      autoIndex = i;
      break;
    }
  }

  // Use auto-calculated index based on elapsed time
  // If elapsed time exceeds all items, show last item as active
  const effectiveIndex = (totalElapsedMinutes >= agendaDurationMinutes) ? currentAgenda.length - 1 : autoIndex;

  // Overall progress is based on total meeting duration, not just agenda
  // Continue counting into overtime (don't cap at 1.0)
  const overallProgress = totalElapsedMinutes / totalMeetingMinutes;

  chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(
        tab.id,
        {
          action: 'updateProgress',
          agenda: currentAgenda,
          currentIndex: effectiveIndex,
          overallProgress,
          meetingEndTime: currentAgenda.meetingEndTime
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
