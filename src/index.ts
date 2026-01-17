import { Command } from 'commander';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { SelfhostedSupabaseClient } from './client/index.js';
import { listTablesTool } from './tools/list_tables.js';
import { listExtensionsTool } from './tools/list_extensions.js';
import { listMigrationsTool } from './tools/list_migrations.js';
import { applyMigrationTool } from './tools/apply_migration.js';
import { executeSqlTool } from './tools/execute_sql.js';
import { getDatabaseConnectionsTool } from './tools/get_database_connections.js';
import { getDatabaseStatsTool } from './tools/get_database_stats.js';
import { getProjectUrlTool } from './tools/get_project_url.js';
import { getAnonKeyTool } from './tools/get_anon_key.js';
import { getServiceKeyTool } from './tools/get_service_key.js';
import { generateTypesTool } from './tools/generate_typescript_types.js';
import { rebuildHooksTool } from './tools/rebuild_hooks.js';
import { verifyJwtSecretTool } from './tools/verify_jwt_secret.js';
import { listAuthUsersTool } from './tools/list_auth_users.js';
import { getAuthUserTool } from './tools/get_auth_user.js';
import { deleteAuthUserTool } from './tools/delete_auth_user.js';
import { createAuthUserTool } from './tools/create_auth_user.js';
import { updateAuthUserTool } from './tools/update_auth_user.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolContext } from './tools/types.js';
import listStorageBucketsTool from './tools/list_storage_buckets.js';
import listStorageObjectsTool from './tools/list_storage_objects.js';
import listRealtimePublicationsTool from './tools/list_realtime_publications.js';
import { getProfileTools, isValidProfile, getProfileDescriptions, type SecurityProfile } from './security-profiles.js';
import { AuditLogger } from './audit-logger.js';

// Node.js built-in modules
import * as fs from 'node:fs';
import * as path from 'node:path';

// Define the structure expected by MCP for tool definitions
interface McpToolSchema {
    name: string;
    description?: string;
    // inputSchema is the JSON Schema object for MCP capabilities
    inputSchema: object; 
}

// Base structure for our tool objects - For Reference
interface AppTool {
    name: string;
    description: string;
    inputSchema: z.ZodTypeAny; // Zod schema for parsing
    mcpInputSchema: object;    // Static JSON schema for MCP (Required)
    outputSchema: z.ZodTypeAny; // Zod schema for output (optional)
    execute: (input: unknown, context: ToolContext) => Promise<unknown>;
}

