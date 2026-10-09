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
- **Walk around town** (🚶 in Focus mode): explore a town in first person, in
  chunky pixel art. Its streets, buildings (by era), station, trains and city
  transit come from your game. Left thumb walks, dragging on the right looks
  around (WASD/arrows and the mouse on a computer). On the platform or at a
  stop, wait for the train, bus, tram or metro to come in (a countdown shows
  when), then tap **Board**. **🚶 Get off** works once you're standing at a
  station or stop, and drops you in that town. Trains and city transit wait
  a few seconds at each stop. Rain and snow fall as you walk; trees, lamps,
  kiosks and the like are solid. Signposts at the edge of town walk you to the
  next town.
- Focus mode draws at 30 fps to save battery; turn on **Menu → Smooth
  animation** for 60 fps.
- **Tap** for a burst of steam and a small speed boost for that train (in
  passenger view it also nudges the tea). **Hold** to blow the whistle.
  **Swipe** to switch to a different train.
- Your screen stays awake while Focus mode is open, where the browser supports it.
- Every **5 minutes** in Focus mode earns a **focus token** ◉. Spend tokens on
  permanent Perks (more revenue, faster growth, faster trains, longer away time).

## Download

### Android
Open **https://vladk-iii.github.io/idle-game/** on your phone and tap
**Download for Android**. Then open the file, allow your browser to install
unknown apps if asked, and tap **Install** (choose **Install anyway** if Play
Protect warns you; that's normal for apps from outside the Play Store).

A fresh APK is built and published there on every push to `main`. To update,
download and install it again; your railway is kept. You can also attach an
APK to a GitHub Release by pushing a tag:

```sh
git tag v1.0.0
git push origin v1.0.0
```

### iPhone, or any browser
The browser version is at **https://vladk-iii.github.io/idle-game/play/**. On an
iPhone, open it in Safari and tap Share → **Add to Home Screen**.

### One-time GitHub setup
The site is deployed by GitHub Actions. In the repo, go to **Settings → Pages**
and set **Source** to **GitHub Actions**.

## Development

The game itself needs no build tools. Serve the folder and open it in a browser:

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
| `js/scenery.js` | Painted landscape for the Focus views: cumulus, mountains, rock stacks, hills, meadow, aurora |
| `js/buildings.js` | City buildings by era: brick (to 1880), Art Deco towers, theatres and civic halls (1880–1979), glass towers, residential blocks, malls and a TV tower (1980 on) |
| `js/walk.js` | Walking around a town in first person: a grid raycaster (textured walls, floors, sky panorama, sprites, trains on the tracks) in a small pixel buffer, with a thumbstick, head-bob and your hands holding a ticket; board trains and city transit from here |
| `js/street.js` | Riding a city's bus, light rail or metro: street, skyline, stops, tunnel and the inside of the vehicle |
| `js/water.js` | Water look shared by the map and Focus views: streaks, lily pads, water lilies |
| `js/trains.js` | Steam (0-4-0 to 2-8-2), diesel and electric engines, tenders, wooden and steel wagons |
| `js/gl2d.js` | WebGL2 renderer that runs the Focus views' canvas drawing on the GPU |
| `sw.js` | Offline cache. Bump `CACHE` when you change files so phones update |

The Android app wraps the same files with [Capacitor](https://capacitorjs.com/)
(`android/`). `npm run sync` copies the game into the Android project, and
`cd android && ./gradlew assembleRelease` builds the APK (needs JDK 21 and the
Android SDK). The app is signed with `android/app/branchline-release.keystore`
so updates install over the previous version.

`window.branchline` exposes `{ game, map, ride }` in the browser console for
debugging.

## Credits

The steam engines, wagons and rails are adapted from
[Pixel Train](https://kooky.itch.io/pixel-train) by [Kooky](https://kooky.itch.io/),
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). They
are redrawn in the game's smooth cartoon style rather than used as pixel art.

The landscapes (clouds, mountains, hills, aurora) take their art direction
from [CraftPix](https://craftpix.net) pixel-art backgrounds
([licence](https://craftpix.net/file-licenses/)). No CraftPix files are
included; the scenery is painted in code.
