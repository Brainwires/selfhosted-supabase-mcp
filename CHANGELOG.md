# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - All Changes Since Fork (380acd09)

This section documents ALL changes since forking from commit 380acd09.

**Stats**: +9,429 / -4,096 lines across 75 files
**Commits**: 9 commits

---

### Added

#### HTTP Transport Mode (`src/server/`)
Purpose: Keep the server running (unlike stdio which exits after each request)

- `http-server.ts` - Express-based HTTP server with SSE support
- `auth-middleware.ts` - JWT validation for incoming requests
- `session-manager.ts` - Session lifecycle, cleanup, limits

#### Authentication System (`src/auth/`)
- `credential-manager.ts` - Persistent credential storage at `~/.config/supabase-mcp/credentials.json`
- `server-auth-manager.ts` - Auto-login, token refresh for server identity

#### Security Infrastructure
- `src/security-profiles.ts` - Four profiles: readonly, standard, admin, custom
- `src/config/security.ts` - Security configuration loading
- `src/audit-logger.ts` - Structured JSON logging with field redaction
- `src/config/cli.ts` - CLI argument parsing

#### New Tools - Schema Inspection
- `list_table_columns` - Column details
- `list_foreign_keys` - FK relationships
- `list_constraints` - Table constraints
- `list_available_extensions` - Available extensions

#### New Tools - Functions & Triggers
- `list_database_functions` - List functions
- `get_function_definition` - Function source
- `list_triggers` - List triggers
- `get_trigger_definition` - Trigger details

#### New Tools - Index Management
- `list_indexes` - List indexes
- `get_index_stats` - Index statistics
- `create_index` - Create index
- `drop_index` - Drop index

#### New Tools - RLS Management
- `list_rls_policies` - List policies
- `get_rls_status` - RLS status per table
- `enable_rls_on_table` - Enable RLS
- `create_rls_policy` - Create policy
- `drop_rls_policy` - Drop policy

#### New Tools - Auth Users (split from user_admin)
- `list_auth_users` - List with pagination
- `get_auth_user` - Get by ID
- `create_auth_user` - Create user
- `update_auth_user` - Update fields
- `delete_auth_user` - Delete/disable

#### New Tools - Auth Sessions
- `list_auth_sessions` - List sessions
- `revoke_session` - Revoke specific session
- `signout_user` - Sign out user

#### New Tools - Auth Flows
- `signin_with_password` - Sign in
- `signup_user` - Create account
- `generate_user_token` - Generate JWT (admin only)

#### New Tools - pg_cron
- `list_cron_jobs` - Scheduled jobs
- `get_cron_job_history` - Execution history

#### New Tools - pgvector
- `list_vector_indexes` - IVFFlat/HNSW indexes
- `get_vector_index_stats` - Vector stats

#### New Tools - Edge Functions
- `list_edge_functions` - List functions
- `get_edge_function_details` - Details
- `list_edge_function_logs` - Logs

#### New Tools - Storage
- `create_storage_bucket`
- `delete_storage_bucket`
- `delete_storage_object`

#### New Tools - Extensions
- `enable_extension`
- `disable_extension`

#### New Tools - Query Analysis
- `explain_query` - EXPLAIN ANALYZE

#### Infrastructure
- `src/tools/registry.ts` - Centralized tool registration
- `src/tools/types.ts` - ToolContext, AuthContext types
- `bunfig.toml` - Bun configuration
- `src/__tests__/` - Test infrastructure

#### Documentation
- `SECURITY.md` - Full security guide
- Credential storage section (added today)

---

### Changed

#### Transport Modes
- stdio: Exits after request (original behavior)
- HTTP: Stays running (new, for stateful sessions)

#### Tool Count
- Before: ~15 tools
- After: 87 tools

#### Build System
- Node.js + tsup → Bun runtime + bundler

#### Package Manager
- npm → Bun

#### Entry Point (`src/index.ts`)
- Restructured for transport selection
- Factory pattern for MCP server creation

#### Session Management
- Consolidated two Maps into single source of truth (SessionManager)
- Removed redundant `sessionAuthContexts` Map from HttpMcpServer

---

### Fixed

#### SQL Injection in `signout_user`
- **Before**: `WHERE id = '${session_id.replace(/'/g, "''")}'`
- **After**: `pgClient.query('DELETE ... WHERE id = $1', [session_id])`
- Uses parameterized queries via `executeTransactionWithPg`

---

### Removed

- `package-lock.json` (replaced by bun.lock)
- tsup dependency
- `user_admin` consolidated tool (split into 5 individual tools)

---

### Files Modified/Added

```
New files (57):
  src/audit-logger.ts
  src/auth/credential-manager.ts
  src/auth/index.ts
  src/auth/server-auth-manager.ts
  src/client/index.ts
  src/config/cli.ts
  src/config/security.ts
  src/security-profiles.ts
  src/server/auth-middleware.ts
  src/server/http-server.ts
  src/server/session-manager.ts
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
  src/tools/registry.ts
  src/tools/revoke_session.ts
  src/tools/signin_with_password.ts
  src/tools/signout_user.ts
  src/tools/signup_user.ts
  src/tools/types.ts
  src/tools/update_auth_user.ts
  src/__tests__/auth/credential-manager.test.ts
  src/__tests__/security-profiles.test.ts
  src/__tests__/setup.ts
  bunfig.toml
  SECURITY.md

Modified files (18):
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

Removed files:
  package-lock.json
```
