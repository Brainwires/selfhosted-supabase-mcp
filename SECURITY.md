# Security Guide

This document describes the security features and best practices for using the Self-Hosted Supabase MCP Server.

## Security Profiles

The server supports four security profiles that control which tools are available:

### `readonly` (Recommended for most use cases)
Only allows querying data, no mutations. Safe for exploration and debugging.

**Enabled tools:**
- `list_tables`, `list_extensions`, `list_migrations`
- `execute_sql` (read-only queries only)
- `get_database_connections`, `get_database_stats`
- `get_project_url`, `get_anon_key` (masked), `verify_jwt_secret`
- `list_auth_users`, `get_auth_user`
- `list_storage_buckets`, `list_storage_objects`
- `list_realtime_publications`

### `standard`
Common operations without dangerous capabilities. Good for development.

**Includes everything in `readonly`, plus:**
- `create_auth_user`
- `update_auth_user`

**Excludes:**
- `get_service_key` (credential exposure)
- `delete_auth_user` (destructive)
- `apply_migration` (DDL changes)
- `generate_typescript_types` (external CLI execution)
- `rebuild_hooks` (system modification)

### `admin`
Full access to all tools. Use only when necessary.

**Includes everything.**

### `custom`
Use `--tools-config` to specify exactly which tools to enable.

## Usage

```bash
# Start with readonly profile (recommended)
node dist/index.js --security-profile readonly --url ... --anon-key ...

# Start with standard profile
node dist/index.js --security-profile standard --url ... --anon-key ...

# Start with custom profile
node dist/index.js --security-profile custom --tools-config ./my-tools.json --url ... --anon-key ...

# Use environment variable
MCP_SECURITY_PROFILE=readonly node dist/index.js --url ... --anon-key ...
```

## Tool-Specific Safety Features

### Credential Exposure (`get_anon_key`, `get_service_key`)

Keys are **masked by default**. You'll see something like `eyJhb...J9.Xz` instead of the full key.

To reveal the full key (when you actually need it):
```json
{ "reveal": true }
```

### SQL Execution (`execute_sql`)

The `execute_sql` tool now has safety flags to prevent accidental data modification:

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

### User Deletion (`delete_auth_user`)

Requires explicit confirmation and offers a safer alternative:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `confirm` | `false` | Must be `true` to actually delete |
| `disable_instead` | `false` | Disable the user instead of deleting |

Without `confirm: true`, you'll get a preview of the user to be deleted.

Example (soft delete):
```json
{
  "user_id": "...",
  "confirm": true,
  "disable_instead": true
}
```

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
node dist/index.js ...

# Write audit logs to a file (in addition to stderr)
node dist/index.js --audit-log /var/log/mcp-audit.log ...

# Disable audit logging entirely
node dist/index.js --no-audit ...
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

2. **Use a dedicated database user** - Don't use the postgres superuser. Create a user with only the permissions needed.

3. **Enable audit logging** - Always have `--audit-log` pointing to a file for production use.

4. **Avoid storing credentials in config files** - Use environment variables or secret management.

5. **Review before confirming** - Always run migrations and deletions without `confirm` first to see the preview.

6. **Use `dry_run` for SQL** - Test complex queries with `dry_run: true` before executing.

7. **Prefer `disable_instead`** - When removing user access, disable instead of delete to preserve audit trails.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (optional) |
| `DATABASE_URL` | Direct PostgreSQL connection |
| `SUPABASE_AUTH_JWT_SECRET` | JWT secret (optional) |
| `MCP_SECURITY_PROFILE` | Default security profile |

## Reporting Security Issues

If you discover a security vulnerability, please report it privately. Do not create a public issue.
