# Security Guide

This document describes the security features and best practices for using the Self-Hosted Supabase MCP Server.

## Transport Modes

The server supports two transport modes with different security characteristics:

### stdio Mode (Default)
- Traditional MCP transport for CLI integration
- No authentication layer - trust is assumed from the parent process
- Best for: Local development, IDE integrations, trusted environments

### HTTP Mode
- REST-based transport with JWT authentication
- Clients must authenticate with a Supabase JWT
- Stateful sessions that persist (unlike stdio which exits)
- Best for: AI agents that need persistent connections

```bash
# Start in HTTP mode
bun run dist/index.js --transport http --port 3100 --jwt-secret $JWT_SECRET ...
```

## Security Profiles

The server supports four security profiles that control which tools are available:

### `readonly` (Safest)
Only allows querying data, no mutations. Safe for exploration and debugging.

**Enabled tools:**
- Schema inspection: `list_tables`, `list_extensions`, `list_migrations`
- SQL (read-only): `execute_sql`
- Database stats: `get_database_connections`, `get_database_stats`
- Project config: `get_project_url`, `get_anon_key` (masked), `verify_jwt_secret`
- Storage (read): `list_storage_buckets`, `list_storage_objects`
- Realtime: `list_realtime_publications`
- Schema metadata: `list_rls_policies`, `get_rls_status`, `list_database_functions`, `get_function_definition`, `list_triggers`, `get_trigger_definition`, `list_indexes`, `get_index_stats`, `explain_query`, `list_table_columns`, `list_foreign_keys`, `list_constraints`, `list_available_extensions`
- pg_cron: `list_cron_jobs`
- pgvector: `list_vector_indexes`
- Edge Functions: `list_edge_functions`, `list_edge_function_logs`

### `standard`
Common operations without dangerous capabilities. Good for development.

**Includes everything in `readonly`, plus:**
- User management: `list_auth_users`, `get_auth_user`, `create_auth_user`, `update_auth_user`, `delete_auth_user`
- Session tools: `list_auth_sessions`
- Auth flows: `signin_with_password`, `signup_user`, `signout_user`

**Excludes (notable):**
- `get_service_key` (credential exposure)
- `generate_user_token` (sudo/impersonation capability)
- `apply_migration` (DDL changes)
- `revoke_session` (session termination)
- Storage mutations: `create_storage_bucket`, `delete_storage_bucket`, `delete_storage_object`
- DDL: `enable_rls_on_table`, `create_rls_policy`, `drop_rls_policy`, `create_index`, `drop_index`
- Extension management: `enable_extension`, `disable_extension`

### `admin`
Full access to all tools. Use only when necessary and with trusted users.

**Includes everything in `standard`, plus all excluded tools above, and:**
- pg_cron: `get_cron_job_history`
- pgvector: `get_vector_index_stats`
- Edge Functions: `get_edge_function_details`

### `custom`
Use `--tools-config` to specify exactly which tools to enable.

```bash
bun run dist/index.js --security-profile custom --tools-config ./my-tools.json ...
```

Config file format:
```json
{
  "enabledTools": ["list_tables", "execute_sql", "list_auth_sessions"]
}
```

## HTTP Mode Security

### JWT Authentication
All requests must include a valid Supabase JWT in the Authorization header:
```
Authorization: Bearer <JWT>
```

The JWT is validated against the configured `--jwt-secret` (SUPABASE_AUTH_JWT_SECRET).

### Supported Token Types

The server accepts three types of Supabase JWTs:

| Token Type | Use Case | RLS Behavior |
|------------|----------|--------------|
| **User JWT** | Debug as a specific user | RLS enforced, scoped to user |
| **service_role** | Admin operations (like sudo) | Bypasses RLS, full access |
| **anon** | Public/anonymous access | RLS enforced, no user context |

**Typical workflow**: Connect with the service_role key for full access during debugging. When you need to test behavior as a specific user (e.g., verify RLS policies), you can sign in as that user to get a user JWT.

This is like running as root for debugging, and using `su username` when you need to test user-specific behavior.

### Session Limits

The HTTP server enforces session limits to prevent resource exhaustion:
- **Max total sessions**: 1000 (default)
- **Max sessions per user**: 10 (default)

Exceeding these limits returns HTTP 429 (Too Many Requests).

## Tool-Specific Safety Features

### Credential Exposure (`get_anon_key`, `get_service_key`)

Keys are **masked by default**. You'll see something like `eyJhb...J9.Xz` instead of the full key.

To reveal the full key (when you actually need it):
```json
{ "reveal": true }
```

### SQL Execution (`execute_sql`)

The `execute_sql` tool has safety flags to prevent accidental data modification:

| Query Type | Flag Required | Description |
|------------|---------------|-------------|
| `read` | None | SELECT queries work by default |
| `write` | `allow_write: true` | INSERT, UPDATE, DELETE |
| `ddl` | `allow_ddl: true` | CREATE, ALTER, DROP tables/functions |
| `dangerous` | `allow_dangerous: true` | TRUNCATE, DROP DATABASE, operations without WHERE clauses |

**Dry-run mode**: Use `dry_run: true` to see how a query would be classified without executing it.

Example:
```json
{
  "sql": "DELETE FROM users WHERE id = 123",
  "allow_write": true
}
```

### User Management (`delete_auth_user`)

