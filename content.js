// Slack Last Message Time - content script
// Reads the last message timestamp of every conversation from Slack's own web API
// (the same session the Slack web client uses) and renders it in the sidebar.
(() => {
  const REFRESH_MS = 30 * 1000;
  const ITEM_SEL = '[data-qa-channel-sidebar-channel-id]';
  const ID_ATTR = 'data-qa-channel-sidebar-channel-id';
  const TAG_CLASS = 'slmt-time';

  const latestById = new Map(); // conversation id -> last message time (ms)
  const historyFetchedAt = new Map(); // conversation id -> when we last fetched it (fallback mode)
  let settings = { format: 'smart', enabled: true };
  let useHistoryFallback = false;
  let currentTeamId = null;
  let refreshing = false;
  let renderQueued = false;

  // ---------- Auth / API ----------

  function getTeamIdFromUrl() {
    const m = location.pathname.match(/\/client\/([A-Z0-9]+)/i);
    return m ? m[1] : null;
  }

  function getAuth() {
    let cfg;
    try {
      cfg = JSON.parse(localStorage.getItem('localConfig_v2'));
    } catch {
      return null;
    }
    if (!cfg || !cfg.teams) return null;

    const teamId = getTeamIdFromUrl() || cfg.lastActiveTeamId;
    const team =
      cfg.teams[teamId] ||
      Object.values(cfg.teams).find((t) => t.enterprise_id === teamId || t.id === teamId) ||
      cfg.teams[cfg.lastActiveTeamId];
    if (!team || !team.token) return null;

    const bases = [];
    if (team.url) bases.push(team.url.replace(/\/?$/, '/') + 'api/');
    bases.push('https://app.slack.com/api/');
    return { teamId, token: team.token, apiBases: bases };
  }

  // API calls go through the background worker to avoid the page's CORS restrictions.
  async function callApi(auth, method, params = {}) {
    const data = await chrome.runtime.sendMessage({
      type: 'slackApi',
      bases: auth.apiBases,
      method,
      token: auth.token,
      params,
    });
    if (!data) throw new Error(method + ': no response from background');
    return data;
  }

  function tsToMs(ts) {
    const n = parseFloat(ts);
    return n > 0 ? Math.round(n * 1000) : 0;
  }

  // One call returns the latest message ts for every channel, group DM and DM.
  async function loadFromClientCounts(auth) {
    const data = await callApi(auth, 'client.counts', { thread_counts_by_channel: 'false' });
    if (!data.ok) throw new Error('client.counts: ' + data.error);
    for (const list of [data.channels, data.mpims, data.ims]) {
      for (const c of list || []) {
        const ms = tsToMs(c.latest);
        if (ms) latestById.set(c.id, ms);
      }
    }
  }

  // Fallback: ask for the newest message of each conversation visible in the sidebar.
  async function loadFromHistory(auth) {
    const now = Date.now();
    const ids = [...new Set([...document.querySelectorAll(ITEM_SEL)].map((el) => el.getAttribute(ID_ATTR)))];
    for (const id of ids) {
      if (!id || now - (historyFetchedAt.get(id) || 0) < REFRESH_MS) continue;
      historyFetchedAt.set(id, now);
      try {
        const data = await callApi(auth, 'conversations.history', { channel: id, limit: '1' });
        if (!data.ok) logOnce('history-' + data.error, 'conversations.history failed: ' + data.error);
        const ms = data.ok && data.messages && data.messages[0] ? tsToMs(data.messages[0].ts) : 0;
        if (ms) latestById.set(id, ms);
      } catch {
        // ignore single-channel failures
      }
    }
  }

  async function refresh() {
    if (refreshing || !settings.enabled) return;
    const auth = getAuth();
    if (!auth) {
      logOnce('noauth', 'Could not read the Slack session from localStorage (localConfig_v2).');
      return;
    }

    if (auth.teamId !== currentTeamId) {
      currentTeamId = auth.teamId;
      latestById.clear();
      historyFetchedAt.clear();
      useHistoryFallback = false;
    }

    refreshing = true;
    try {
      if (!useHistoryFallback) {
        try {
          await loadFromClientCounts(auth);
        } catch (e) {
          console.warn('[Slack Last Message Time] client.counts failed, using fallback:', e.message);
          useHistoryFallback = true;
        }
      }
      if (useHistoryFallback) await loadFromHistory(auth);
    } finally {
      refreshing = false;
      render();
      logOnce(
        'status',
        `Loaded ${latestById.size} conversation timestamps; ` +
          `found ${document.querySelectorAll(ITEM_SEL).length} sidebar rows (${ITEM_SEL}).`
      );
    }
  }

  const logged = new Set();
  function logOnce(key, message) {
    if (logged.has(key)) return;
    logged.add(key);
    console.info('[Slack Last Message Time] ' + message);
  }

  // ---------- Formatting ----------

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function formatTime(ms) {
    const d = new Date(ms);
    const now = new Date();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    switch (settings.format) {
      case 'relative': {
        const s = Math.max(0, Math.floor((now - d) / 1000));
        if (s < 60) return 'now';
        if (s < 3600) return Math.floor(s / 60) + 'm';
        if (s < 86400) return Math.floor(s / 3600) + 'h';
        if (s < 86400 * 30) return Math.floor(s / 86400) + 'd';
        if (s < 86400 * 365) return Math.floor(s / (86400 * 30)) + 'mo';
        return Math.floor(s / (86400 * 365)) + 'y';
      }
      case 'full':
        return d.toLocaleString([], {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
      case 'compact':
        if (sameDay(d, now)) return time;
        if (sameDay(d, yesterday)) return 'Yesterday';
        if (now - d < 6 * 86400 * 1000) return d.toLocaleDateString([], { weekday: 'short' });
        return d.toLocaleDateString([], {
          month: 'short',
          day: 'numeric',
          ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
        });
      case 'smart':
      default:
        if (sameDay(d, now)) return time;
        if (sameDay(d, yesterday)) return 'Yesterday ' + time;
        if (d.getFullYear() === now.getFullYear()) {
          return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + time;
        }
        return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    }
  }

  function fullTitle(ms) {
    return (
      'Last message: ' +
      new Date(ms).toLocaleString([], {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      })
    );
  }

  // ---------- Rendering ----------

  const BADGE_SEL = '[class*="badge"], [data-qa*="badge"], [class*="mention"]';

  // The full-width flex container of a sidebar row: the closest flex ancestor of the
  // name that spans (almost) the whole row.
  function findRowContainer(item, name) {
    const itemWidth = item.getBoundingClientRect().width;
    for (let el = name.parentElement; el && item.contains(el); el = el.parentElement) {
      if (!getComputedStyle(el).display.includes('flex')) continue;
      if (!itemWidth || el.getBoundingClientRect().width >= itemWidth * 0.8) return el;
    }
    return null;
  }

  function insertTag(item, tag) {
    const name = item.querySelector('.p-channel_sidebar__name');
    const row = name && findRowContainer(item, name);
    if (!row) {
      (item.querySelector('a') || item).appendChild(tag);
      return;
    }
    // Place the time at the right edge of the row, before any unread/mention badge.
    let nameChild = name;
    while (nameChild.parentElement !== row) nameChild = nameChild.parentElement;
    nameChild.classList.add('slmt-name-cell');
    let before = null;
    for (let sib = nameChild.nextElementSibling; sib; sib = sib.nextElementSibling) {
      if (sib.matches(BADGE_SEL) || sib.querySelector(BADGE_SEL)) {
        before = sib;
        break;
      }
    }
    row.insertBefore(tag, before);
  }

  function render() {
    renderQueued = false;
    for (const item of document.querySelectorAll(ITEM_SEL)) {
      const id = item.getAttribute(ID_ATTR);
      const ms = settings.enabled ? latestById.get(id) : 0;
      let tag = item.querySelector('.' + TAG_CLASS);

      if (!ms) {
        if (tag) tag.remove();
        continue;
      }
      if (!tag) {
        tag = document.createElement('span');
        tag.className = TAG_CLASS;
        insertTag(item, tag);
      }
      const text = formatTime(ms);
      const title = fullTitle(ms);
      if (tag.textContent !== text) tag.textContent = text;
      if (tag.title !== title) tag.title = title;
    }
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  }

  // ---------- Wiring ----------

  // Slack's sidebar is virtualized and re-renders often, so re-apply tags on DOM changes.
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.addedNodes.length) {
        queueRender();
        if (useHistoryFallback) refresh();
        return;
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  chrome.storage.sync.get(settings, (stored) => {
    settings = { ...settings, ...stored };
    refresh();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, { newValue }] of Object.entries(changes)) settings[key] = newValue;
    if (settings.enabled) refresh();
    render();
  });

  setInterval(refresh, REFRESH_MS);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
})();
