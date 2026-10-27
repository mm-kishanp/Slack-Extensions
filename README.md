# Slack Last Message Time

A Chrome extension that shows the date and time of the last message (sent or received) next to every channel, DM and group DM in the Slack web app sidebar.

```text
Starred
  Virat Patel                11:12 PM
  Jon Roman Franco     Yesterday
  Alex                Sep 21
Direct messages
  Ayush                     6:42 PM
  Kumar                  Sep 23
```

## Install

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select this folder.
5. Open or reload <https://app.slack.com>.

After changing any file, click the **reload** icon on the extension card in `chrome://extensions`, then reload the Slack tab.

## Options

Click the extension icon in the Chrome toolbar to turn it on or off and pick a display format:

| Format   | Today                 | Earlier               |
|----------|-----------------------|-----------------------|
| Smart    | 3:45 PM               | Sep 12, 3:45 PM       |
| Full     | Sep 30, 2026, 3:45 PM | Sep 12, 2026, 3:45 PM |
| Compact  | 3:45 PM               | Yesterday / Mon / Sep 12 |
| Relative | 5m / 3h               | 2d / 3mo              |

Hover a time in the sidebar to see the full date and time.

## How it works

- The content script runs only on `app.slack.com`. It reads your existing Slack web session from the page, so there is nothing to log in to or configure. No data is sent anywhere other than Slack.
- API calls are made from the background service worker (`background.js`). Content scripts are bound by the page's CORS rules, and Slack's workspace API (`<workspace>.slack.com/api/`) is on a different origin than `app.slack.com`, so calling it directly from the page fails with `Failed to fetch`.
- It calls Slack's `client.counts` method, which returns the newest message timestamp for every channel, DM and group DM in a single request. If that fails, it falls back to `conversations.history` with `limit=1` for each conversation visible in the sidebar.
- Slack's sidebar is virtualized and re-renders often, so a `MutationObserver` re-applies the times whenever rows are added.

### Refresh rate and rate limits

- The times refresh every 30 seconds (`REFRESH_MS` in `content.js`), and again whenever the Slack tab regains focus.
- In normal mode that is one `client.counts` request per refresh, about 2 requests a minute. That is far below Slack's rate limits, and it is the same request the Slack web client already makes itself.
- In fallback mode it sends one `conversations.history` request per visible conversation, at most once every 30 seconds each. That can be much heavier with a long sidebar.
- If Slack ever rate-limits a request, the response is a temporary `ratelimited` error. It does not lock your account.

## Files

| File            | Purpose                                                       |
|-----------------|---------------------------------------------------------------|
| `manifest.json` | Extension manifest (Manifest V3)                              |
| `content.js`    | Reads the Slack session, loads timestamps, renders the sidebar times |
| `background.js` | Service worker that performs the Slack API requests           |
| `styles.css`    | Styling and right-alignment of the times                      |
| `popup.html`, `popup.js` | Toolbar popup for the on/off switch and display format |

## Troubleshooting

Open DevTools (F12) on the Slack tab, go to **Console**, and filter by `Slack Last Message Time`. On the first refresh the extension logs a line like this:

```text
[Slack Last Message Time] Loaded 143 conversation timestamps; found 25 sidebar rows (...)
```

- **`Loaded 0` or a `failed: <error>` line:** the API request failed. `invalid_auth` means the request was not sent with your Slack session.
- **`found 0 sidebar rows`:** Slack changed its page structure. The extension finds rows by the `data-qa-channel-sidebar-channel-id` attribute and names by `.p-channel_sidebar__name`. Inspect a sidebar row and update `ITEM_SEL` or the name selector in `content.js`.
- **`Could not read the Slack session`:** Slack changed where it stores the session (`localStorage` key `localConfig_v2`).

## Limitations

- Works only in Slack in the browser (`app.slack.com`), not in the Slack desktop app.
- It relies on Slack's internal web API and page structure, and either can change without notice.
- Check your workspace's policy on browser extensions before using it on a company Slack.
