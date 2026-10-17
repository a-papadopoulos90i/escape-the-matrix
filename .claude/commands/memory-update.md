---
description: Save what this chat decided into the project's shared memory (docs/project-log.md, CLAUDE.md, auto-memory)
---

The owner wants this chat's decisions kept for every other chat and fork of the project. Do this:

1. Read `CLAUDE.md` and `docs/project-log.md`, and look at `git log` since the last log entry.
2. From this conversation, collect what is not recorded yet: decisions and their reasons, features shipped (with
   the `?v=` version), infrastructure or configuration changes, things the owner asked to be remembered, and
   open items (new, or now closed).
3. Append dated entries to `docs/project-log.md` (newest at the bottom of the October/current section) and update
   its **Open items**. Change `CLAUDE.md` only for lasting rules or facts that changed (how to deploy, where things
   live, how the owner wants to work, behaviour he decided). Keep both concise — decisions, not transcripts.
4. Refresh the auto-memory too (`MEMORY.md` and the project memory file) if a fact there is now stale.
5. **Never** write secrets, passwords, keys, tokens, customer emails, uids or other personal data — the repository
   is public. Names of secrets and services are fine; their values never are.
6. Commit **only** these files (`git add CLAUDE.md docs/project-log.md`, plus this command file if it changed) —
   other uncommitted work in the folder may belong to another chat. Push to `main`. No deploy is needed.
7. Reply in Greek with two or three lines: what was saved, and any open item that needs the owner.
