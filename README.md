# Reaction Trainer

A mobile-friendly reaction / agility training web app. Pick cues (colours, arrows,
numbers, letters, shapes), timing and duration, then train. Results are shown at the end.
One phone can act as a remote for a bigger screen (TV, tablet, laptop).

## Run

```bash
npm start            # or: node server.js   (Node 18+, no dependencies)
```

The server prints a `Network:` address such as `http://192.168.x.x:8080`.
Open that on any device on the **same WiFi**. (Use `PORT=3000 npm start` to change the port.)

## Use a big screen

1. On the big screen open the address, then tap **Connect → Use this device as the display**.
   A 4-digit code appears. Tap **Enable sound & full screen** once.
2. On your phone open the same address, tap **Connect → Control a display** and enter the code.
3. Set up the drill on the phone and tap **📺 Start on display**. The phone becomes a remote with a live
   preview, Pause/Resume, Stop, plus a TAP button in tap-to-advance mode. Results appear on both devices.

## Features

- Cues: 8 colours, 8 arrow directions, numbers 1–9, letters A–Z, 8 shapes. Can call them out loud (🔊),
  colour the symbols (e.g. a red left arrow), avoid repeats, beep on each cue, audio-only mode.
- Timing: **Timed** (show-for plus gap, both optionally random within a range), or **Tap to advance**, which
  measures your reaction time.
- Duration: a number of cues (or unlimited) or a fixed time, multiple sets with rest, and a start countdown.
- Results: cues shown, active time, average/fastest/slowest reaction, a chart per cue, a breakdown per cue,
  and one-tap Repeat.
- Saved drills (stored in the browser). Keeps the screen awake where supported.
- Keyboard during a session: Space/Enter = tap, P = pause, Esc = stop.

## Notes

- Reaction times are most accurate when you tap the display itself. Taps from the remote include WiFi latency.
- Bluetooth is not used. Browsers cannot pair phones directly, so devices talk through this small server
  over your local network.
- The screen-awake lock needs HTTPS or localhost. Over plain LAN HTTP, set the screen timeout on the display device instead.
