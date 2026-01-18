/**
 * Security Profiles for selfhosted-supabase-mcp
 *
 * Provides predefined tool configurations for different security levels.
 * Use --security-profile CLI option to select a profile.
 */

export type SecurityProfile = 'readonly' | 'standard' | 'admin' | 'custom';

export interface SecurityProfileConfig {
    name: SecurityProfile;
    description: string;
    enabledTools: string[];
}

/**
 * Read-only profile - Only allows querying data, no mutations
 */
const READONLY_TOOLS = [
    'list_tables',
    'list_extensions',
    'list_migrations',
    'execute_sql', // Will only allow read queries due to new safety flags
    'get_database_connections',
    'get_database_stats',
    'get_project_url',
    'get_anon_key', // Masked by default
    'verify_jwt_secret',
    'list_storage_buckets',
    'list_storage_objects',
    'list_realtime_publications',
    // Schema inspection tools
    'list_rls_policies',
    'get_rls_status',
    'list_database_functions',
    'get_function_definition',
    'list_triggers',
    'get_trigger_definition',
    'list_indexes',
    'get_index_stats',
    'explain_query',
    'list_table_columns',
    'list_foreign_keys',
    'list_constraints',
    'list_available_extensions',
    // pg_cron (read-only inspection)
    'list_cron_jobs',
    // pgvector (read-only inspection)
    'list_vector_indexes',
    // Edge Functions (read-only inspection)
    'list_edge_functions',
    'list_edge_function_logs',
];

/**
 * Standard profile - Common operations without dangerous capabilities
 * Includes auth user management and session tools.
 */
const STANDARD_TOOLS = [
    ...READONLY_TOOLS,
    // Auth user management (individual tools)
    'list_auth_users',
    'get_auth_user',
    'create_auth_user',
    'update_auth_user',
    'delete_auth_user',
    // Auth session tools (RLS enforced in HTTP mode)
    'list_auth_sessions',
    // Auth flow tools
    'signin_with_password',
    'signup_user',
    'signout_user',
    // Notably excludes:
    // - get_service_key (exposes sensitive credentials)
    // - apply_migration (DDL changes)
    // - generate_typescript_types (external CLI execution)
    // - rebuild_hooks (system modification)
    // - revoke_session (session termination)
    // - generate_user_token (sudo capability)
    // - enable/disable_extension (DDL)
    // - create/drop_index (DDL)
    // - enable_rls_on_table, create/drop_rls_policy (DDL)
    // - storage bucket/object deletion (destructive)
];

/**
 * Admin profile - Full access to all tools
 * Includes destructive operations and sudo capabilities.
 */
const ADMIN_TOOLS = [
    ...STANDARD_TOOLS,
    'get_service_key',
    'generate_user_token', // Sudo capability for impersonation
    'apply_migration',
    'generate_typescript_types',
    'rebuild_hooks',
    // DDL operations
    'enable_rls_on_table',
    'create_rls_policy',
    'drop_rls_policy',
    'create_index',
    'drop_index',
    // Session management (RLS enforced in HTTP mode)
    'revoke_session',
    // Storage operations
    'create_storage_bucket',
    'delete_storage_bucket',
    'delete_storage_object',
    // Extension management
    'enable_extension',
    'disable_extension',
    // pg_cron (detailed history - admin only)
    'get_cron_job_history',
    // pgvector (detailed stats - admin only)
    'get_vector_index_stats',
    // Edge Functions (detailed info - admin only)
    'get_edge_function_details',
];

/**
 * Security profile definitions
 */
export const SECURITY_PROFILES: Record<Exclude<SecurityProfile, 'custom'>, SecurityProfileConfig> = {
    readonly: {
        name: 'readonly',
        description: 'Read-only access. Can query data but cannot make any changes.',
        enabledTools: READONLY_TOOLS,
    },
    standard: {
        name: 'standard',
        description: 'Standard operations. Can create/update users but no destructive operations or credential exposure.',
        enabledTools: STANDARD_TOOLS,
    },
    admin: {
        name: 'admin',
        description: 'Full administrative access. All tools enabled including destructive operations.',
        enabledTools: ADMIN_TOOLS,
    },
};

/**
 * Get the tool whitelist for a given security profile
 */
export function getProfileTools(profile: SecurityProfile): string[] | null {
    if (profile === 'custom') {
        return null; // Custom means use --tools-config file
    }
    return SECURITY_PROFILES[profile]?.enabledTools ?? null;
}

/**
 * Validate that a profile name is valid
 */
export function isValidProfile(profile: string): profile is SecurityProfile {
    return profile === 'readonly' || profile === 'standard' || profile === 'admin' || profile === 'custom';
}

/**
 * Get profile description for help text
 */
export function getProfileDescriptions(): string {
    const lines = ['Available security profiles:'];
    for (const [name, config] of Object.entries(SECURITY_PROFILES)) {
        lines.push(`  ${name}: ${config.description}`);
        lines.push(`    Tools: ${config.enabledTools.length} enabled`);
    }
    lines.push('  custom: Use --tools-config to specify a custom tool whitelist');
    return lines.join('\n');
}
