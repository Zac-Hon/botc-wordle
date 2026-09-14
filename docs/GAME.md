# The game

What the rules are, and why they are what they are. If you only want to know how
to play, the help button in the app covers it; this is the version with the
reasoning attached.

## The clue grid

Every guess produces seven cells.

| Column | Green | Amber | Grey |
|---|---|---|---|
| **Type** | Same type | Different type, same side | Different side |
| **Script** | Same set | | Different set |
| **Wakes** | Same night behaviour | | Different |
| **Night order** | Same position, or neither wakes | Within 5, with an arrow | Further, with an arrow |
| **Ability** | Identical tag set | At least one shared tag | Nothing shared |
| **Reminders** | Same count | Within 1, with an arrow | Further, with an arrow |
| **Jinxes** | Same count | Within 1, with an arrow | Further, with an arrow |

Sides are good (Townsfolk, Outsider), evil (Minion, Demon) and other
(Travellers). Arrows point **towards the answer**: up means the answer is higher
than your guess.

### Why these seven

The columns were chosen by measurement, not taste. `npm run analyse:clues`
reports how much each one narrows the field. Leave-one-out cost against the
87-character Classic pool, higher meaning more useful:

```
reminders 1.49 | jinxes 1.10 | script 0.95 | team 0.87
tags 0.56 | nightOrder 0.55 | wake 0.25
```

(`setup` measured 0.06 on the same scale before it was removed.)

There was originally a **setup** column, showing whether a character changes the
game's setup. It felt like a good clue and was nearly useless: only about 11% of
characters have the flag, so it came back green 89% of the time and left the
pool essentially untouched. It was cut and **jinxes** put in its place. The
intuitive part of it survives as the `setup-modifier` ability tag, where it sits
alongside other signals instead of wasting a column.

Together the seven narrow 87 candidates to 2.13 after a single guess under
perfect play. That sounds brutal, but perfect play assumes a memorised table of
reminder-token and jinx counts. Nobody has that, and the columns people actually
reason from are the weaker ones, which is what keeps the game playable.

### Night order

A number from 1 (earliest in the night) to 100 (latest), or N/A for the 61
characters that never wake at all.

It is normalised rather than a raw sheet position because there are two night
sheets of different lengths, 76 entries on the first night and 97 on the others,
and the number has to mean the same thing whichever sheet a character came from.
The other-night sheet is preferred, since that is the order that repeats every
night; only the 23 characters that act solely on the first night fall back to
it. The two orders correlate at 0.79 across the 53 characters on both, so "how
far through the night" survives the conversion.

This column originally read the first-night sheet alone, which meant the 44
characters that wake only on later nights, the Oracle among them, showed N/A as
though they never woke.

### The Ability column

This is the one that confuses people, and the confusion is legitimate: it
compares a whole **set** of tags rather than one value. Green needs every tag to
match, which is rare; amber only needs one in common, which is frequent. Amber
here means considerably less than amber anywhere else.

Tags are derived from the official ability text by keyword rules in
`scripts/tag-rules.ts`, then corrected by hand in `data/tag-overrides.json`.
The overrides file wins. If a character is tagged wrongly, fix it there rather
than bending a rule, because a rule change silently reclassifies every other
character it touches.

## Pools

Fabled and Loric are excluded from both dailies and from all of Versus. Two of
the seven columns collapse for them: their Script just repeats their Type
(`edition: "fabled"`, team `fabled`), and the tag vocabulary describes player
powers while they modify the game's rules, so they would all share one tag. They
remain available behind an Endless toggle that is off by default.

Travellers stay in, including Classic. They are real player characters with real
abilities, night orders and editions, so every column works for them, and they
keep the `other` side populated in the main mode.

A trap worth knowing about: **Deus ex Fiasco and Ferryman are `team: fabled` but
`edition: carousel`.** Any code classifying storyteller characters by edition
leaks those two into the dailies. Classification keys off team, and
`npm test` fails the build if a storyteller character ever reaches a daily pool.

## The hangman

After four wrong guesses the answer's name appears as blanks, and each further
wrong guess uncovers one more letter. The reveal order is seeded from the
puzzle, so every player working on the same puzzle uncovers the same letters in
the same order, which is what makes the shared result grid describe a common
experience. Spaces, apostrophes and hyphens are always visible and never consume
a reveal, so `Lil' Monsta` does not waste two of your hard-won letters on
punctuation.

