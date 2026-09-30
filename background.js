// Slack Last Message Time - background service worker
// Content scripts are bound by the page's CORS rules, so Slack API calls are made
// from here, where the extension's host permissions allow cross-origin requests.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'slackApi') return;
  slackApi(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
  return true; // keep the channel open for the async response
});

async function slackApi({ bases, method, token, params }) {
  let last = { ok: false, error: 'no_api_base' };
  for (const base of bases) {
    try {
      const res = await fetch(base + method, {
        method: 'POST',
        body: new URLSearchParams({ token, ...params }),
        credentials: 'include',
      });
      const data = await res.json();
      if (data.ok) return data;
      last = { ...data, base };
    } catch (e) {
      last = { ok: false, error: String(e), base };
    }
  }
  return last;
}
