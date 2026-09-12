# Clocktowerdle

A daily character-guessing game for **Blood on the Clocktower**. Name the hidden
character; every guess is compared against it across seven attributes and comes
back as a row of green, amber and grey.

```
                  Type      Script    Wakes     Order   Ability   Rem.  Jinx
  Washerwoman     Townsfolk    TB     First night  49   information  2▼   0▲
  Imp             Demon        TB     Other nights 14   killing      1▼   1▲
  Baron           Minion       TB     Never       N/A   setup mod.   0    2
```

## Modes

| Mode | Pool | Notes |
|---|---|---|
| **Daily Classic** | Trouble Brewing, Bad Moon Rising, Sects & Violets, and their travellers (87) | Same puzzle for everyone, resets 00:00 UTC |
| **Daily Full** | Every player character including experimentals (156) | The harder daily |
| **Endless** | Your choice of pools | Replayable, optional Fabled and Loric |
| **Versus** | Ranked uses the Daily Full pool | Two players, three rounds, Elo rated |
| **Archive** | Any past daily | Replays never affect your streak |

Dailies have no guess limit: a hangman reveal of the name opens after four wrong
guesses and uncovers a letter per wrong guess after that, so you always get
there eventually. Versus deduction rounds are capped at eight.

## Documentation

| Document | For |
|---|---|
| [SETUP.md](SETUP.md) | Getting a Supabase project running from scratch |
| [DEPLOY.md](DEPLOY.md) | Hosting it on Vercel and shipping updates |
| [docs/GAME.md](docs/GAME.md) | The rules, the clue columns, and why they are what they are |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it is built and how to change it safely |

## Running it locally

```bash
npm install
npm run dev
```

Endless works with no backend at all. The dailies, collection, stats and Versus
need a Supabase project, see [SETUP.md](SETUP.md).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :5173 |
| `npm run build` | Production build into `dist/` |
| `npm test` | 152 unit tests over the game engine |
| `npm run build:data` | Re-fetch characters and token art from the official source |
| `npm run build:dailies` | Regenerate the puzzle schedule |
| `npm run analyse:clues` | Measure how well the current clue grid discriminates |
| `npm run verify:parity` | Prove the TypeScript and SQL engines agree |

## Built with

Vite, React, TypeScript and MUI on the front end; Supabase (Postgres, auth and
realtime) behind it. Both free tiers are enough.

## Character data

Characters, abilities, night order, jinxes and token art come from the official
[Pandemonium Institute toolmaker
resources](https://github.com/ThePandemoniumInstitute/botc-release), used under
their Community Created Content Policy. `npm run build:data` regenerates
everything from that source; nothing in `src/data/` is hand-edited except
`data/tag-overrides.json`.

Blood on the Clocktower is a trademark of Steven Medway and The Pandemonium
Institute. This is an unofficial fan project.
