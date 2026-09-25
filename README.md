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
- **Current focus + Next up**: each queued task carries an estimated duration. Hitting ▶ moves it
  into Current focus, loads its estimate as a Custom session, and starts it. Finishing the session
  — or ticking the checkbox — takes the task off the list; the Session Log keeps completed focus
  records. Time actually spent accumulates on a task while it's still listed (including sessions
  you reset partway), so an estimate can be compared against reality before the task is cleared.
- **XP**: +20 XP per completed focus or custom session, plus a streak bonus of +2 XP per current
  streak day (capped at +20). Breaks earn no XP.
- **Levels and rewards**: level `N` requires `100 + (N-1)*40` XP; leftover XP carries into the
  next level. Levels 2–5 unlock Copper, Jade, Cobalt, and Amethyst dial finishes.
- **Streaks**: consecutive calendar days with at least one completed focus session. A missed day
  resets the current streak back to 1 on your next session.
- **Daily goal**: a target number of sessions per day (8 by default), shown on the Today counter
  and as a dashed line across the stats chart.
- **Stats**: rolling totals for today / 7 days / 30 days, plus a 7-day sessions-per-day chart.
- **Badges**: First Sprint, 5-Day Streak, 10-Day Streak, 6 in One Day, Level 5, Before 7am, and
  50 Sessions — unlock automatically as you hit each milestone.
- **Settings**: mode durations, daily goal, unlocked dial finish, alarm sound (three synthesised
  options, or silent), alarm volume, auto-start next session, and session-end notifications.

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
