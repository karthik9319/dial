# Dial — a gamified Pomodoro focus console

A local, offline-first Pomodoro timer with XP, levels, streaks, and badges. No backend, no build
step, no dependencies — just HTML, CSS, and vanilla JS.

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
  triggers a long break; the others trigger a short break. Mode can only be changed while the
  timer is paused or stopped.
- **To-do list**: each task carries an estimated duration. Hitting ▶ loads it into the timer as a
  Custom session and starts it; finishing checks the task off. Time actually spent accumulates on
  the task (including sessions you reset partway), so estimates can be compared against reality.
- **XP**: +20 XP per completed focus or custom session, plus a streak bonus of +2 XP per current
  streak day (capped at +20). Breaks earn no XP.
- **Levels**: level `N` requires `100 + (N-1)*40` XP; leftover XP carries into the next level.
- **Streaks**: consecutive calendar days with at least one completed focus session. A missed day
  resets the current streak back to 1 on your next session.
- **Daily goal**: a target number of sessions per day (8 by default), shown on the Today counter
  and as a dashed line across the stats chart.
- **Stats**: rolling totals for today / 7 days / 30 days, plus a 7-day sessions-per-day chart.
- **Badges**: First Sprint, 5-Day Streak, 10-Day Streak, 6 in One Day, Level 5, Before 7am, and
  50 Sessions — unlock automatically as you hit each milestone.
- **Settings**: mode durations, daily goal, alarm sound (three synthesised options, or silent),
  alarm volume, auto-start next session, and session-end notifications.

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
