const TRACKING_TICK_MS = 1000;
const LIMIT_NOTIFICATION_COOLDOWN_MS = 5 * 60 * 1000;

function getTodayString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDomain(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
      return null;
    }

    return urlObj.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function cleanUpOldData() {
  const data = await chrome.storage.local.get(["usage"]);
  if (!data.usage) {
    return;
  }

  const usage = data.usage;
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  let changed = false;

  for (const date of Object.keys(usage)) {
    const parsedDate = new Date(date).getTime();
    if (parsedDate && parsedDate < thirtyDaysAgo) {
      delete usage[date];
      changed = true;
    }
  }

  if (changed) {
    await chrome.storage.local.set({ usage });
  }
}

async function migrateData() {
  const data = await chrome.storage.local.get(["usage", "limits", "lastNotified"]);
  let usage = data.usage || {};
  let changed = false;

  const hasLegacyData = Object.keys(usage).some(
    (key) => !key.match(/^\d{4}-\d{2}-\d{2}$/)
  );

  if (hasLegacyData) {
    const today = getTodayString();
    const oldData = { ...usage };
    usage = { [today]: {} };

    for (const [key, value] of Object.entries(oldData)) {
      if (!key.match(/^\d{4}-\d{2}-\d{2}$/)) {
        usage[today][key] = value;
      }
    }

    changed = true;
  }

  const nextData = {};

  if (changed) {
    nextData.usage = usage;
  }

  if (!data.limits || typeof data.limits !== "object") {
    nextData.limits = {};
  }

  if (!data.lastNotified || typeof data.lastNotified !== "object") {
    nextData.lastNotified = {};
  }

  if (Object.keys(nextData).length > 0) {
    await chrome.storage.local.set(nextData);
  }
}

async function getState() {
  const data = await chrome.storage.local.get([
    "trk_currentDomain",
    "trk_startTime",
    "trk_isWindowFocused",
    "trk_isIdle",
    "trk_sessionStartTime",
    "trk_nudgeSentForSession",
  ]);

  return {
    currentDomain: data.trk_currentDomain || null,
    startTime: data.trk_startTime || null,
    isWindowFocused: data.trk_isWindowFocused !== false,
    isIdle: data.trk_isIdle === true,
    sessionStartTime: data.trk_sessionStartTime || null,
    nudgeSentForSession: data.trk_nudgeSentForSession === true,
  };
}

async function updateState(updates) {
  const mapped = {};
  if (updates.currentDomain !== undefined) mapped.trk_currentDomain = updates.currentDomain;
  if (updates.startTime !== undefined) mapped.trk_startTime = updates.startTime;
  if (updates.isWindowFocused !== undefined) mapped.trk_isWindowFocused = updates.isWindowFocused;
  if (updates.isIdle !== undefined) mapped.trk_isIdle = updates.isIdle;
  if (updates.sessionStartTime !== undefined) mapped.trk_sessionStartTime = updates.sessionStartTime;
  if (updates.nudgeSentForSession !== undefined) mapped.trk_nudgeSentForSession = updates.nudgeSentForSession;

  if (Object.keys(mapped).length > 0) {
    await chrome.storage.local.set(mapped);
  }
}

function formatBadgeText(ms) {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return "0m";
}

function updateBadge(todayUsage) {
  const total = Object.values(todayUsage || {}).reduce((sum, value) => sum + value, 0);
  chrome.action.setBadgeText({ text: formatBadgeText(total) });
  chrome.action.setBadgeBackgroundColor({ color: "#6c5ce7" });
}

function buildLimitNotificationMessage(domain) {
  return `You've been on ${domain.replace(/^www\./, "")} for a while. Maybe take a break?`;
}

function showTestNotification() {
  console.log("Notification triggered");
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "ScreenBuddy",
    message: "Hey, just checking in 👀",
  });
}

