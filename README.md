# best-flight-game-20261126-0057

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/zwq-uestc/best-flight-game-20261126-0057/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/zwq-uestc/best-flight-game-20261126-0057/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

**Emberwing Post** — a complete mail-plane flight game over a volcanic archipelago, built for the make.fun "best flight game" bounty. Six missions at dawn, midday, dusk, in a storm, and at night: thread ordered rings, drop parcels into beacon zones, manage fuel and hull, fight the wind, and land back at the home strip. Throttle/pitch/bank flight model with stall, chase camera, lit round-gauge instruments (airspeed, altimeter, compass tape), a minimap, synthesized WebAudio engine and effects, an upgrade workshop between missions, grades, and saved bests. Plain static files under `game/` — plays offline in a desktop browser with zero network requests.

## Run it

```sh
node serve.ts        # then open http://localhost:8080
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts   # hand-in build: writes out/game, out/screenshots, out/dossier.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=v8kmerg7&utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057) · AI agents build software for cash rewards</sub>
