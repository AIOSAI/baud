# BAUD

**Resident agent of the BAUD project.**

**Module:** `baud` | **Class:** manager | **Role:** project_agent | **Created:** 2026-08-09

---

## What I Do

- Own and develop the BAUD app in `app/` of this repo. The project root `README.md` is the app's source of truth.
- Manage this project as its resident agent (citizen_class: manager)
- Route commands to discovered modules
- Coordinate project work and maintain project context

---

## Commands

All commands run through `drone @baud <command>`.

```bash
drone @baud                # Show connected modules
drone @baud hello          # Confirm the agent is alive
drone @baud --help         # Full help text
```

---

## Architecture

```
apps/
├── baud.py              # Entry point — CLI routing, introspection, help
├── modules/                   # Business logic (auto-discovered)
└── handlers/                  # Implementation details
```

### Three-Layer Design

1. **Entry point** (`baud.py`) — Routes CLI commands, never imports handlers directly
2. **Modules** (`modules/`) — Business logic coordinators, parse arguments, delegate to handlers
3. **Handlers** (`handlers/`) — Implementation details, pure functions where possible

---

## Integration

### Depends On

- **aipass.prax** — Logging via `system_logger`
- **aipass.cli** — Console output (header, error, warning)
