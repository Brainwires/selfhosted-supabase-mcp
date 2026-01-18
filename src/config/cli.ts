/**
 * CLI Configuration - Parses command line options.
 * Extracted from index.ts for modularity.
 */

import { Command } from 'commander';
import { getProfileDescriptions } from '../security-profiles.js';

export interface CliOptions {
    transport: 'stdio' | 'http';
    port: number;
    host: string;
    url: string;
    anonKey: string;
    serviceKey?: string;
    dbUrl?: string;
    jwtSecret?: string;
    workspacePath: string;
    securityProfile: string;
    toolsConfig?: string;
    auditLog?: string;
    audit: boolean;
    // Auto-managed user account options (override auto-created account)
    userEmail?: string;
    userPassword?: string;
}

/**
 * Parses CLI arguments and returns validated options.
 */
export function parseCliOptions(): CliOptions {
    const program = new Command();

    program
        .name('self-hosted-supabase-mcp')
        .description('MCP Server for self-hosted Supabase instances')
        .option('--transport <type>', 'Transport mode: stdio or http (default: stdio)', process.env.MCP_TRANSPORT || 'stdio')
        .option('--port <number>', 'HTTP port when using http transport (default: 3100)', process.env.MCP_PORT || '3100')
        .option('--host <host>', 'HTTP host to bind to (default: 127.0.0.1)', process.env.MCP_HOST || '127.0.0.1')
        .option('--url <url>', 'Supabase project URL', process.env.SUPABASE_URL)
        .option('--anon-key <key>', 'Supabase anonymous key', process.env.SUPABASE_ANON_KEY)
        .option('--service-key <key>', 'Supabase service role key (optional)', process.env.SUPABASE_SERVICE_ROLE_KEY)
        .option('--db-url <url>', 'Direct database connection string (optional)', process.env.DATABASE_URL)
        .option('--jwt-secret <secret>', 'Supabase JWT secret (required for http transport)', process.env.SUPABASE_AUTH_JWT_SECRET)
        .option('--workspace-path <path>', 'Workspace root path (for file operations)', process.cwd())
        .option('--security-profile <profile>', 'Security profile: readonly, standard, admin, or custom', process.env.MCP_SECURITY_PROFILE || 'admin')
        .option('--tools-config <path>', 'Path to JSON file for custom tool configuration')
        .option('--audit-log <path>', 'Path to write audit logs (in addition to stderr)')
        .option('--no-audit', 'Disable audit logging')
        .option('--user-email <email>', 'Override auto-managed user account with specific email', process.env.MCP_USER_EMAIL)
        .option('--user-password <password>', 'Password for the user account (required if --user-email is set)', process.env.MCP_USER_PASSWORD)
        .addHelpText('after', `\n${getProfileDescriptions()}`)
        .parse(process.argv);

    const opts = program.opts();

    return {
        transport: opts.transport as 'stdio' | 'http',
        port: parseInt(opts.port, 10),
        host: opts.host,
        url: opts.url,
        anonKey: opts.anonKey,
        serviceKey: opts.serviceKey,
        dbUrl: opts.dbUrl,
        jwtSecret: opts.jwtSecret,
        workspacePath: opts.workspacePath,
        securityProfile: opts.securityProfile,
        toolsConfig: opts.toolsConfig,
        auditLog: opts.auditLog,
        audit: opts.audit !== false,
        userEmail: opts.userEmail,
        userPassword: opts.userPassword,
    };
}

/**
 * Validates CLI options and throws if invalid.
 */
export function validateCliOptions(options: CliOptions): void {
    // Validate transport
    if (options.transport !== 'stdio' && options.transport !== 'http') {
        throw new Error(`Invalid transport mode: ${options.transport}. Valid options: stdio, http`);
    }

    // Required options
    if (!options.url) {
        throw new Error('Supabase URL is required. Use --url or SUPABASE_URL.');
    }
    if (!options.anonKey) {
        throw new Error('Supabase Anon Key is required. Use --anon-key or SUPABASE_ANON_KEY.');
    }

    // HTTP transport requires JWT secret
    if (options.transport === 'http' && !options.jwtSecret) {
        throw new Error('JWT secret is required for HTTP transport. Use --jwt-secret or SUPABASE_AUTH_JWT_SECRET.');
    }

    // Validate port
    if (options.transport === 'http' && (options.port < 1 || options.port > 65535)) {
        throw new Error(`Invalid port: ${options.port}. Must be between 1 and 65535.`);
    }

    // If user email is provided, password is required
    if (options.userEmail && !options.userPassword) {
        throw new Error('User password is required when --user-email is specified. Use --user-password or MCP_USER_PASSWORD.');
    }
}
