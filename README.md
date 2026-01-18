# Self-Hosted Supabase MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![smithery badge](https://smithery.ai/badge/@HenkDz/selfhosted-supabase-mcp)](https://smithery.ai/server/@HenkDz/selfhosted-supabase-mcp)

## Overview

This project provides a [Model Context Protocol (MCP)](https://github.com/modelcontextprotocol/specification) server designed specifically for interacting with **self-hosted Supabase instances**. It bridges the gap between MCP clients (like IDE extensions) and your local or privately hosted Supabase projects, enabling database introspection, management, and interaction directly from your development environment.

The server supports two transport modes:
- **Stdio** (default): Traditional MCP stdio transport for IDE integrations
- **HTTP/SSE**: Stateful HTTP server with Supabase JWT authentication for web clients and persistent connections

## Purpose

The primary goal of this server is to enable developers using self-hosted Supabase installations to leverage MCP-based tools for tasks such as:

*   Querying database schemas and data.
*   Managing database migrations.
*   Inspecting database statistics and connections.
*   Managing authentication users.
*   Interacting with Supabase Storage.
*   Generating type definitions.

It avoids the complexities of the official cloud server related to multi-project management and cloud-specific APIs, offering a streamlined experience for single-project, self-hosted environments.

## Features (Implemented Tools)

The server exposes **46 tools** to MCP clients, organized into the following categories:

### Schema & Migrations
*   `list_tables`: Lists tables in the database schemas.
*   `list_extensions`: Lists installed PostgreSQL extensions.
*   `list_migrations`: Lists applied Supabase migrations.
*   `apply_migration`: Applies a SQL migration script.

### Database Operations & Stats
*   `execute_sql`: Executes an arbitrary SQL query (via RPC or direct connection).
*   `get_database_connections`: Shows active database connections (`pg_stat_activity`).
*   `get_database_stats`: Retrieves database statistics (`pg_stat_*`).
*   `explain_query`: Gets the execution plan for a SQL query (EXPLAIN).

### Row Level Security (RLS)
*   `list_rls_policies`: Lists all RLS policies with their definitions.
*   `get_rls_status`: Checks if RLS is enabled on tables and shows policy count.
*   `enable_rls_on_table`: Enables RLS on a specific table.
*   `create_rls_policy`: Creates a new RLS policy.
*   `drop_rls_policy`: Drops an existing RLS policy.

### Database Functions & Triggers
*   `list_database_functions`: Lists all user-defined functions/stored procedures.
*   `get_function_definition`: Gets the full source code of a function.
*   `list_triggers`: Lists all triggers on tables.
*   `get_trigger_definition`: Gets the full definition of a trigger including its function.

### Index Management
*   `list_indexes`: Lists all indexes with definitions and sizes.
*   `get_index_stats`: Gets detailed statistics for a specific index.
*   `create_index`: Creates a new index (supports CONCURRENTLY, partial indexes, covering indexes).
*   `drop_index`: Drops an existing index.

### Schema Metadata
*   `list_table_columns`: Lists all columns for a table with detailed metadata.
*   `list_foreign_keys`: Lists all foreign key relationships.
*   `list_constraints`: Lists all constraints (PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK, EXCLUDE).

### Project Configuration & Keys
*   `get_project_url`: Returns the configured Supabase URL.
*   `get_anon_key`: Returns the configured Supabase anon key (masked by default).
*   `get_service_key`: Returns the configured Supabase service role key (if provided).
*   `verify_jwt_secret`: Checks if the JWT secret is configured and returns a preview.

### Development & Extension Tools
*   `generate_typescript_types`: Generates TypeScript types from the database schema.
*   `rebuild_hooks`: Attempts to restart the `pg_net` worker (if used).
*   `list_available_extensions`: Lists all PostgreSQL extensions available for installation.
*   `enable_extension`: Enables (installs) a PostgreSQL extension.
*   `disable_extension`: Disables (uninstalls) a PostgreSQL extension.

### Auth User Management
*   `user_admin`: Consolidated tool for managing users in `auth.users`. Operations:
    - `list`: List users with pagination
    - `get`: Get a specific user by ID
    - `create`: Create a new user with email/password
    - `update`: Update user fields (email, password, role, metadata)
    - `delete`: Delete or disable a user (with confirmation)

### Auth Session Management
*   `list_auth_sessions`: Lists active authentication sessions. In HTTP mode, users can only see their own sessions (RLS enforced).
*   `revoke_session`: Revokes (deletes) an authentication session. In HTTP mode, users can only revoke their own sessions (RLS enforced).

### Auth Flow
*   `signin_with_password`: Sign in a user with email/password and get JWT tokens.
*   `signup_user`: Register a new user and optionally return session tokens.
*   `signout_user`: Sign out a user and invalidate their sessions.
*   `generate_user_token`: **[Admin/Sudo]** Generate a JWT token for any user without their password.

### Storage Management
*   `list_storage_buckets`: Lists all storage buckets.
*   `list_storage_objects`: Lists objects within a specific bucket.
*   `create_storage_bucket`: Creates a new storage bucket.
*   `delete_storage_bucket`: Deletes a storage bucket (with optional force delete).
*   `delete_storage_object`: Deletes a file/object from storage.

### Realtime Inspection
*   `list_realtime_publications`: Lists PostgreSQL publications (often `supabase_realtime`).

## Transport Modes

### Stdio Mode (Default)

Traditional MCP transport for IDE integrations. The server communicates via standard input/output.

```bash
node dist/index.js --url http://localhost:8000 --anon-key <key>
```

### HTTP Mode

Stateful HTTP/SSE server with Supabase JWT authentication. Clients authenticate by passing their Supabase JWT in the `Authorization` header.

```bash
node dist/index.js \
  --transport http \
  --port 3100 \
  --url http://localhost:8000 \
  --anon-key <anon-key> \
  --service-key <service-key> \
  --jwt-secret <jwt-secret>
```

**HTTP Mode Features:**
- Persistent connections via Server-Sent Events (SSE)
- JWT authentication - clients pass `Authorization: Bearer <token>`
- Automatic token validation and refresh
- RLS enforcement - session tools restrict users to their own data
- Health check endpoint at `GET /health`

**HTTP Endpoints:**
- `POST /mcp` - Initialize MCP session
- `GET /mcp` - SSE stream for server-to-client messages
- `DELETE /mcp` - Close session
- `GET /health` - Health check

## Security Profiles

The server supports four security profiles that control which tools are available:

| Profile | Tools | Description |
|---------|-------|-------------|
| **readonly** | 25 | Read-only access. Can query and inspect but cannot make any changes. |
| **standard** | 30 | Standard operations. Includes readonly plus user management and auth operations. |
| **admin** | 46 | Full administrative access. All tools enabled including destructive operations. |
| **custom** | Variable | User-defined tool list via `--tools-config` JSON file. |

### Profile Tool Breakdown

**Readonly profile includes:**
- All list/get operations (tables, indexes, functions, triggers, RLS policies, etc.)
- Query execution (read-only via safety flags)
- Query plan analysis (EXPLAIN)
- Storage bucket/object listing
- Realtime publication listing

**Standard profile adds:**
- `user_admin` (list, get, create, update, delete operations)
- `list_auth_sessions`
- Auth flow operations (`signin_with_password`, `signup_user`, `signout_user`)

**Admin profile adds:**
- Credential access (`get_service_key`)
- Sudo capability (`generate_user_token` - generate JWT for any user)
- Session management (`revoke_session`)
- DDL operations (`apply_migration`, `create_index`, `drop_index`, `enable_extension`, `disable_extension`)
- RLS management (`enable_rls_on_table`, `create_rls_policy`, `drop_rls_policy`)
- Storage management (`create_storage_bucket`, `delete_storage_bucket`, `delete_storage_object`)
- Development tools (`generate_typescript_types`, `rebuild_hooks`)

See [SECURITY.md](./SECURITY.md) for detailed information about security considerations.

## Setup and Installation

### Installing via Smithery

To install Self-Hosted Supabase MCP Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@HenkDz/selfhosted-supabase-mcp):

