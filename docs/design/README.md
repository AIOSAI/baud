# Design artefacts

Shapes that were **voted on**, kept at the resolution they were approved at.

Nothing in here is built, imported or served. These are the mockups Patrick
looked at and ruled on — the record of what was agreed, which is a different
thing from the code that came out of it. When the built face and one of these
disagree, that is a finding worth writing down, not a file worth quietly
updating.

Filenames say their own status and are preserved verbatim: `APPROVED_SHAPE` is
load-bearing, not decoration.

| file | what it is | approved |
| --- | --- | --- |
| `wheel_mockup_APPROVED_SHAPE.html` | the phone fleet screen as one horizontal wheel — the shape probe Patrick's thumb voted on, before FPLAN-0423 built it | 2026-08-15 |

**Why they live here rather than where they landed.** This one arrived in a
branch's `dropbox/` — a runtime drop point beside a rollover backup and a vector
store's sqlite. It was the only file in there, and the two dirs beside it were
gitignored as runtime state on 2026-08-16. Ignoring this one by the same rule
would have hidden the only surviving copy of an approved design behind a rule
written for sqlite files, so it was flagged instead and given a home the day
after (@devpulse's ruling, 2026-08-17: *"an approved design shape is an artefact
with authority, not runtime state"*).
