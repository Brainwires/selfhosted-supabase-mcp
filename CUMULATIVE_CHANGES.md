# Cumulative Changes Since Fork

This document summarizes all changes made since forking from commit `380acd09a0b107a545e8b07fc15595ef1fe34e2a`.

## Overview

| Metric | Value |
|--------|-------|
| Commits | 9 (+ uncommitted changes) |
| Lines Added | +9,429 |
| Lines Removed | -4,096 |
| Files Changed | 75 (+ 12 uncommitted) |
| Tools Before | ~15 |
| Tools After | 57 |

> **Note:** This document includes uncommitted changes to 12 files. Run `git status` for current state.

---

## Major Feature Additions

### 1. HTTP Transport Mode

Added a stateful HTTP server as an alternative to stdio transport, enabling persistent connections for AI agents and web clients.

**New Files:**
- `src/server/http-server.ts` - Express-based HTTP server with SSE support
- `src/server/auth-middleware.ts` - JWT validation for incoming requests
- `src/server/session-manager.ts` - Session lifecycle, cleanup, and limits

**Features:**
- REST endpoints: `POST /mcp`, `GET /mcp` (SSE), `DELETE /mcp`, `GET /health`
- JWT authentication via `Authorization: Bearer <token>`
- Session limits (1000 total, 10 per user by default)
- Automatic session cleanup

**Usage:**
```bash
bun run dist/index.js --transport http --port 3100 --jwt-secret $JWT_SECRET
```

---

### 2. Authentication System

Added server-side authentication for maintaining its own identity when communicating with Supabase.

**New Files:**
- `src/auth/credential-manager.ts` - Persistent credential storage at `~/.config/supabase-mcp/credentials.json`
- `src/auth/server-auth-manager.ts` - Auto-login and token refresh for server identity
- `src/auth/index.ts` - Module exports

**Features:**
- Auto-generated server credentials on first run
- Automatic token refresh
- Secure file permissions (0o600)

---

### 3. Security Infrastructure

Added comprehensive security controls including profiles, audit logging, and CLI configuration.

**New Files:**
- `src/security-profiles.ts` - Four profiles: `readonly`, `standard`, `admin`, `custom`
- `src/config/security.ts` - Security configuration loading
- `src/audit-logger.ts` - Structured JSON logging with sensitive field redaction
- `src/config/cli.ts` - CLI argument parsing with Commander

**Security Profiles:**

| Profile | Tools | Description |
|---------|-------|-------------|
| readonly | 33 | Read-only access, safe for exploration |
| standard | 42 | Common operations, no destructive capabilities |
| admin | 57 | Full access including DDL and credential exposure |
| custom | Variable | User-defined via `--tools-config` JSON file |

**Audit Logging:**
- JSON-structured logs for parsing
- Automatic redaction of sensitive fields (password, token, key, etc.)
- File output via `--audit-log <path>`

---

### 4. New Tools (42 Added)

#### Schema Inspection (4 tools)
| Tool | Description |
|------|-------------|
| `list_table_columns` | Column details with types, nullability, defaults |
| `list_foreign_keys` | Foreign key relationships |
| `list_constraints` | All constraints (PK, FK, UNIQUE, CHECK, EXCLUDE) |
| `list_available_extensions` | Extensions available for installation |

#### Functions & Triggers (4 tools)
| Tool | Description |
|------|-------------|
| `list_database_functions` | User-defined functions/procedures |
| `get_function_definition` | Function source code |
| `list_triggers` | Triggers on tables |
| `get_trigger_definition` | Trigger definition with function |

#### Index Management (4 tools)
| Tool | Description |
|------|-------------|
| `list_indexes` | All indexes with definitions and sizes |
| `get_index_stats` | Detailed statistics for an index |
| `create_index` | Create index (supports CONCURRENTLY, partial, covering) |
| `drop_index` | Drop an index |

#### RLS Management (5 tools)
| Tool | Description |
|------|-------------|
| `list_rls_policies` | All RLS policies with definitions |
| `get_rls_status` | RLS enabled/disabled per table |
| `enable_rls_on_table` | Enable RLS on a table |
| `create_rls_policy` | Create a new RLS policy |
| `drop_rls_policy` | Drop an RLS policy |