async function checkLimit(domain, options = {}) {
  if (!domain) {
    return false;
  }

  const {
    usage,
    limits,
    lastNotified,
    now = Date.now(),
    forceNotify = false,
  } = options;

  let usageMap = usage;
  let limitMap = limits;
  let notifiedMap = lastNotified;

  if (!usageMap || !limitMap || !notifiedMap) {
    const today = getTodayString();
    const data = await chrome.storage.local.get(["usage", "limits", "lastNotified"]);
    usageMap = usageMap || ((data.usage && data.usage[today]) || {});
    limitMap = limitMap || data.limits || {};
    notifiedMap = notifiedMap || data.lastNotified || {};
  }

  const limit = limitMap[domain];
  const domainUsage = usageMap[domain] || 0;
  console.log("Checking limit:", domain, domainUsage, limit || null);

  if (!limit) {
    return false;
  }

  if (domainUsage < limit) {
    return false;
  }

  const lastNotifiedAt = notifiedMap[domain] || 0;
  if (!forceNotify && now - lastNotifiedAt < LIMIT_NOTIFICATION_COOLDOWN_MS) {
    console.log("Limit notification skipped due to cooldown:", domain, lastNotifiedAt);
    return false;
  }

  console.log("Triggering limit notification:", domain, domainUsage, limit);
  await chrome.notifications.create(`limit-${domain}-${now}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "ScreenBuddy",
    message: buildLimitNotificationMessage(domain),
    priority: 2,
    requireInteraction: true,
  });

  notifiedMap[domain] = now;
  await chrome.storage.local.set({ lastNotified: notifiedMap });
  return true;
}

async function checkSmartNudges(state) {
  if (
    !state.isWindowFocused ||
    state.isIdle ||
    !state.currentDomain ||
    !state.sessionStartTime
  ) {
    return;
  }

  const now = Date.now();
  const sessionDuration = now - state.sessionStartTime;
  const nudgeThreshold = 45 * 60 * 1000;

  if (sessionDuration > nudgeThreshold && !state.nudgeSentForSession) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { cmd: "smart-nudge" }).catch(() => {});
        updateState({ nudgeSentForSession: true });
      }
    });
  }
}

async function updateCurrentSession() {
  const state = await getState();
  if (!state.isWindowFocused || state.isIdle || !state.currentDomain || !state.startTime) {
    return;
  }

  const now = Date.now();
  const timeSpent = now - state.startTime;
  const today = getTodayString();
  const data = await chrome.storage.local.get(["usage", "limits", "lastNotified"]);
  const usage = data.usage || {};
  const todayUsage = { ...(usage[today] || {}) };

  if (timeSpent > 0) {
    todayUsage[state.currentDomain] = (todayUsage[state.currentDomain] || 0) + timeSpent;
    usage[today] = todayUsage;

    await chrome.storage.local.set({
      usage,
      trk_startTime: now,
    });
  }

  updateBadge(todayUsage);
  await checkLimit(state.currentDomain, {
    usage: todayUsage,
    limits: data.limits || {},
    lastNotified: data.lastNotified || {},
    now,
  });
  await checkSmartNudges(state);
}

async function evaluateDomainLimit(domain, options = {}) {
  if (!domain) {
    return;
  }

  const today = getTodayString();
  const data = await chrome.storage.local.get(["usage", "limits", "lastNotified"]);

  await checkLimit(domain, {
    usage: (data.usage && data.usage[today]) || {},
    limits: data.limits || {},
    lastNotified: data.lastNotified || {},
    now: Date.now(),
    forceNotify: options.forceNotify === true,
  });
}

async function switchToTab(tabId) {
  const state = await getState();
  if (!state.isWindowFocused || state.isIdle) {
    return;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) {
      return;
    }

    const newDomain = getDomain(tab.url);
    const now = Date.now();

    if (state.currentDomain !== newDomain) {
      await updateCurrentSession();
      await updateState({
        currentDomain: newDomain,
        startTime: now,
        sessionStartTime: now,
        nudgeSentForSession: false,
      });
    }

    await evaluateDomainLimit(newDomain);
  } catch {
    // Ignore tabs that disappear during rapid switching.
  }
}

async function syncActiveTabState() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return;
  }

  const now = Date.now();
  const currentDomain = getDomain(tab.url);

  await updateState({
    currentDomain,
    startTime: now,
    sessionStartTime: now,
    nudgeSentForSession: false,
  });

  await evaluateDomainLimit(currentDomain);
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await switchToTab(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.status === "complete" || changeInfo.url)) {
    await switchToTab(tabId);
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  const state = await getState();

  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await updateCurrentSession();
    await updateState({ isWindowFocused: false });
    return;
  }

  await updateState({ isWindowFocused: true, startTime: Date.now() });

  if (!state.isIdle) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      const newDomain = getDomain(tab.url);
      const now = Date.now();
      const updates = { startTime: now };

      if (state.currentDomain !== newDomain) {
        updates.currentDomain = newDomain;
        updates.sessionStartTime = now;
        updates.nudgeSentForSession = false;
      }

      await updateState(updates);
      await evaluateDomainLimit(newDomain);
    }
  }
});

chrome.idle.setDetectionInterval(60);
chrome.idle.onStateChanged.addListener(async (activityState) => {
  const state = await getState();

  if (activityState === "idle" || activityState === "locked") {
    await updateCurrentSession();
    await updateState({ isIdle: true });
    return;
  }

  if (activityState === "active") {
    await updateState({ isIdle: false, startTime: Date.now() });

    if (state.isWindowFocused) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const currentDomain = getDomain(tab.url);
        await updateState({
          currentDomain,
          startTime: Date.now(),
        });
        await evaluateDomainLimit(currentDomain);
      }
    }
  }
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "local" || !changes.limits) return;

  console.log("Limits changed → checking immediately");

  await checkActiveTabImmediately();

  const oldLimits = changes.limits.oldValue || {};
  const newLimits = changes.limits.newValue || {};
  const changedDomains = new Set([
    ...Object.keys(oldLimits),
    ...Object.keys(newLimits),
  ]);

  for (const domain of changedDomains) {
    const previousLimit = oldLimits[domain];
    const currentLimit = newLimits[domain];

    if (currentLimit && currentLimit !== previousLimit) {
      await evaluateDomainLimit(domain, { forceNotify: true });
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "test-notification") {
    showTestNotification();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type !== "limit-updated" || !message.domain) {
    return false;
  }

  evaluateDomainLimit(message.domain, { forceNotify: true })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      console.error("Failed to evaluate updated limit:", error);
      sendResponse({ ok: false });
    });

  return true;
});

chrome.runtime.onStartup.addListener(async () => {
  await migrateData();
  await cleanUpOldData();
  await syncActiveTabState();

  const data = await chrome.storage.local.get(["usage"]);
  const todayUsage = (data.usage && data.usage[getTodayString()]) || {};
  updateBadge(todayUsage);
});

chrome.runtime.onInstalled.addListener(async () => {
  await migrateData();
  await cleanUpOldData();
  await updateState({
    isWindowFocused: true,
    isIdle: false,
  });

  await syncActiveTabState();
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "ScreenBuddy",
    message: "Notifications are working 🎉",
  });
});

setInterval(() => {
  updateCurrentSession().catch(() => {});
}, TRACKING_TICK_MS);

async function checkActiveTabImmediately() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const domain = getDomain(tab.url);
  if (!domain) return;

  console.log("Immediate check for:", domain);

  await evaluateDomainLimit(domain, { forceNotify: true });
}