The dailies have no guess limit, so the hangman guarantees you finish. Your
score is how few guesses it took.

## The collection

Every character you name correctly is added to your collection, and any
character in it can be used as your profile picture.

A **gold ring** means you earned that character the best way it can be earned:
in a daily for most characters, or in Endless for Fabled and Loric, which never
appear in the dailies. Without that exception 25 characters could never carry a
ring and a complete collection would be impossible.

A **second green ring** means mastered: named in all three modes. Fabled and
Loric cannot be mastered, because they appear in no daily and are never offered
in Versus, so two of the three are out of reach. Counting a single Endless win
as mastery would have handed out the top tier for the least work, so they are
excluded and counted separately instead.

## Achievements, titles and frames

Nineteen milestones across three categories, listed on the Achievements page
including the ones you have not started, with how far off you are.

| Category | Examples |
|---|---|
| Dailies | first solve, 10 / 50 / 200 wins, a 7 or 30 day streak, a one-guess solve |
| Collection | 25 / 75 / 140 named, 25 gold rings, a completed set, a first mastery |
| Versus | first ranked win, 10 wins, 1200 and 1400 rating, beating someone rated 100 above you |

Each one unlocks a **title** to wear next to your name, and five of them also
unlock a coloured **frame** for your avatar, so frames stay the scarcer of the
two. Both show wherever you appear: the top bar, the leaderboards, the Versus
lobby and your public profile.

Progress is recomputed server side whenever a game or a rating changes, by the
same trigger that maintains the summary stats. Nothing is ever taken back: a
streak you lose does not take the achievement with it.

Which titles and frames you may wear is checked in `update_profile`, not in the
browser, for the same reason the avatar always has been. Editing a request gets
you an error, not a title.

## Public profiles

Every name on a leaderboard, ladder or Versus lobby links to that player's
profile: their avatar and title, their collection progress by set, their rating
and everything they have earned. Nothing there is new to the world; the figures
were already reachable through the leaderboards. The achievements are the
addition, and they exist to be seen.

## Versus

Two players, three rounds a cycle, one to three cycles.

| Round | Format | Scoring |
|---|---|---|
| **1. Icon race** | Both see the same token, 30 seconds, type freely | 100 down to 25 by speed |
| **2. Race** | Same character for both, full grid, 8 guesses | See below |
| **3. Assigned** | Each picks the character the other must find | Same as round 2 |

Deduction rounds pay a floor of **30**, plus up to **25 for economy** of guesses
and up to **45 for speed**, measured against a 90 second window. Speed carries
the largest share on purpose: an earlier version scored on guesses alone, which
meant three guesses in twenty seconds paid exactly what three guesses in four
minutes paid, and the clock may as well not have been running.

If nobody solves it, the closest guess still earns up to 25, scaled by how much
of the clue row they had matched, so a round nobody wins is not a dead round.
Solving always pays more than failing, however slow or wasteful, so stalling is
never the better play. That invariant is enforced by a test.

### Round 1 spelling

A near miss is told it is near and nothing more. The correct spelling is never
shown, so you still have to produce it.

Naming a **different real character** is always wrong, never close. Butler and
Butcher are two edits apart, so without that rule, typing Butler when the answer
was Butcher would answer "so close!" and confirm a character you had not earned.

### Synchronised starts

Rounds do not begin when they are created. The server sets a reveal time a few
seconds out and both clients hold until it passes, using the server's clock
rather than their own. Delivery jitter therefore disappears into the lead-in
instead of deciding a thirty second race, and because scoring also measures from
the reveal time, a slow update cannot cost points.

## Ranked

Ranked matches are queued rather than arranged, and always use the Daily Full
pool with one cycle. The settings are fixed rather than host-chosen because a
rating only means something if every ranked game is the same game. Private
matches with a code never affect your rating.

Elo starts at 1000. The K-factor is 40 for your first ten games, 20 after, and
10 above 2000, so a new player reaches their real level quickly without
established ratings swinging around. Below ten games the rating shows as
provisional.

The queue widens its rating tolerance by 50 every five seconds, starting at 150,
because with a small player base a strict band means an empty queue forever.

## Streaks

A streak counts consecutive calendar days with a win, per mode. Today being
unplayed does not break it, since the day is not over, but any earlier gap does.

**Archive replays never count.** They are explicitly puzzles you missed, so
counting them would let anyone manufacture an unbroken streak by working
backwards through history.