#### Auth Users (5 tools)
| Tool | Description |
|------|-------------|
| `list_auth_users` | List users with pagination |
| `get_auth_user` | Get user by ID |
| `create_auth_user` | Create user with email/password |
| `update_auth_user` | Update user fields |
| `delete_auth_user` | Delete or disable user (with confirmation) |

#### Auth Sessions (3 tools)
| Tool | Description |
|------|-------------|
| `list_auth_sessions` | List active sessions |
| `revoke_session` | Revoke a specific session |
| `signout_user` | Sign out user and invalidate sessions |

#### Auth Flows (3 tools)
| Tool | Description |
|------|-------------|
| `signin_with_password` | Sign in and get JWT tokens |
| `signup_user` | Register new user |
| `generate_user_token` | **[Admin]** Generate JWT for any user (sudo capability) |

#### pg_cron (2 tools)
| Tool | Description |
|------|-------------|
| `list_cron_jobs` | Scheduled cron jobs |
| `get_cron_job_history` | Execution history with status |

#### pgvector (2 tools)
| Tool | Description |
|------|-------------|
| `list_vector_indexes` | IVFFlat/HNSW indexes with parameters |
| `get_vector_index_stats` | Vector index statistics and size |

#### Edge Functions (3 tools)
| Tool | Description |
|------|-------------|
| `list_edge_functions` | List from metadata table |
| `get_edge_function_details` | Details and recent logs |
| `list_edge_function_logs` | Execution logs |

#### Storage (3 tools)
| Tool | Description |
|------|-------------|
| `create_storage_bucket` | Create a bucket |
| `delete_storage_bucket` | Delete a bucket |
| `delete_storage_object` | Delete an object |

#### Extensions (2 tools)
| Tool | Description |
|------|-------------|
| `enable_extension` | Install a PostgreSQL extension |
| `disable_extension` | Uninstall a PostgreSQL extension |

#### Query Analysis (1 tool)
| Tool | Description |
|------|-------------|
| `explain_query` | EXPLAIN ANALYZE for query plans |

---

## Breaking Changes

### Build System Migration
| Before | After |
|--------|-------|
| Node.js runtime | Bun runtime |
| tsup bundler | Bun bundler |
| npm package manager | Bun package manager |
| package-lock.json | bun.lock |

### Entry Point Restructuring
- `src/index.ts` restructured for transport mode selection
- Factory pattern for MCP server creation
- CLI argument parsing moved to `src/config/cli.ts`

### Tool Count
- Before: ~15 tools
- After: 57 tools

---

## Security Fixes

### SQL Injection in `signout_user`
**Severity:** High

**Before (vulnerable):**
```typescript
WHERE id = '${session_id.replace(/'/g, "''")}'
```

**After (fixed):**
```typescript
pgClient.query('DELETE ... WHERE id = $1', [session_id])
```

Uses parameterized queries via `executeTransactionWithPg`.

---

## Infrastructure Changes

### Centralized Tool Registry
- `src/tools/registry.ts` - Single source of truth for tool registration
- All tools imported and registered in one place
- Simplifies adding/removing tools

### Type Definitions
- `src/tools/types.ts` - `ToolContext`, `AuthContext` types
- Consistent typing across all tools

### Test Infrastructure
- `src/__tests__/setup.ts` - Test setup
- `src/__tests__/auth/credential-manager.test.ts` - Credential manager tests
- `src/__tests__/security-profiles.test.ts` - Security profile tests

### Configuration
- `bunfig.toml` - Bun configuration

---

## Removed

| Item | Reason |
|------|--------|
| `package-lock.json` | Replaced by `bun.lock` |
| `tsup` dependency | Using Bun bundler instead |
| `user_admin` tool | Split into 5 individual tools |

---

## File Summary

### New Files (57)

**Core Infrastructure:**
```
src/audit-logger.ts
src/security-profiles.ts
src/config/cli.ts
src/config/security.ts
src/client/index.ts
bunfig.toml
SECURITY.md
```

**Authentication:**
```
src/auth/credential-manager.ts
src/auth/index.ts
src/auth/server-auth-manager.ts
```

**Server:**
```
src/server/auth-middleware.ts
src/server/http-server.ts
src/server/session-manager.ts
```

