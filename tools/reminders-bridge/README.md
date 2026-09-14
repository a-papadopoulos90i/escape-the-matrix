# Levelix ↔ Apple Reminders (personal bridge)

A private helper for the owner's Mac — not a public feature. It syncs Levelix with **one** Reminders
list called **Levelix**, when you press **Sync with Reminders** in Levelix's account menu.

## One-time setup

1. In Levelix (https://levelix.eu), open the site once with `?reminders=on` at the end of the address:
   `https://levelix.eu/?reminders=on`. The menu item appears only in that browser.
   (`?reminders=off` hides it again.)
2. Start the bridge on the Mac and leave the Terminal window open:

   ```bash
   node "tools/reminders-bridge/server.mjs"
   ```

   The first run asks macOS for permission to control **Reminders** — press **OK**.

## What one press of "Sync with Reminders" does

- Every open Levelix task (and tasks finished in the last 14 days) is written to the **Levelix** list.
  A task placed on a day gets that day as the reminder's due date, so it also shows in **Calendar**
  (enable Calendar → View → Show Reminders, or the Scheduled Reminders calendar).
- Titles and days sync both ways: whichever side you changed since the last sync wins (if both, Levelix).
  Removing a reminder's day sends the task back to today's waiting list; a new day moves the task there.
- Ticking a task in either app ticks it in the other.
- Deleting in either app deletes in the other (a finished task deleted in Reminders stays in Levelix's history).
- New reminders you add to the **Levelix** list come into Levelix's Write down list (dated with their
  due date, or today), then get linked so they are not imported twice.
- Other Reminders lists are never read or changed.

A reminder is linked to its task by a `levelix:<id>` line in the reminder's notes — leave that line in place.
What both sides agreed on last time is kept in `~/Library/Application Support/Levelix/reminders-bridge-state.json`.

The bridge listens on `127.0.0.1:47827` only and answers only the Levelix sites.