```bash
npx -y @smithery/cli install @HenkDz/selfhosted-supabase-mcp --client claude
```

### Prerequisites

*   Node.js (Version 20.x or later required)
*   npm (usually included with Node.js)
*   Access to your self-hosted Supabase instance (URL, keys, potentially direct DB connection string).

### Steps

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd selfhosted-supabase-mcp
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Build the project:**
    ```bash
    npm run build
    ```
    This compiles the TypeScript code to JavaScript in the `dist` directory.

## Configuration

The server requires configuration details for your Supabase instance. These can be provided via command-line arguments or environment variables. CLI arguments take precedence.

### Transport Options

*   `--transport <mode>`: Transport mode - `stdio` (default) or `http`.
*   `--port <number>`: Port for HTTP server (default: 3100). Only used with `--transport http`.
*   `--host <address>`: Host address for HTTP server (default: `localhost`). Only used with `--transport http`.

### Required

*   `--url <url>` or `SUPABASE_URL=<url>`: The main HTTP URL of your Supabase project (e.g., `http://localhost:8000`).
*   `--anon-key <key>` or `SUPABASE_ANON_KEY=<key>`: Your Supabase project's anonymous key.

### Optional (but Recommended/Required for certain tools)

*   `--service-key <key>` or `SUPABASE_SERVICE_ROLE_KEY=<key>`: Your Supabase project's service role key. Needed for operations requiring elevated privileges.
*   `--db-url <url>` or `DATABASE_URL=<url>`: The direct PostgreSQL connection string for your Supabase database (e.g., `postgresql://postgres:password@localhost:5432/postgres`). Required for tools needing direct database access.
*   `--jwt-secret <secret>` or `SUPABASE_AUTH_JWT_SECRET=<secret>`: Your Supabase project's JWT secret. **Required for HTTP mode** to validate client tokens.
*   `--security-profile <profile>`: Security profile controlling which tools are enabled. Options: `readonly`, `standard`, `admin` (default), `custom`.
*   `--tools-config <path>`: Path to a JSON file specifying which tools to enable. Required when using `--security-profile custom`. Format: `{"enabledTools": ["tool_name_1", "tool_name_2"]}`.
*   `--audit-log <path>`: Path to write audit logs (in addition to stderr).
*   `--no-audit`: Disable audit logging.
*   `--user-email <email>` or `MCP_USER_EMAIL=<email>`: Override auto-managed user account with a specific email.
*   `--user-password <password>` or `MCP_USER_PASSWORD=<password>`: Password for the user account (required if `--user-email` is set).

