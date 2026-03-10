# DBUI Project Instructions

## Commit Style

Use conventional commits for all commit messages:

```
<type>(<scope>): <description>

[optional body]

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `refactor` - Code change that neither fixes a bug nor adds a feature
- `docs` - Documentation only
- `style` - Formatting, missing semicolons, etc.
- `test` - Adding or fixing tests
- `chore` - Maintenance tasks, dependencies, build config

**Scope** (optional): `frontend`, `backend`, `db`, `ui`

**Examples:**
```
feat(frontend): add connection URL field with bidirectional sync
fix(db): handle null values in SQLite PRAGMA results
refactor(backend): extract common query execution logic
```

## SolidJS Reactivity

**NEVER use `Set` or `Map` as signal values.** SolidJS cannot track mutations or detect changes to `Set`/`Map` — even creating a new `Set` with the same contents won't trigger updates reliably, and methods like `.has()` are not reactive.

**Always use plain arrays (`number[]`, `string[]`) for collection signals.** Use `.includes()` instead of `.has()`, `.length` instead of `.size`, `.filter()` instead of `.delete()`, and spread `[...arr, item]` instead of `.add()`. This ensures every mutation creates a new array reference that SolidJS can detect.
