# Reaction Trainer

A mobile-friendly reaction / agility training web app. Pick cues (colours, arrows,
numbers, letters, shapes), timing and duration, then train. Results are shown at the end.
One phone can act as a remote for a bigger screen (TV, tablet, laptop).

## Use it

**Hosted:** `https://victor77dev.github.io/training/` (after GitHub Pages is enabled, see below).
Open it once while online. After that it also works offline, and you can add it to your home screen.

**Local:** `npm start` (Node 18+, no dependencies) and open the `Network:` address it prints.

## Connect a big screen

Tap **Connect** on both devices. On the big screen choose how to pair:

| Method | Needs | How |
|---|---|---|
| **Pairing code** | Internet on both devices | The big screen shows a 6-digit code. Enter it on the phone. |
| **QR code** | Same WiFi or hotspot, a camera on the big screen. No internet needed. | The big screen shows a QR code. The phone uses **Scan QR from the big screen** and then shows a reply QR, which the big screen scans with **Scan the phone's reply**. |
| **Local code** | `npm start` on a computer, same WiFi | Only shown when the app is opened from the local server. The big screen shows a 4-digit code. |

Then set up the drill on the phone and tap **📺 Start on display**. The phone becomes a remote with a live
preview, Pause/Resume, Stop, and a TAP button in tap-to-advance mode. Results appear on both devices.
On the big screen, tap **Enable sound & full screen** once, because browsers block sound until you tap.

### How the connection works

- **Pairing code and QR code** use a WebRTC data channel: a direct, encrypted link between the two browsers.
  The code or QR only carries the short setup message (the "handshake"). The pairing code uses the free
  [PeerJS](https://peerjs.com/) cloud service for that. QR codes carry it themselves, so no server is involved.
- **Local code** sends every message through `server.js` (Server-Sent Events + POST).
- Bluetooth is not used. Browsers don't allow phone-to-phone Bluetooth or WiFi Direct.

## Features

- Cues: 8 colours, 8 arrow directions, numbers 1–9, letters A–Z, 8 shapes. Can call them out loud (🔊),
  colour the symbols (e.g. a red left arrow), avoid repeats, beep on each cue, audio-only mode.
- Screen between cues: **Dark** or **White**. On white, symbols turn black and coloured symbols get a thin outline.
  The colour matching the background (black on dark, white on white) is skipped automatically.
- Timing: **Timed** (show-for plus gap, both optionally random within a range), or **Tap to advance**, which
  measures your reaction time.
- Duration: a number of cues (or unlimited) or a fixed time, multiple sets with rest, and a start countdown.
- Results: cues shown, active time, average/fastest/slowest reaction, a chart per cue, a breakdown per cue,
  and one-tap Repeat.
- App theme: light by default (even in phone Dark Mode). The ☀️/🌙/🌗 button switches Light / Dark / Auto.
- Saved drills (stored in the browser). Keeps the screen awake where supported.
- Keyboard during a session: Space/Enter = tap, P = pause, Esc = stop.

## GitHub Pages setup (one time)

1. The repo must be public (or on a paid plan).
2. Go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main`. `.github/workflows/pages.yml` publishes the `public/` folder.

## Project layout

```
public/            the app (served as-is, no build step)
  index.html       screens and dialogs
  style.css
  app.js           setup UI, session engine, stats, remote/display logic
  net.js           connection layer: local relay, online code (PeerJS), QR (manual WebRTC)
  pair.js          QR drawing/scanning and the two-step pairing flow
  sw.js            offline caching
  vendor/          qrcode-generator, jsQR, PeerJS (see vendor/README.md)
server.js          optional local server + message relay
```

## Notes

- Reaction times are most accurate when you tap the display itself. Taps from the remote include network delay.
- Scanning QR codes needs the camera, which browsers only allow over HTTPS (GitHub Pages) or `localhost`.
  On the plain `http://` LAN address, use the copy & paste option in the pairing dialog.
- A TV browser usually has no camera, so use the pairing code (internet) or the local code.
- When online, the app always loads the latest version; the offline copy is used only without a connection.
