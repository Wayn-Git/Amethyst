---
name: tasks-and-lists
description: >
  How tasks, lists and My Day actually work in AMETHYST, and which tool does what.
  Use whenever the user asks to add, change, finish or find a task, mentions My Day,
  a to-do list, a deadline or a reminder, or asks what is due.
version: 1.0.0
tags: [tasks, microsoft-todo]
---

# Tasks, lists and My Day

Tasks are a two-way mirror of Microsoft To Do when an account is connected, and
a local list when none is. Everything below follows from that: what you write
here appears on the user's phone, and what they write on their phone appears
here.

## The tools, by name

- `create_task` — one task. `create_tasks` — several at once, same fields.
- `update_task` — title, notes, dates, status, importance, or which list.
- `list_task_lists` — the lists that exist, with their names.
- `list_upcoming` — what is due or scheduled soon.
- `find_free_slot`, `create_calendar_event`, `list_calendar` — the calendar,
  which is a different thing from a task.

There is no `list_tasks` tool. Older notes name one; it has never existed.

## Dates are written in words

`due_date_hint`, `scheduled_hint` and `reminder_hint` take what the user said —
"tomorrow", "friday 5pm", "in two weeks" — and are resolved on the server
against the real clock. Do not convert to a date yourself and do not ask the
user to; a hint you resolve by hand is a guess about their timezone.

Three different fields, and they are not interchangeable:

- **due** is the deadline.
- **scheduled** is when they intend to *work on it*.
- **reminder** is when to interrupt them. Left out, it follows the deadline.

## My Day is a list, not a flag

My Day is an ordinary Microsoft To Do list called "My Day", the same one in
To Do's sidebar under Lists. `add_to_my_day: true` on `create_task` or
`update_task` puts a task there.

Because a task lives in exactly one list, moving it into My Day takes it out of
the list it was in — say so if the user might care.

To Do's *own* My Day, the overlay at the top of its sidebar, is not in the
Microsoft Graph API at all. Nothing added there can be seen from here, and
nothing you do here can put a task there. If the user says a task is missing
from My Day, that is the likeliest reason.

## Importance is the user's, priority is yours

`important` is the user's own flag — To Do's star. `priority` is your estimate.
They are separate on purpose: never set `important` to record that *you* think
something matters.

## Deleting is cancelling

A task removed here is marked cancelled, not deleted, and a task that vanishes
upstream is cancelled rather than dropped. There is no hard delete: an outage
and an emptied account look identical from this side, and only one of them is
recoverable.

## Lists are matched by what people type

Real lists are called "🛒 Groceries" and "📚 College". Pass `list: "groceries"`
— leading emoji and case are folded before matching. If two lists match equally
well, ask which one rather than picking: filing a task in the wrong list hides
it as effectively as not creating it.
