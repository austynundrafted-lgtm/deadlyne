# Badge artwork

Drop one PNG per badge in this folder, named by the badge id, then run `./scripts/build.sh`.
Any badge without artwork falls back to the built-in placeholder medallion, so you can add them one at a time.

## Spec

- **512 × 512 px PNG with transparency.** It's shown at 24–92 pt (up to 184 px on Retina), so keep details bold.
- Center the design and leave about 4% padding. Nothing clips it, so any shape works.
- **Locked state (optional):** `<id>-locked.png`. Without one, Deadlyne shows the earned art desaturated at 40% opacity.
- **Try without rebuilding:** put files in `~/Library/Application Support/Deadlyne/Badges/` and relaunch the app. That folder is checked first.

## Badge ids

| id | Name | Unlocks at |
|---|---|---|
| `photos-100` | Warm-Up | 100 photos |
| `photos-500` | Kickoff | 500 photos |
| `photos-1000` | First Thousand | 1,000 photos |
| `photos-2500` | Game Day | 2,500 photos |
| `photos-5000` | Starter | 5,000 photos |
| `photos-10000` | Varsity | 10,000 photos |
| `photos-25000` | All-Conference | 25,000 photos |
| `photos-50000` | All-State | 50,000 photos |
| `photos-100000` | Hall of Fame | 100,000 photos |
| `photos-250000` | Legend | 250,000 photos |
| `photos-500000` | Dynasty | 500,000 photos |
| `photos-1000000` | The Million | 1,000,000 photos |
| `shoots-1` | First Shoot | 1 shoot |
| `shoots-10` | Double Digits | 10 shoots |
| `shoots-25` | Season Pass | 25 shoots |
| `shoots-50` | Road Warrior | 50 shoots |
| `shoots-100` | Centurion | 100 shoots |
| `shoots-250` | Iron Lens | 250 shoots |

Names and thresholds are defined in `Sources/Deadlyne/Core/Achievements.swift`. The display name can change freely. The id is both the file name and the key that records a badge as earned, so once artwork exists, rename the id and the file together.
