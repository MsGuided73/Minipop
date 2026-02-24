---
description: Safe git sync - commit all local changes, pull remote updates, push to origin
---

## Safe Sync Workflow

This workflow safely commits any local changes, pulls remote updates, and pushes to GitHub without losing work.

1. Check current git status to see what has changed

```
git status
```

2. Stage all changes

```
git add .
```

3. Commit with a timestamped message (skip if nothing to commit)

```
git commit -m "chore: safe-sync [auto] $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
```

4. Pull latest from remote with rebase to keep history clean

```
git pull --rebase origin main
```

5. Push to remote

```
git push origin main
```

6. Confirm final status

```
git status
git log --oneline -5
```