**Tools:**
```
src/tools/registry.ts
src/tools/types.ts
src/tools/create_auth_user.ts
src/tools/create_index.ts
src/tools/create_rls_policy.ts
src/tools/create_storage_bucket.ts
src/tools/delete_auth_user.ts
src/tools/delete_storage_bucket.ts
src/tools/delete_storage_object.ts
src/tools/disable_extension.ts
src/tools/drop_index.ts
src/tools/drop_rls_policy.ts
src/tools/enable_extension.ts
src/tools/enable_rls_on_table.ts
src/tools/explain_query.ts
src/tools/generate_user_token.ts
src/tools/get_auth_user.ts
src/tools/get_cron_job_history.ts
src/tools/get_edge_function_details.ts
src/tools/get_function_definition.ts
src/tools/get_index_stats.ts
src/tools/get_rls_status.ts
src/tools/get_trigger_definition.ts
src/tools/get_vector_index_stats.ts
src/tools/list_auth_sessions.ts
src/tools/list_auth_users.ts
src/tools/list_available_extensions.ts
src/tools/list_constraints.ts
src/tools/list_cron_jobs.ts
src/tools/list_database_functions.ts
src/tools/list_edge_function_logs.ts
src/tools/list_edge_functions.ts
src/tools/list_foreign_keys.ts
src/tools/list_indexes.ts
src/tools/list_rls_policies.ts
src/tools/list_table_columns.ts
src/tools/list_triggers.ts
src/tools/list_vector_indexes.ts
src/tools/revoke_session.ts
src/tools/signin_with_password.ts
src/tools/signout_user.ts
src/tools/signup_user.ts
src/tools/update_auth_user.ts
```

**Tests:**
```
src/__tests__/setup.ts
src/__tests__/auth/credential-manager.test.ts
src/__tests__/security-profiles.test.ts
```

### Modified Files (18)
```
.gitignore
PLAN.md
README.md
package.json
smithery.yaml
src/index.ts
src/tools/apply_migration.ts
src/tools/execute_sql.ts
src/tools/get_anon_key.ts
src/tools/get_project_url.ts
src/tools/get_service_key.ts
src/tools/list_storage_objects.ts
src/tools/utils.ts
```

### Removed Files (1)
```
package-lock.json
```

---

## Commits

| Hash | Message |
|------|---------|
| 23a25a4 | feat: enhance error handling and input validation across tools |
| 71149fb | feat: add individual tools for user management |
| d51897d | feat: Enhance authentication and authorization features |
| 58b37e3 | feat: Enhance security features with transport modes, session limits, and RBAC |
| f1e8db6 | chore: update dependencies and improve validation error handling |
| 8fcd7ca | Refactor authentication tools, introduce user_admin, add registry |
| 2d1fb2c | feat: Add tools for database schema inspection and user authentication |
| aba2014 | chore: add .fastembed_cache to .gitignore |
| 5fae985 | feat: Enhance migration tool with SQL analysis and dry-run capabilities |

---

## Uncommitted Changes

The following changes are staged or modified but not yet committed:

### Files Modified (12)
```
CHANGELOG.md
README.md
SECURITY.md
src/index.ts
src/security-profiles.ts
src/server/http-server.ts
src/server/session-manager.ts
src/tools/list_auth_sessions.ts
src/tools/registry.ts
src/tools/revoke_session.ts
src/tools/signout_user.ts
src/tools/utils.ts
```

### Key Changes

#### Removed: RLS Enforcement from Session Tools
The `elevated` parameter and RLS enforcement logic have been removed from session-related tools:

| Tool | Change |
|------|--------|
| `list_auth_sessions` | Removed `elevated` parameter and user filtering logic |
| `revoke_session` | Removed `elevated` parameter and ownership checks |
| `signout_user` | Removed `elevated` parameter and ownership checks |

These tools now operate without HTTP-mode user restrictions.

#### Added: SessionManager.getAuthContext()
New method in `src/server/session-manager.ts` to retrieve auth context by MCP session ID.

#### Documentation Updates
- `CHANGELOG.md` - Expanded with full changelog since fork
- `README.md` - Minor updates
- `SECURITY.md` - Credential storage section and updates