### Important Notes:

*   **Auto-Managed User Account:** On startup, the server automatically creates and logs in with a user account for authenticated operations. Credentials are persisted to `~/.config/supabase-mcp/credentials.json`. Use `--user-email` and `--user-password` to override with a specific account.
*   **`execute_sql` Helper Function:** Many tools rely on a `public.execute_sql` function within your Supabase database for secure and efficient SQL execution via RPC. The server attempts to check for this function on startup. If it's missing *and* a `service-key` *and* `db-url` are provided, it will attempt to create the function.
*   **Direct Database Access:** Tools interacting directly with privileged schemas (`auth`, `storage`) or system catalogs (`pg_catalog`) require the `DATABASE_URL` to be configured.
*   **HTTP Mode Requirements:** When using `--transport http`, the `--jwt-secret` is required to validate client JWT tokens.

## Usage

### Stdio Mode (IDE Integration)

```bash
# Using CLI arguments
node dist/index.js --url http://localhost:8000 --anon-key <your-anon-key> --db-url postgresql://postgres:password@localhost:5432/postgres

# Using environment variables
export SUPABASE_URL=http://localhost:8000
export SUPABASE_ANON_KEY=<your-anon-key>
export DATABASE_URL=postgresql://postgres:password@localhost:5432/postgres
node dist/index.js
```

### HTTP Mode (Web Clients)

