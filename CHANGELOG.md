# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-01-17

### Changed

- **Auth User Tools**: Split consolidated `user_admin` into 5 individual tools for better AI tool calling:
  - `list_auth_users` - List users with pagination
  - `get_auth_user` - Get a single user by ID
  - `create_auth_user` - Create a new user
  - `update_auth_user` - Update user fields
  - `delete_auth_user` - Delete or disable a user
- **Tool Count**: Increased from 53 to 57 tools

### Removed

- Removed `user_admin` consolidated tool (replaced by individual tools above)

## [1.1.0] - 2026-01-17

### Added

#### Bun Runtime Migration
- Migrated from Node.js + tsup to Bun runtime, bundler, and test runner
- Added `bunfig.toml` for Bun configuration
- Added Bun test infrastructure with coverage support
- Updated all npm scripts to use Bun commands

#### pg_cron Extension Tools
- `list_cron_jobs` - List all scheduled cron jobs from pg_cron extension
- `get_cron_job_history` - Get execution history for cron jobs with filtering

#### pgvector Extension Tools
- `list_vector_indexes` - List all vector indexes (IVFFlat, HNSW) with parameters
- `get_vector_index_stats` - Get usage statistics and size for vector indexes

#### Edge Function Tools
- `list_edge_functions` - List edge functions from metadata tracking table
- `get_edge_function_details` - Get function details and execution logs
- `list_edge_function_logs` - List execution logs from function_edge_logs table

#### Test Infrastructure
- Added Bun test setup with `src/__tests__/setup.ts`
- Security profiles unit tests
- Credential manager unit tests

### Changed

- **Runtime**: Switched from Node.js to Bun for faster startup and execution
- **Build**: Replaced tsup with Bun's built-in bundler
- **Package Manager**: Replaced npm with Bun's package manager
- **Tool Count**: Increased from 46 to 53 tools
- **Security Profiles**: Updated to include new extension and edge function tools
  - Readonly: Added 4 new read-only tools (29 → 33 tools)
  - Admin: Added 3 new admin-only tools (46 → 53 tools)

### Removed

- Removed tsup dependency (replaced by Bun bundler)
- Removed package-lock.json (replaced by bun.lockb)

## [1.0.0] - 2026-01-17

### Added

- Initial release with 46 tools for self-hosted Supabase management
- Dual transport modes: Stdio and HTTP/SSE
- Security profiles: readonly, standard, admin, custom
- JWT authentication for HTTP mode
- RLS enforcement for session tools in HTTP mode
- Audit logging with field redaction
- Auto-managed user account with credential persistence

### Tool Categories

#### Schema & Migrations (4 tools)
- `list_tables`, `list_extensions`, `list_migrations`, `apply_migration`

#### Database Operations (4 tools)
- `execute_sql`, `get_database_connections`, `get_database_stats`, `explain_query`

#### Row Level Security (5 tools)
- `list_rls_policies`, `get_rls_status`, `enable_rls_on_table`, `create_rls_policy`, `drop_rls_policy`

#### Database Functions & Triggers (4 tools)
- `list_database_functions`, `get_function_definition`, `list_triggers`, `get_trigger_definition`

#### Index Management (4 tools)
- `list_indexes`, `get_index_stats`, `create_index`, `drop_index`

#### Schema Metadata (3 tools)
- `list_table_columns`, `list_foreign_keys`, `list_constraints`

#### Project Configuration (6 tools)
- `get_project_url`, `get_anon_key`, `get_service_key`, `verify_jwt_secret`, `generate_typescript_types`, `rebuild_hooks`

#### Auth User Management (1 tool)
- `user_admin` (list, get, create, update, delete operations)

#### Auth Session Management (2 tools)
- `list_auth_sessions`, `revoke_session`

#### Auth Flow (4 tools)
- `signin_with_password`, `signup_user`, `signout_user`, `generate_user_token`

#### Storage Management (5 tools)
- `list_storage_buckets`, `list_storage_objects`, `create_storage_bucket`, `delete_storage_bucket`, `delete_storage_object`

#### Realtime Inspection (1 tool)
- `list_realtime_publications`

#### Extension Management (3 tools)
- `list_available_extensions`, `enable_extension`, `disable_extension`
