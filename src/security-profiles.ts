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
    'list_auth_users',
    'get_auth_user',
    'list_storage_buckets',
    'list_storage_objects',
    'list_realtime_publications',
    // New read-only tools
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
    // Auth session inspection (read-only)
    'get_current_session',
];

/**
 * Standard profile - Common operations without dangerous capabilities
 */
const STANDARD_TOOLS = [
    ...READONLY_TOOLS,
    'create_auth_user',
    'update_auth_user',
    // New standard tools (read sessions)
    'list_auth_sessions',
    // Auth session operations (non-destructive)
    'signin_with_password',
    'signup_user',
    'refresh_session',
    'signout_user',
    // Notably excludes:
    // - get_service_key (exposes sensitive credentials)
    // - delete_auth_user (destructive)
    // - apply_migration (DDL changes)
    // - generate_typescript_types (external CLI execution)
    // - rebuild_hooks (system modification)
    // - revoke_session (session termination)
    // - enable/disable_extension (DDL)
    // - create/drop_index (DDL)
    // - enable_rls_on_table, create/drop_rls_policy (DDL)
    // - storage bucket/object deletion (destructive)
];

/**
 * Admin profile - Full access to all tools
 */
const ADMIN_TOOLS = [
    ...STANDARD_TOOLS,
    'get_service_key',
    'delete_auth_user',
    'apply_migration',
    'generate_typescript_types',
    'rebuild_hooks',
    // New admin tools (mutating/DDL operations)
    'enable_rls_on_table',
    'create_rls_policy',
    'drop_rls_policy',
    'create_index',
    'drop_index',
    'revoke_session',
    'create_storage_bucket',
    'delete_storage_bucket',
    'delete_storage_object',
    'enable_extension',
    'disable_extension',
    // Sudo capability (generates tokens for any user)
    'generate_user_token',
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
