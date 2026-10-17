# Design artefacts

Shapes that were **voted on**, kept at the resolution they were approved at.

Nothing in here is built, imported or served. These are the mockups the owner
ruled on: the record of what was agreed, which is a different thing from the
code that came out of it. When the built face and one of these disagree, that
is a finding worth writing down, not a file worth quietly updating.

Filenames say their own status and are preserved verbatim: `APPROVED_SHAPE` is
load-bearing, not decoration.

| file | what it is | status |
| --- | --- | --- |
| `wheel_mockup_APPROVED_SHAPE.html` | the phone fleet screen as one horizontal wheel, the shape the phone's wheel is built from | approved |
| `typing_mode_PROBE_FPLAN-0446.html` | three doors into Claude Code's own composer, the typing-mode shape probe | probe |

**Why they live here.** An approved design shape is an artefact with authority,
not runtime state, so it lives in the tracked tree rather than in a runtime drop
point that is gitignored with the rest of the runtime state.

**`PROBE` in a filename means the opposite of `APPROVED_SHAPE`:** a shape put in
front of the owner that has not been ruled on. When one is chosen the file is
renamed to say so, and the options not picked stay in it: a probe is the record
of what the choice was between, which is worth more than the winner alone.

A probe is also served, briefly, so a thumb can reach it: a copy rides in
`app/dist-phone/assets/`, which the host serves per request with no restart, and
which the next phone build wipes. That is deliberate. The copy is a delivery
mechanism; this directory is the record.
