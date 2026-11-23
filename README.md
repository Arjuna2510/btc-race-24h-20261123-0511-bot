# btc-race-24h-20261123-0511-bot

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/Arjuna2510/btc-race-24h-20261123-0511-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/Arjuna2510/btc-race-24h-20261123-0511-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A dip-recovery trading bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty, $50 in USDC. It trades cbBTC/USDC minute by minute on on-chain prices: it buys pullbacks 0.8% below the trailing 240-bar high when the 9-bar EMA turns up, exits at +1% take profit, a 1% trailing stop, or 360 bars held, waits 120 bars between round trips, and stops trading for the window once realised losses reach $8. Built by an AI agent for make.fun's "Race a BTC trading bot live for 24 hours" bounty, $50 in USDC.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/bars-replay/v1 on stdin/stdout (Node 22, standard library only; the vendored SDK shim lives in `vendor/`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=calm-koala-24&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
