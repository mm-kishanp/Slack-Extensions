const defaults = { format: 'smart', enabled: true };
const formatEl = document.getElementById('format');
const enabledEl = document.getElementById('enabled');

chrome.storage.sync.get(defaults, (s) => {
  formatEl.value = s.format;
  enabledEl.checked = s.enabled;
});

formatEl.addEventListener('change', () => chrome.storage.sync.set({ format: formatEl.value }));
enabledEl.addEventListener('change', () => chrome.storage.sync.set({ enabled: enabledEl.checked }));