The `delete_auth_user` tool requires explicit confirmation:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `user_id` | required | UUID of the user to delete |
| `confirm` | `false` | Must be `true` to actually delete |
| `disable_instead` | `false` | Disable the user instead of deleting |

Example (soft delete):
```json
{
  "user_id": "...",
  "confirm": true,
  "disable_instead": true
}
```

### Token Generation (`generate_user_token`)

**This is a powerful sudo capability** - generates valid JWTs for any user without knowing their password.

Use cases:
- Admin impersonation for debugging
- Testing user-specific functionality
- Service-to-service authentication

| Parameter | Default | Description |
|-----------|---------|-------------|
| `user_id` | required | User to generate token for |
| `create_session` | `false` | Create real session in DB (appears in `list_auth_sessions`) |
| `expires_in` | `3600` | Token validity in seconds |

This tool is **excluded from `standard` profile** and only available in `admin`.

### Migrations (`apply_migration`)

Requires confirmation and analyzes the SQL for dangerous operations:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `confirm` | `false` | Must be `true` to apply |
| `force_destructive` | `false` | Required if migration contains DROP, TRUNCATE, etc. |

Without `confirm: true`, you'll get a dry-run analysis showing:
- Number of statements
- Detected warnings (DROP TABLE, CASCADE, etc.)
- Whether `force_destructive` will be required

## Audit Logging

The server logs all tool executions for security auditing.

### Enable/Disable

```bash
# Audit logging is enabled by default
bun run dist/index.js ...

# Write audit logs to a file (in addition to stderr)
bun run dist/index.js --audit-log /var/log/mcp-audit.log ...

# Disable audit logging entirely
bun run dist/index.js --no-audit ...
```

### Log Format

Logs are JSON-structured for easy parsing:

```json
{
  "timestamp": "2025-01-17T12:34:56.789Z",
  "level": "info",
  "tool": "execute_sql",
  "action": "execute",
  "sanitizedParams": {
    "sql": "SELECT * FROM users WH... [truncated]",
    "allow_write": false
  },
  "result": "success"
}
```

### What's Logged

- All tool executions (success and failure)
- Blocked operations (disabled tools, missing permissions)
- Security-relevant events (credential reveals, destructive operations)
- Session lifecycle events (in HTTP mode)

### Sensitive Field Redaction

The following fields are automatically redacted in logs:
- `password`
- `secret`
- `key`
- `token`
- `credential`
- `api_key`
- `authorization`

## Best Practices

1. **Start with `readonly`** - Use the most restrictive profile that meets your needs.

2. **Use HTTP mode for multi-user** - Never expose stdio mode to untrusted users.

3. **Use a dedicated database user** - Don't use the postgres superuser. Create a user with only the permissions needed.

4. **Enable audit logging** - Always have `--audit-log` pointing to a file for production use.

5. **Avoid storing credentials in config files** - Use environment variables or secret management.

6. **Review before confirming** - Always run migrations and deletions without `confirm` first to see the preview.

7. **Use `dry_run` for SQL** - Test complex queries with `dry_run: true` before executing.

8. **Prefer `disable_instead`** - When removing user access, disable instead of delete to preserve audit trails.

9. **Restrict `generate_user_token`** - This tool enables user impersonation; only enable it when absolutely necessary.

## Credential Storage

### Server Identity Credentials

When running in HTTP mode, the MCP server maintains its own user identity for server-to-Supabase authentication. These credentials are stored locally:

**Location**: `~/.config/supabase-mcp/credentials.json`

**Contents**:
```json
{
  "email": "mcp-server-abc123@localhost",
  "password": "<generated-password>"
}
```

### Security Measures

| Protection | Description |
|------------|-------------|
| **File Permissions** | Created with `0o600` (owner read/write only) |
| **Auto-generated** | Credentials are randomly generated, not user-provided |
| **Local storage** | Never transmitted or logged |

### Risks

⚠️ **If your home directory is compromised**, an attacker could:
- Impersonate the MCP server to your Supabase instance
- Access data according to the server's permissions

### Recommendations for Sensitive Deployments

1. **Use explicit credentials**: Instead of auto-generated credentials, provide your own via environment variables:
   ```bash
   export MCP_USER_EMAIL="mcp-server@yourdomain.com"
   export MCP_USER_PASSWORD="your-secure-password"
   ```

2. **Restrict the MCP user's database permissions**: Create a dedicated Supabase user with minimal required permissions.

3. **Monitor the MCP user's activity**: Enable audit logging and monitor for unusual activity from the MCP server's user account.

4. **Consider OS-level encryption**: Use full-disk encryption or encrypted home directories for additional protection.

5. **Rotate credentials periodically**: Delete `~/.config/supabase-mcp/credentials.json` to force regeneration, or update the environment variables.

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (optional) |
| `DATABASE_URL` | Direct PostgreSQL connection |
| `SUPABASE_AUTH_JWT_SECRET` | JWT secret (required for HTTP mode) |
| `MCP_SECURITY_PROFILE` | Default security profile |
| `MCP_TRANSPORT` | Transport mode: `stdio` or `http` |
| `MCP_PORT` | HTTP port (default: 3100) |
| `MCP_HOST` | HTTP host (default: 127.0.0.1) |
| `MCP_USER_EMAIL` | Override auto-managed user account with specific email |
| `MCP_USER_PASSWORD` | Password for the user account (required if email is set) |

## Reporting Security Issues

If you discover a security vulnerability, please report it privately. Do not create a public issue.