// Main function
async function main() {
    const program = new Command();

    program
        .name('self-hosted-supabase-mcp')
        .description('MCP Server for self-hosted Supabase instances')
        .option('--url <url>', 'Supabase project URL', process.env.SUPABASE_URL)
        .option('--anon-key <key>', 'Supabase anonymous key', process.env.SUPABASE_ANON_KEY)
        .option('--service-key <key>', 'Supabase service role key (optional)', process.env.SUPABASE_SERVICE_ROLE_KEY)
        .option('--db-url <url>', 'Direct database connection string (optional, for pg fallback)', process.env.DATABASE_URL)
        .option('--jwt-secret <secret>', 'Supabase JWT secret (optional, needed for some tools)', process.env.SUPABASE_AUTH_JWT_SECRET)
        .option('--workspace-path <path>', 'Workspace root path (for file operations)', process.cwd())
        .option('--security-profile <profile>', 'Security profile: readonly, standard, admin, or custom (default: admin)', process.env.MCP_SECURITY_PROFILE || 'admin')
        .option('--tools-config <path>', 'Path to a JSON file specifying which tools to enable. Required when using --security-profile custom.')
        .option('--audit-log <path>', 'Path to write audit logs (in addition to stderr)')
        .option('--no-audit', 'Disable audit logging')
        .addHelpText('after', `\n${getProfileDescriptions()}`)
        .parse(process.argv);

    const options = program.opts();

    if (!options.url) {
        console.error('Error: Supabase URL is required. Use --url or SUPABASE_URL.');
        throw new Error('Supabase URL is required.');
    }
    if (!options.anonKey) {
        console.error('Error: Supabase Anon Key is required. Use --anon-key or SUPABASE_ANON_KEY.');
        throw new Error('Supabase Anon Key is required.');
    }

    console.error('Initializing Self-Hosted Supabase MCP Server...');

    // Initialize audit logger
    const auditLogger = new AuditLogger({
        enabled: options.audit !== false, // --no-audit sets this to false
        logFile: options.auditLog as string | undefined,
        logToStderr: true,
    });

    if (options.audit !== false) {
        console.error(`Audit logging enabled${options.auditLog ? ` (also writing to ${options.auditLog})` : ''}`);
    } else {
        console.error('Audit logging disabled');
    }

    try {
        const selfhostedClient = await SelfhostedSupabaseClient.create({
            supabaseUrl: options.url,
            supabaseAnonKey: options.anonKey,
            supabaseServiceRoleKey: options.serviceKey,
            databaseUrl: options.dbUrl,
            jwtSecret: options.jwtSecret,
        });

        console.error('Supabase client initialized successfully.');

        const availableTools = {
            // Cast here assumes tools will implement AppTool structure
            [listTablesTool.name]: listTablesTool as AppTool,
            [listExtensionsTool.name]: listExtensionsTool as AppTool,
            [listMigrationsTool.name]: listMigrationsTool as AppTool,
            [applyMigrationTool.name]: applyMigrationTool as AppTool,
            [executeSqlTool.name]: executeSqlTool as AppTool,
            [getDatabaseConnectionsTool.name]: getDatabaseConnectionsTool as AppTool,
            [getDatabaseStatsTool.name]: getDatabaseStatsTool as AppTool,
            [getProjectUrlTool.name]: getProjectUrlTool as AppTool,
            [getAnonKeyTool.name]: getAnonKeyTool as AppTool,
            [getServiceKeyTool.name]: getServiceKeyTool as AppTool,
            [generateTypesTool.name]: generateTypesTool as AppTool,
            [rebuildHooksTool.name]: rebuildHooksTool as AppTool,
            [verifyJwtSecretTool.name]: verifyJwtSecretTool as AppTool,
            [listAuthUsersTool.name]: listAuthUsersTool as AppTool,
            [getAuthUserTool.name]: getAuthUserTool as AppTool,
            [deleteAuthUserTool.name]: deleteAuthUserTool as AppTool,
            [createAuthUserTool.name]: createAuthUserTool as AppTool,
            [updateAuthUserTool.name]: updateAuthUserTool as AppTool,
            [listStorageBucketsTool.name]: listStorageBucketsTool as AppTool,
            [listStorageObjectsTool.name]: listStorageObjectsTool as AppTool,
            [listRealtimePublicationsTool.name]: listRealtimePublicationsTool as AppTool,
        };

        // --- Security Profile & Tool Filtering Logic ---
        let registeredTools: Record<string, AppTool> = { ...availableTools }; // Start with all tools
        const toolsConfigPath = options.toolsConfig as string | undefined;
        const securityProfile = (options.securityProfile as string) || 'admin';
        let enabledToolNames: Set<string> | null = null; // Use Set for efficient lookup

        // Validate security profile
        if (!isValidProfile(securityProfile)) {
            console.error(`Error: Invalid security profile '${securityProfile}'. Valid options: readonly, standard, admin, custom`);
            throw new Error(`Invalid security profile: ${securityProfile}`);
        }

        console.error(`Security profile: ${securityProfile}`);

        // Get tool whitelist based on profile or config file
        if (securityProfile === 'custom') {
            // Custom profile requires tools-config file
            if (!toolsConfigPath) {
                console.error('Error: --tools-config is required when using --security-profile custom');
                throw new Error('--tools-config is required when using --security-profile custom');
            }

            try {
                const resolvedPath = path.resolve(toolsConfigPath);
                console.error(`Loading custom tool configuration from: ${resolvedPath}`);
                if (!fs.existsSync(resolvedPath)) {
                    throw new Error(`Tool configuration file not found at ${resolvedPath}`);
                }
                const configFileContent = fs.readFileSync(resolvedPath, 'utf-8');
                const configJson = JSON.parse(configFileContent);

                if (!configJson || typeof configJson !== 'object' || !Array.isArray(configJson.enabledTools)) {
                    throw new Error('Invalid config file format. Expected { "enabledTools": ["tool1", ...] }.');
                }

                const toolNames = configJson.enabledTools as unknown[];
                if (!toolNames.every((name): name is string => typeof name === 'string')) {
                    throw new Error('Invalid config file content. "enabledTools" must be an array of strings.');
                }

                enabledToolNames = new Set(toolNames.map(name => name.trim()).filter(name => name.length > 0));
            } catch (error: unknown) {
                console.error(`Error loading tool config file '${toolsConfigPath}':`, error instanceof Error ? error.message : String(error));
                throw error; // Don't fall back for custom profile - explicit config is required
            }
        } else {
            // Use predefined security profile
            const profileTools = getProfileTools(securityProfile as SecurityProfile);
            if (profileTools) {
                enabledToolNames = new Set(profileTools);
            }
        }

        // Apply tool filtering
        if (enabledToolNames !== null) {
            console.error(`Enabled tools (${enabledToolNames.size}): ${Array.from(enabledToolNames).join(', ')}`);

            registeredTools = {};
            for (const toolName in availableTools) {
                if (enabledToolNames.has(toolName)) {
                    registeredTools[toolName] = availableTools[toolName];
                } else {
                    console.error(`Tool ${toolName} disabled by security profile.`);
                }
            }

            // Warn about any tools in config that don't exist
            for (const requestedName of enabledToolNames) {
                if (!availableTools[requestedName]) {
                    console.warn(`Warning: Tool "${requestedName}" specified but not found in available tools.`);
                }
            }
        } else {
            console.error('All tools enabled (admin profile or no filtering applied).');
        }
        // --- End Security Profile & Tool Filtering Logic ---

        // Prepare capabilities for the Server constructor
        const capabilitiesTools: Record<string, McpToolSchema> = {};
        // Use the potentially filtered 'registeredTools' map
        for (const tool of Object.values(registeredTools)) {
            // Directly use mcpInputSchema - assumes it exists and is correct
            const staticInputSchema = tool.mcpInputSchema || { type: 'object', properties: {} };

            if (!tool.mcpInputSchema) { // Simple check if it was actually provided
                 console.error(`Tool ${tool.name} is missing mcpInputSchema. Using default empty schema.`);
            }

            capabilitiesTools[tool.name] = {
                name: tool.name,
                description: tool.description || 'Tool description missing',
                inputSchema: staticInputSchema,
            };
        }

        const capabilities = { tools: capabilitiesTools };

        console.error('Initializing MCP Server...');
        const server = new Server(
            {
                name: 'self-hosted-supabase-mcp',
                version: '1.0.0',
            },
            {
                capabilities,
            },
        );

        // The ListTools handler should return the array matching McpToolSchema structure
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: Object.values(capabilities.tools),
        }));

        server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const toolName = request.params.name;
            // Look up the tool in the filtered 'registeredTools' map
            const tool = registeredTools[toolName as keyof typeof registeredTools];

            if (!tool) {
                // Check if it existed originally but was filtered out
                if (availableTools[toolName as keyof typeof availableTools]) {
                    auditLogger.logBlocked(toolName, 'Tool disabled by security profile', request.params.arguments as Record<string, unknown>);
                    throw new McpError(ErrorCode.MethodNotFound, `Tool "${toolName}" is available but not enabled by the current server configuration.`);
                }
                // If the tool wasn't in the original list either, it's unknown
                throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
            }

            try {
                if (typeof tool.execute !== 'function') {
                    throw new Error(`Tool ${toolName} does not have an execute method.`);
                }

                let parsedArgs = request.params.arguments;
                // Still use Zod schema for internal validation before execution
                if (tool.inputSchema && typeof tool.inputSchema.parse === 'function') {
                    parsedArgs = (tool.inputSchema as z.ZodTypeAny).parse(request.params.arguments);
                }

                // Create the context object using the imported type
                const context: ToolContext = {
                    selfhostedClient,
                    workspacePath: options.workspacePath as string,
                    log: (message, level = 'info') => {
                        // Simple logger using console.error (consistent with existing logs)
                        console.error(`[${level.toUpperCase()}] ${message}`);
                        // Also log security-relevant messages to audit
                        if (level === 'warn' || level === 'error') {
                            auditLogger.logSecurityEvent(toolName, 'log', { message, level });
                        }
                    }
                };

                // Call the tool's execute method
                // biome-ignore lint/suspicious/noExplicitAny: <explanation>
                const result = await tool.execute(parsedArgs as any, context);

                // Log successful execution
                auditLogger.logToolExecution(toolName, parsedArgs as Record<string, unknown>, 'success');

                return {
                    content: [
                        {
                            type: 'text',
                            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                        },
                    ],
                };
            } catch (error: unknown) {
                console.error(`Error executing tool ${toolName}:`, error);
                let errorMessage = `Error executing tool ${toolName}: `;
                if (error instanceof z.ZodError) {
                    errorMessage += `Input validation failed: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`;
                } else if (error instanceof Error) {
                    errorMessage += error.message;
                } else {
                    errorMessage += String(error);
                }

                // Log failed execution
                auditLogger.logToolExecution(
                    toolName,
                    request.params.arguments as Record<string, unknown>,
                    'failure',
                    errorMessage
                );

                return {
                    content: [{ type: 'text', text: errorMessage }],
                    isError: true,
                };
            }
        });

        console.error('Starting MCP Server in stdio mode...');
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error('MCP Server connected to stdio.');

    } catch (error) {
        console.error('Failed to initialize or start the MCP server:', error);
        throw error; // Rethrow to ensure the process exits non-zero if init fails
    }
}

main().catch((error) => {
    console.error('Unhandled error in main function:', error);
    process.exit(1); // Exit with error code
});