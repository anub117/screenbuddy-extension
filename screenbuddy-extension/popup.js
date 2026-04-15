let currentChart = null;

function formatTime(ms) {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function formatLimitLabel(ms) {
  const minutes = Math.round(ms / 60000);
  return minutes >= 60 && minutes % 60 === 0
    ? `${minutes / 60}h`
    : `${minutes} min`;
}

function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normalizeDomain(rawValue) {
  const trimmed = rawValue.trim().toLowerCase();
  if (!trimmed) return null;

  try {
    const url = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function setStatus(message, isError = false) {
  const status = document.getElementById("limitStatus");
  status.textContent = message;
  status.dataset.state = isError ? "error" : "default";
}

function updateMood(totalTime) {
  const hours = totalTime / (1000 * 60 * 60);
  const icon = document.getElementById("moodIcon");
  const root = document.documentElement;

  if (hours < 1) {
    icon.innerText = "😊";
    root.style.setProperty("--theme-color", "#18dcff");
  } else if (hours < 3) {
    icon.innerText = "🙂";
    root.style.setProperty("--theme-color", "#f1c40f");
  } else {
    icon.innerText = "😵";
    root.style.setProperty("--theme-color", "#e74c3c");
  }
}

function renderList(sorted) {
  const list = document.getElementById("list");
  list.innerHTML = "";

  const meaningfulSites = sorted
    .filter(([, time]) => time >= 60000)
    .slice(0, 10);

  if (!meaningfulSites.length) {
    list.innerHTML = '<div class="empty-state">No significant usage yet today.</div>';
    return;
  }

  meaningfulSites.forEach(([domain, time]) => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <span>${domain}</span>
      <span class="time">${formatTime(time)}</span>
    `;
    list.appendChild(div);
  });
}

function renderSummary(sorted) {
  const total = sorted.reduce((sum, [, time]) => sum + time, 0);
  const top = sorted.length ? sorted[0][0] : "--";

  document.getElementById("totalTime").innerText = formatTime(total);
  document.getElementById("topSites").innerText = top;
  document.getElementById("topSites").title = top;

  updateMood(total);
}

function renderChart(sorted) {
  const ctx = document.getElementById("chart");

  // ✅ Safe guard (no data)
  if (!sorted.length) {
    if (currentChart) currentChart.destroy();
    return;
  }

  if (currentChart) currentChart.destroy();

  const topSites = sorted.slice(0, 5);
  const others = sorted.slice(5).reduce((sum, [, time]) => sum + time, 0);

  const labels = topSites.map(([domain]) => domain);
  const values = topSites.map(([, time]) => time);

  if (others > 0) {
    labels.push("Other");
    values.push(others);
  }

  const theme = getComputedStyle(document.documentElement)
    .getPropertyValue("--theme-color")
    .trim();

  const colors = [
    theme,
    "rgba(255,255,255,0.8)",
    "rgba(255,255,255,0.6)",
    "rgba(255,255,255,0.4)",
    "rgba(255,255,255,0.2)",
    "rgba(255,255,255,0.1)",
  ];

  currentChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderWidth: 0,
        hoverOffset: 4,
      }],
    },
    options: {
      cutout: "75%",
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(0,0,0,0.8)",
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label(context) {
              return ` ${formatTime(context.raw)}`;
            },
          },
        },
      },
    },
  });
}

function renderLimits(limits) {
  const list = document.getElementById("limitsList");
  list.innerHTML = "";

  const sortedLimits = Object.entries(limits)
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (!sortedLimits.length) {
    list.innerHTML =
      '<div class="empty-state">No limits yet. Add one for a gentle reminder.</div>';
    return;
  }

  sortedLimits.forEach(([domain, limitMs]) => {
    const row = document.createElement("div");
    row.className = "item item-limit";
    row.innerHTML = `
      <div class="limit-copy">
        <span>${domain}</span>
        <span class="time">${formatLimitLabel(limitMs)}</span>
      </div>
      <button class="ghost-button" data-domain="${domain}" type="button">Remove</button>
    `;
    list.appendChild(row);
  });
}

async function readDashboardData() {
  const data = await chrome.storage.local.get(["usage", "limits"]);
  const today = getTodayString();

  return {
    usage: data.usage?.[today] || {},
    limits: data.limits || {},
  };
}

async function renderPopup() {
  const { usage, limits } = await readDashboardData();
  const sorted = Object.entries(usage).sort((a, b) => b[1] - a[1]);

  renderList(sorted);
  renderSummary(sorted);
  renderChart(sorted);
  renderLimits(limits);
}

async function saveLimit(e) {
  e.preventDefault();

  const domainInput = document.getElementById("domainInput");
  const minutesInput = document.getElementById("limitMinutes");

  const domain = normalizeDomain(domainInput.value);
  const minutes = parseInt(minutesInput.value, 10);

  if (!domain) {
    setStatus("Enter a valid domain like youtube.com.", true);
    return;
  }

  if (!Number.isFinite(minutes) || minutes <= 0) {
    setStatus("Enter a limit in whole minutes.", true);
    return;
  }

  const data = await chrome.storage.local.get(["limits"]);
  const limits = data.limits || {};

  limits[domain] = minutes * 60 * 1000;

  await chrome.storage.local.set({ limits });
  await chrome.runtime.sendMessage({ type: "limit-updated", domain }).catch(() => {});

  domainInput.value = "";
  minutesInput.value = "";

  setStatus(`Limit saved for ${domain}.`);
  await renderPopup();
}

async function removeLimit(domain) {
  const data = await chrome.storage.local.get(["limits", "lastNotified"]);

  const limits = { ...data.limits };
  const lastNotified = { ...data.lastNotified };

  delete limits[domain];
  delete lastNotified[domain];

  await chrome.storage.local.set({ limits, lastNotified });

  setStatus(`Removed limit for ${domain}.`);
  await renderPopup();
}

function attachEventHandlers() {
  document.getElementById("limitForm").addEventListener("submit", saveLimit);

  document.getElementById("limitsList").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-domain]");
    if (!btn) return;

    await removeLimit(btn.dataset.domain);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && (changes.usage || changes.limits)) {
      renderPopup().catch(() => {});
    }
  });
}

async function init() {
  attachEventHandlers();
  setStatus("Soft reminders help you stay intentional.");
  await renderPopup();
}

init();