```bash
# Start HTTP server
node dist/index.js \
  --transport http \
  --port 3100 \
  --url http://localhost:8000 \
  --anon-key <anon-key> \
  --service-key <service-key> \
  --db-url postgresql://postgres:password@localhost:5432/postgres \
  --jwt-secret <jwt-secret>
```

Clients connect with their Supabase JWT:
```bash
# Initialize session
curl -X POST http://localhost:3100/mcp \
  -H "Authorization: Bearer <supabase-jwt>" \
  -H "Content-Type: application/json"

# Health check
curl http://localhost:3100/health
```

## Client Configuration Examples

Below are examples of how to configure popular MCP clients to use this self-hosted server.

**Important:**
*   Replace placeholders like `<your-supabase-url>`, `<your-anon-key>`, etc., with your actual values.
*   Ensure the path to the compiled server file (`dist/index.js`) is correct for your system.

### Cursor

1.  Create or open the file `.cursor/mcp.json` in your project root.
2.  Add the following configuration:

    ```json
    {
      "mcpServers": {
        "selfhosted-supabase": {
          "command": "node",
          "args": [
            "<path-to-dist/index.js>",
            "--url", "<your-supabase-url>",
            "--anon-key", "<your-anon-key>",
            "--service-key", "<your-service-key>",
            "--db-url", "<your-db-url>",
            "--jwt-secret", "<your-jwt-secret>"
          ]
        }
      }
    }
    ```

### Visual Studio Code (Copilot)

1.  Create or open the file `.vscode/mcp.json` in your project root.
2.  Add the following configuration:

    ```json
    {
      "inputs": [
        { "type": "promptString", "id": "sh-supabase-url", "description": "Self-Hosted Supabase URL", "default": "http://localhost:8000" },
        { "type": "promptString", "id": "sh-supabase-anon-key", "description": "Self-Hosted Supabase Anon Key", "password": true },
        { "type": "promptString", "id": "sh-supabase-service-key", "description": "Self-Hosted Supabase Service Key", "password": true },
        { "type": "promptString", "id": "sh-supabase-db-url", "description": "Self-Hosted Supabase DB URL", "password": true },
        { "type": "promptString", "id": "sh-supabase-jwt-secret", "description": "Self-Hosted Supabase JWT Secret", "password": true },
        { "type": "promptString", "id": "sh-supabase-server-path", "description": "Path to self-hosted-supabase-mcp/dist/index.js" }
      ],
      "servers": {
        "selfhosted-supabase": {
          "command": "node",
          "args": ["${input:sh-supabase-server-path}"],
          "env": {
            "SUPABASE_URL": "${input:sh-supabase-url}",
            "SUPABASE_ANON_KEY": "${input:sh-supabase-anon-key}",
            "SUPABASE_SERVICE_ROLE_KEY": "${input:sh-supabase-service-key}",
            "DATABASE_URL": "${input:sh-supabase-db-url}",
            "SUPABASE_AUTH_JWT_SECRET": "${input:sh-supabase-jwt-secret}"
          }
        }
      }
    }
    ```

### Other Clients (Windsurf, Cline, Claude)

Adapt the configuration structure shown for Cursor, replacing the `command` and `args` with the `node` command and arguments:

```json
{
  "mcpServers": {
    "selfhosted-supabase": {
      "command": "node",
      "args": [
        "<path-to-dist/index.js>",
        "--url", "<your-supabase-url>",
        "--anon-key", "<your-anon-key>",
        "--service-key", "<your-service-key>",
        "--db-url", "<your-db-url>",
        "--jwt-secret", "<your-jwt-secret>"
      ]
    }
  }
}
```

Consult the specific documentation for each client on where to place the configuration file.

## Development

*   **Language:** TypeScript
*   **Build:** `tsup` (bundler)
*   **Dependencies:** Managed via `npm` (`package.json`)
*   **Core Libraries:** `@supabase/supabase-js`, `pg` (node-postgres), `zod` (validation), `commander` (CLI args), `@modelcontextprotocol/sdk` (MCP server framework), `jsonwebtoken` (JWT validation), `express` (HTTP server).

## License

This project is licensed under the MIT License. See the LICENSE file for details.
