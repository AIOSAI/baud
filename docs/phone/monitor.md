# The monitor row

This page covers the monitor row: the machine's live vitals on the wheel, the cpu page, the PROC sheet of what is running, and how a room or a watch that ends says so.

← [the phone face](../phone.md)

### The monitor row — the machine, live on the face

The wheel's last layer is the machine (FPLAN-0561; every clause ruled in
DPLAN-0341). Seven cards — CPU, MEM, TEMP, FAN, NET, PROC, BAT — each carrying its
live headline, because the glance is the point: a fan running hard behind a
locked screen across the room is the case the row answers. BAT, last, reads the
battery section of `/v1/machine`, tones only against the low and critical lines
the host publishes, and a host with no battery draws the dash.

**Three owners, one piece each.** @skills publishes `machine_vitals()` and owns
every meaning in it — which sensor is the CPU, which rows are nonsense, what an
absence is called. @api proxies it verbatim on `GET /v1/machine` behind a 1 s
single-flight cache. BAUD draws it and decides nothing else. There is no Rust
half: `sysinfo` has no fan API at all, and psutil reads the fan. The desktop has
no command behind `machine_vitals`, and its transport refuses the name out loud
rather than failing at the IPC.

**The faces.** CPU and MEM draw their percent with a ring of the same percent.
TEMP draws the package °C with a ring of celsius over the sensor's own
`critical`, amber from 85% of the sensor's `high` and red at `high` itself (both
lines are the sensor's own values, never a constant). FAN draws the percent of its
range with the ring; a fan with an rpm but no range (`no_range`) draws the rpm
and no ring. NET (sent plus received, per second) and PROC (a count) have no
range and never wear one. Colour belongs to the readings that publish a line to
be warm against: the temperature (its sensor's `high` and `critical`) and the
battery while discharging (UPower's low and critical lines, when the host has
them). The ring sits inside the card's border, because the centred card's scale
already spends the rail's vertical headroom and an outside ring would be cut off
on exactly the card being read.

**Absence is not zero.** A section the host cannot give draws a dash — and on a
gauge a dead ring — and its sheet prints the skill's own sentence for the reason,
with the detail when there is one. `warming`, the first read after the server
starts, has no CPU or network window yet and renders the same way. A 503
(`psutil_missing`, `switched_off`) turns every face to a dash and the sheet
prints the owner's message.

**The cpu page shows the cores** (FPLAN-0586). One bar per online CPU in the
skill's `cores` list — never one per configured count, which can differ — then
one line of what the machine has (*4 threads on 2 cores · 1.1 GHz, up to 3.3*),
then the three load averages with a caption saying what they mean against the
live thread count. The sample window rides the sampled line. While the section
is warming the bars give way to the skill's sentence, never to zero-height bars;
any count or clock the host cannot give prints a dash, and a missing clock's
reason (`detail`) sits under that line.

**Read while looked at, and only on that row.** `lib/machine.ts` polls every 2 s
— past the server's 1 s cache, so every read is a fresh sample — through
`whileVisible`, and only while the monitor row is the visible wheel. Leaving the
row stops the lane and forgets the reading, so arriving again shows bare marks
until a fresh answer lands rather than last visit's numbers dressed as live ones.
The sheet opens over the wheel without moving its layer, so it stays live. The
route takes no query parameters, ever — a cache-buster included. PROC's sheet
lists what is running, by cost — see **What is running, and rooms that end**
below.

### What is running, and rooms that end

**The PROC sheet lists the top twenty**, a quick reference for what is using the
machine when the fan runs and no agent is. The headline is every process the
host counted, sleeping ones included, so it says "processes", never "running".
Under it, @skills' `machine_processes()` through @api's `GET
/v1/machine/processes` (contract C-B): the twenty busiest by cpu
(`PROCESS_LIMIT`), each with cpu %, memory % and resident MB, and a cpu/mem
toggle that re-orders the same twenty on the phone. **Read once** when the sheet
opens and again on a tap on the sampled line, never on the monitor row's
two-second cadence and never while the sheet is shut: the skill sleeps about half
a second to sample cpu honestly, and the line says "sampling…" while it does. A
refusal shows the server's sentence, as the vitals refusal does. A process that
came back with no name shows its pid. The desktop refuses `machine_processes` by
name.

**A closed socket says which kind of close it was** (`lib/socketClose.ts`, shared
by the room and the watch):

- **4000 "room ended"** (contract C-C): the tmux session ended under the socket,
  from the desk or a shell that exited. Final. The room's overlay reads "ended —
  this room is gone; open it again from the card to start fresh", with no
  reattach button and no ladder, because `new-session -A` would build a fresh
  empty room under the old name. An agent room's ended mark is written, so the
  startup agent does not recreate it. A watch reads "the watch ended" and does
  not re-arm; its rewatch button stays.
- **1008 / 1011 after accept**: the host refused (an unknown branch or project,
  no tmux). Final too. The overlay says "refused", the host's sentence stays in
  the error line, and a hand on the button tries once more.
- **anything else**: a detach, a pocket, a dropped link. The ladder runs (0, 1,
  3, 6, 12, 30 s while visible).

The ladder's count resets, and the launch or help line is typed, on the room's
**first data frame**, not on `onopen`: @api accepts before it refuses, so an open
socket alone proves nothing. A token refused at the handshake keeps the
`onerror` sentence instead of being overwritten by an empty close.

**`end room` is remembered.** The verb's success writes `intent.ts`'s ended mark
(the desk's own store), the startup agent's guard reads it, and the card's
attach doors clear it - the one door that revives an ended room, as on the desk.
The marks live in `localStorage` under `baud.rooms.ended` as a list of
`"<project>/<branch>"`, and corrupt storage reads as empty.
When the startup agent does not open because the token is read-only or the
agent has no card in the seated project, the resting stage says so in one line:
"startup agent X not opened — reason". The header ring follows the agent room
(the seat pane), not whichever tab is in front.

**The watch dies like a room.** A dropped watch dims its last frame under the
room's own overlay and climbs the room's ladder; a watch holds no state, so a
reconnect costs one fresh observer. The button reads "rewatch mission control"
for the target-less monitor and "rewatch <name>" otherwise, and it shows only
after a close - never while the first connect is still going.
