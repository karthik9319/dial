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

- **Modes**: Focus (25m), Short Break (5m), Long Break (15m). Every 4th completed focus session
  triggers a long break; the others trigger a short break. Mode can only be changed while the
  timer is paused or stopped.
- **XP**: +20 XP per completed focus session, plus a streak bonus of +2 XP per current streak day
  (capped at +20). Breaks earn no XP.
- **Levels**: level `N` requires `100 + (N-1)*40` XP; leftover XP carries into the next level.
- **Streaks**: consecutive calendar days with at least one completed focus session. A missed day
  resets the current streak back to 1 on your next session.
- **Badges**: First Sprint, 5-Day Streak, 10-Day Streak, 6 in One Day, Level 5, Before 7am, and
  50 Sessions — unlock automatically as you hit each milestone.

## Running the test suite

The XP/level, streak, badge-unlock, and formatting logic lives in `logic.js` as
plain, dependency-free functions (loaded as `window.DialLogic` in the browser,
`require`-able from Node). It's covered by a suite using Node's built-in test
runner, so there's nothing to install:

```
node --test
```

## Wrapping as a native macOS app (optional, via Electron)

The `electron/` folder contains a minimal wrapper that loads the same `index.html`/`styles.css`/
`app.js` files with no changes needed. This is entirely optional — the app works fine as a plain
web page.

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
