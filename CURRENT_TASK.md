# Current Tasks

## Database Objects to Add Per Schema/Database

### Completed
- [x] Functions/Stored Procedures - Added as separate "Procedures" tab (was already listing functions)
- [x] Materialized Views - PostgreSQL specific, returns empty for others
- [x] Sequences - PostgreSQL specific, returns empty for others
- [x] Triggers - PostgreSQL, MySQL, SQLite support

### Implementation Notes
- All 4 new types live under a "More" dropdown in the ObjectPanel tab bar
- Primary tabs remain: Tables, Views, Functions
- "More" dropdown contains: Materialized Views, Sequences, Triggers, Procedures
- When a "More" type is active, the dropdown button shows the active type name + count
- Backend support added for all 4 DB engines (Postgres, MySQL, SQLite, Redis)
