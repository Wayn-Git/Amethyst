"""The hybrid logical clock: a total order two devices can agree on without talking.

Last-write-wins needs a "last", and wall clocks do not supply one. Two machines
drift, a laptop resumes from sleep with a clock minutes behind, and NTP steps it
backwards mid-session. Ordering edits by `datetime('now')` therefore loses a
change that was genuinely later, and -- worse -- loses a *different* change on
each device, so the two never converge.

An HLC is a wall clock that is not allowed to go backwards, plus a counter for
the ties that creates:

    wall     - max(system clock, highest wall seen anywhere, own last wall)
    counter  - breaks ties inside the same millisecond
    device   - breaks ties between devices, so the order is *total*

That last part is the one that matters. Without it two concurrent edits stamped
in the same millisecond compare equal, each device keeps whichever it applied
last, and they disagree forever. With it every device sorts the pair the same
way -- arbitrarily, but identically -- which is the whole convergence guarantee.
Arbitrary-but-identical is the correct trade: nobody can say which of two
simultaneous edits "should" win, and agreeing matters more than being right.

Stamps are compared as plain strings. `wall` and `counter` are zero padded to a
fixed width so lexicographic order and numeric order are the same thing, which
means SQLite's `>` on the stored TEXT column is already the right comparison and
no rows have to be parsed to sort them.
"""

from __future__ import annotations

import threading
import time

#: 13 digits holds milliseconds until the year 5138. Fixed width is what makes a
#: string compare a numeric compare.
_WALL_DIGITS = 13
#: A million edits inside one millisecond on one device is not a thing that
#: happens; the width is here so the field cannot change length, not for headroom.
_COUNTER_DIGITS = 6

SEP = ":"


class Clock:
    """One device's clock. Thread safe because the poller and the API share it."""

    def __init__(self, device_id: str, *, now_ms=None) -> None:
        if SEP in device_id:
            raise ValueError(f"a device id cannot contain {SEP!r}: {device_id!r}")
        self.device_id = device_id
        self._now_ms = now_ms or (lambda: int(time.time() * 1000))
        self._wall = 0
        self._counter = 0
        self._lock = threading.Lock()

    def tick(self) -> str:
        """Stamp a local edit."""
        with self._lock:
            return self._advance()

    def observe(self, stamp: str) -> str:
        """Fold in a stamp that arrived from somewhere else, and stamp locally.

        Called for every op received. This is what stops a device whose clock is
        behind from emitting stamps that sort before edits it has already seen --
        it would otherwise write a change that loses to the row it just replaced.
        """
        remote_wall, remote_counter, _ = parse(stamp)
        with self._lock:
            if remote_wall > self._wall:
                self._wall = remote_wall
                self._counter = remote_counter
            elif remote_wall == self._wall:
                self._counter = max(self._counter, remote_counter)
            return self._advance()

    def _advance(self) -> str:
        wall = max(self._now_ms(), self._wall)
        if wall == self._wall:
            self._counter += 1
        else:
            self._wall = wall
            self._counter = 0
        return format_stamp(self._wall, self._counter, self.device_id)


def format_stamp(wall: int, counter: int, device_id: str) -> str:
    return f"{wall:0{_WALL_DIGITS}d}{SEP}{counter:0{_COUNTER_DIGITS}d}{SEP}{device_id}"


def parse(stamp: str) -> tuple[int, int, str]:
    """Split a stamp. Raises ValueError on anything that is not one."""
    wall, counter, device_id = stamp.split(SEP, 2)
    return int(wall), int(counter), device_id


def wins(challenger: str | None, incumbent: str | None) -> bool:
    """Does `challenger` replace `incumbent` under last-write-wins?

    A missing incumbent loses to anything -- that is a field nobody has written.
    A missing challenger wins nothing. Ties do not replace, so applying the same
    op twice is a no-op rather than a rewrite, which is what makes replay free.
    """
    if not challenger:
        return False
    if not incumbent:
        return True
    return challenger > incumbent
