# 🚂 Branch Line — a calm idle railway

A small Transport Fever-style railway tycoon for your phone. It's built to be a
low-effort fidget for online classes and meetings: you make progress when you
have a spare moment, and when you need to pay attention there's a calm
**Focus mode** that keeps your hands busy without needing your brain.

## How to play

- **Build lines.** Tap a town, choose **Build line from here**, then tap another
  town. Each new line comes with one train.
- **Make supply chains.** Farm 🌾 → Food Plant → towns 🥫, Forest 🪵 → Sawmill →
  towns 📦, and Coal Mine 🪨 → Power Plant. Towns that get food and goods grow,
  and industries level up the more you ship from them.
- **Move through the eras.** The calendar starts in 1850. New locomotives
  arrive over time, from steam to diesel, electric, high-speed and maglev.
  Upgrade a line's trains from the line's panel.
- **Earn while you're away.** Trains keep earning while the app is closed (8h
  cap at first).

## Focus mode 🎧

Tap **Focus** when class needs your attention:

- It follows one of your real trains through a slow day/night cycle. The view
  button (top right) cycles through four views:
  - 🚂 **Trackside**: watch your train roll past from beside the line.
  - 💺 **Passenger**: sit in a carriage looking out of the window, with a cup of
    tea on the table that sloshes as the train sways. The carriage interior
    changes with the era.
  - 🕹️ **Cab**: the driver's view down the line, with stations coming up ahead
    and working gauges. Steam engines have a brass speedometer, pressure gauge
    and regulator; modern engines have a "next station" screen.
  - 🗺️ **Map**: a dimmed overview of your whole network.
- The views are built from the real map. The track bends as your line does,
  bridges appear where the line crosses the river or a lake, and the trees,
  towns and industries beside the line are the ones on the map. A mini-map in
  the corner shows where the train is.
- Trains are drawn cut away: coaches show their passengers and wagons show
  their cargo, both in proportion to what the train is really carrying.
  Stations show who (or what) is waiting there.
- Weather follows the game calendar: snow in winter (settling on the ground,
  trees and roofs), showers in spring and autumn, autumn colours in October and
  mostly fair summers. Rain streaks past, runs across the passenger window and is
  swept away by the cab's wiper. The current weather shows next to the date.
  The map turns golden in autumn and snowy (with frozen lakes) in winter, with
  rain or snow falling over it, and trains wear snow and icicles in winter.
- The cab view looks out through a chunky windscreen with a charm that swings
  as the train moves (tap to jiggle it); steam cabs have a glowing firebox.
- Focus mode draws at 30 fps to save battery; turn on **Menu → Smooth
  animation** for 60 fps.
- **Tap** for a burst of steam and a small speed boost for that train (in
  passenger view it also nudges the tea). **Hold** to blow the whistle.
  **Swipe** to switch to a different train.
- Your screen stays awake while Focus mode is open, where the browser supports it.
- Every **5 minutes** in Focus mode earns a **focus token** ◉. Spend tokens on
  permanent Perks (more revenue, faster growth, faster trains, longer away time).

## Install on your phone

The game is a static web app (a PWA), so GitHub Pages can host it with no
build step.

1. On GitHub: **Settings → Pages → Build and deployment**. Set **Source:
   Deploy from a branch**, pick the branch (e.g. `main`) and the **/ (root)**
   folder, then **Save**.
2. Wait a minute, then open `https://<your-username>.github.io/<repo-name>/` on
   your phone.
3. **iPhone:** in Safari, tap Share → **Add to Home Screen**.
   **Android:** in Chrome, tap ⋮ → **Install app**.

Once installed it opens full-screen and works offline. Progress is saved on
the device. Use **Menu → Copy save code** to back it up or move it to another
device.

## Development

No build tools are needed. Serve the folder and open it in a browser:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

| File | Purpose |
| --- | --- |
| `js/sim.js` | Game state, economy, trains, away earnings, saving |
| `js/world.js` | Seeded map generation and track curves |
| `js/map.js` | Top-down map rendering and touch pan/zoom |
| `js/ride.js` | Focus-mode views (trackside, passenger, cab) and mini-map |
| `js/toon.js` | Cartoon drawing helpers: outlines, gloss, little people, trees, clouds |
| `js/route.js` | What lies along a line on the map: track shape, trees, water, bridges, towns |
| `js/main.js` | UI, sheets, focus mode, game loop |
| `js/data.js` | Cargo, industries, locomotives, perks |
| `sw.js` | Offline cache. Bump `CACHE` when you change files so phones update |

`window.branchline` exposes `{ game, map, ride }` in the browser console for
debugging.
