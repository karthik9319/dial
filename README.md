# Dial — focus better, estimate smarter

A local, offline-first focus timer that helps you compare estimated task time with the time you
actually spend. XP, unlockable dial finishes, streaks, and badges add motivation without getting
between you and the timer. No backend, no build step, no dependencies — just HTML, CSS, and
vanilla JS.

## Running it

Just open `index.html` in a browser:

```
open index.html
```

(or double-click the file in Finder). Everything — the timer, the beep, XP/level/streak tracking,
badges, and the session log — works entirely client-side. State is saved to `localStorage`, so
your progress persists between visits on the same browser/profile. If storage is unavailable
(e.g. private browsing), the app still works, it just won't remember state after you close it.

Google Fonts (Fraunces, IBM Plex Mono, Inter) are loaded from a CDN for the intended look, but
the app is fully functional offline with system-font fallbacks if there's no network connection.

## How it works

- **Modes**: Focus, Short Break, Long Break (durations are configurable in Settings; 25/5/15 by
  default) plus Custom, a one-off duration for small errands. Every 4th completed focus session
  triggers a long break; Custom sessions always lead to a short break and do not change that
  cadence. Mode can only be changed while the timer is paused or stopped.
- **Current focus + Next up**: each queued task carries an estimated duration and an optional
  category. Hitting ▶ moves it into Current focus, loads its estimate as a Custom session, and
  starts it. Time actually spent accumulates across blocks and partial resets.
- **End-of-block decision**: an elapsed timer logs a focus block but does not pretend the task is
  finished. Dial asks whether it is Done, needs another same-length block, needs five more minutes,
  or should return to the queue. A quick category and reflection note can be added at that point.
- **Estimate accuracy**: tasks explicitly marked Done feed a rolling 30-day comparison of estimated
  versus actual time, a within-20% accuracy score, and a category-level prompt for work you most often
  underestimate. Continued and queued blocks are excluded until the task is really finished.
- **XP**: +20 XP per completed focus or custom session, plus a streak bonus of +2 XP per current
  streak day (capped at +20). Breaks earn no XP.
- **Levels and rewards**: level `N` requires `100 + (N-1)*40` XP, capped at 500 XP per level;
  leftover XP carries forward. Levels 2–9 unlock Copper, Jade, Cobalt, Amethyst, Graphite,
  Rose Gold, Frost, and Ember finishes. Level 10 unlocks the Chronograph dial and its badge.
- **Focus Tokens + Workshop**: every level reached after Level 10 awards one token. Tokens buy
  optional backdrops, the Precision dial face, and a Soft Gong alarm in Settings. Purchases are
  local and permanent, while all practical focus features remain available without tokens.
- **Streaks**: consecutive calendar days with at least one completed focus session. A missed day
  resets the current streak back to 1 on your next session.
- **Daily goal**: a target number of sessions per day (8 by default), shown on the Today counter
  and as a dashed line across the stats chart.
- **Stats**: rolling totals for today / 7 days / 30 days, plus a 7-day sessions-per-day chart.
- **Portable data**: Settings can download a complete JSON backup, restore one after confirmation,
  or export the session history as CSV. A restore replaces only Dial's local state; in-progress
  timers are intentionally not included.
- **Badges**: First Sprint, 5-Day Streak, 10-Day Streak, 6 in One Day, Levels 5 and 10, Before
  7am, and 50 Sessions — unlock automatically as you hit each milestone.
- **Settings**: mode durations, daily goal, unlocked cosmetics, alarm sounds (including the
  Workshop reward or silent mode), volume, auto-start, notifications, data tools, and the
  desktop-only Focus Guard.

## Running the test suite

The XP/level, streak, badge-unlock, and formatting logic lives in `logic.js` as
plain, dependency-free functions (loaded as `window.DialLogic` in the browser,
`require`-able from Node). It's covered by a suite using Node's built-in test
runner, so there's nothing to install:

```
node --test
```

## Wrapping as a native macOS app (optional, via Electron)

The `electron/` folder contains a wrapper that loads the same `index.html`/`styles.css`/`app.js`
files with no changes needed. This is entirely optional — the app works fine as a plain web page,
where the desktop-only extras below are simply absent.

Running under Electron adds:

- **A menu-bar countdown.** The remaining time sits in the macOS menu bar, with Start/Pause,
  Reset, Show and Quit in its menu. Closing the window only hides it, so the timer keeps running.
- **Session-end alerts.** A native notification plus a Dock bounce when a session ends and Dial
  isn't the focused app.
- **Optional Focus Guard.** While a Focus or Custom timer is running, Dial can watch for a
  user-supplied list of macOS application names (for example `Slack, Discord, Music`), hide a listed
  app if it becomes frontmost, and bring Dial back. It stops immediately on pause, reset, break, or
  completion. macOS may ask for Automation permission because this uses System Events. It blocks
  app windows, not individual websites; browser-only Dial cannot control other applications.

⚠️ macOS refuses notifications from unpackaged apps (`npm start` runs the generic `Electron.app`
bundle, which is also why the Dock says "Electron"). In development you'll get the Dock bounce
and the alarm sound but no notification banner — build the app to get all three.

```
cd electron
npm install
npm start
```

To build a distributable `.app`:

```
npm run build
```

(uses `electron-builder`, configured for a macOS target in `package.json`).
