# Self-Hosted Supabase MCP Server - Implementation Plan

This plan outlines the steps to build the minimal self-hosted Supabase MCP server based on `migration_notes.md`.

## Progress Tracking

-   [x] Project Setup (package.json, tsconfig.json, dependencies, directories)
-   [x] Define Core Types (`src/types/`)
-   [x] Implement `SelfhostedSupabaseClient` (`src/client/`)
    -   [x] Basic connection (`@supabase/supabase-js`)
    -   [x] RPC `execute_sql` function call logic
    -   [x] RPC function existence check and creation logic (using service key)
    -   [x] Direct DB connection fallback/transactional method (`pg`)
    -   [x] Async initialization logic (`client.initialize()`)
-   [x] Implement Server Entry Point (`src/index.ts`)
    -   [x] `commander` setup for args/env vars
    -   [x] `createSelfhostedSupabaseClient` factory usage
    -   [x] MCP SDK initialization (`stdio: true`)
    -   [x] Tool registration
    -   [x] Error handling
-   [x] Implement Tools (`src/tools/`)
    -   [x] **Schema & Migrations**
        -   [x] `list_tables`
        -   [x] `list_extensions`
        -   [x] `list_migrations`
        -   [x] `apply_migration`
    -   [x] **Database Operations & Stats**
        -   [x] `execute_sql`
        -   [x] `get_database_connections`
        -   [x] `get_database_stats`
    -   [x] **Project Configuration & Keys**
        -   [x] `get_project_url`
        -   [x] `get_anon_key`
        -   [x] `get_service_key`
        -   [x] `verify_jwt_secret`
    -   [x] **Development & Extension Tools**
        -   [x] `generate_typescript_types`
        -   [x] `rebuild_hooks`
    -   [-] `get_logs` (Out of scope - PostgreSQL log access varies by installation)
    -   [x] **Auth User Management**
        -   [x] `user_admin` (consolidated: list, get, create, update, delete)
    -   [x] **Storage Management**
        -   [x] `list_storage_buckets`
        -   [x] `list_storage_objects`
        -   [x] `create_storage_bucket`
        -   [x] `delete_storage_bucket`
        -   [x] `delete_storage_object`
    -   [x] **Realtime Inspection**
        -   [x] `list_realtime_publications`
    -   [x] **Extension-Specific Tools**
        -   [x] `list_cron_jobs` (pg_cron)
        -   [x] `get_cron_job_history` (pg_cron)
        -   [x] `list_vector_indexes` (pgvector)
        -   [x] `get_vector_index_stats` (pgvector)
    -   [x] **Edge Function Management**
        -   [x] `list_edge_functions` (metadata table)
        -   [x] `get_edge_function_details` (metadata + logs)
        -   [x] `list_edge_function_logs`
        -   [-] `deploy_edge_function` (Out of scope - requires filesystem access)
-   [x] Add Basic README.md

## Implemented Beyond Original Scope

The following features were added beyond the original migration plan:

### Additional Tools (v1.0.0)
- **RLS Management**: `list_rls_policies`, `get_rls_status`, `enable_rls_on_table`, `create_rls_policy`, `drop_rls_policy`
- **Database Functions & Triggers**: `list_database_functions`, `get_function_definition`, `list_triggers`, `get_trigger_definition`
- **Index Management**: `list_indexes`, `get_index_stats`, `create_index`, `drop_index`
- **Schema Metadata**: `list_table_columns`, `list_foreign_keys`, `list_constraints`
- **Query Analysis**: `explain_query`
- **Extension Management**: `list_available_extensions`, `enable_extension`, `disable_extension`
- **Auth Sessions**: `list_auth_sessions`, `revoke_session`
- **Auth Flow**: `signin_with_password`, `signup_user`, `signout_user`, `generate_user_token`

### Architecture Enhancements (v1.0.0)
- **HTTP/SSE Transport**: Stateful HTTP server with JWT authentication
- **Security Profiles**: readonly, standard, admin, custom tool whitelists
- **Audit Logging**: JSON audit logs with field redaction
- **Auto-Managed Auth**: Server creates and manages its own user account
- **Credential Persistence**: Saves credentials to `~/.config/supabase-mcp/`
- **RLS Enforcement**: Session tools enforce per-user access in HTTP mode

### v1.1.0 Additions
- **Bun Migration**: Replaced Node.js with Bun runtime, bundler, and test runner
- **pg_cron Tools**: `list_cron_jobs`, `get_cron_job_history`
- **pgvector Tools**: `list_vector_indexes`, `get_vector_index_stats`
- **Edge Function Tools**: `list_edge_functions`, `get_edge_function_details`, `list_edge_function_logs`
- **Test Infrastructure**: Bun test runner with coverage

## Out of Scope (Intentionally Not Implemented)

| Feature | Reason |
|---------|--------|
| `get_logs` | PostgreSQL log access varies significantly by installation |
| `deploy_edge_function` | Requires filesystem access outside MCP scope |
| Multi-project support | Self-hosted is single-project by design |
| Cloud-specific features | Branching, cost management, etc. are cloud-only |

## Final Tool Count: 53 Tools

| Category | Count |
|----------|-------|
| Schema & Migrations | 4 |
| Database Operations | 4 |
| Row Level Security | 5 |
| Functions & Triggers | 4 |
| Index Management | 4 |
| Schema Metadata | 3 |
| Project Configuration | 6 |
| Auth User Management | 1 |
| Auth Sessions | 2 |
| Auth Flow | 4 |
| Storage Management | 5 |
| Realtime | 1 |
| Extension Management | 3 |
| pg_cron | 2 |
| pgvector | 2 |
| Edge Functions | 3 |
| **Total** | **53** |
