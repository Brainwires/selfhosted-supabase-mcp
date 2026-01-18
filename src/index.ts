/**
 * Self-Hosted Supabase MCP Server
 * Main entry point - coordinates initialization and transport setup.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { SelfhostedSupabaseClient } from './client/index.js';
import { HttpMcpServer } from './server/http-server.js';
import { parseCliOptions, validateCliOptions, type CliOptions } from './config/cli.js';
import { loadSecurityConfig, filterTools } from './config/security.js';
import { availableTools, buildCapabilities, getAvailableToolNames, type AppTool } from './tools/registry.js';
import type { ToolContext, AuthContext } from './tools/types.js';
import { AuditLogger } from './audit-logger.js';
import { ServerAuthManager } from './auth/index.js';

async function main() {
    const options = parseCliOptions();

    try {
        validateCliOptions(options);
    } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
    }

    console.error(`Initializing Self-Hosted Supabase MCP Server (transport: ${options.transport})...`);

    // Initialize audit logger
    const auditLogger = new AuditLogger({
        enabled: options.audit,
        logFile: options.auditLog,
        logToStderr: true,
    });

    if (options.audit) {
        console.error(`Audit logging enabled${options.auditLog ? ` (also writing to ${options.auditLog})` : ''}`);
    }

    try {
        // Initialize Supabase client
        const selfhostedClient = await SelfhostedSupabaseClient.create({
            supabaseUrl: options.url,
            supabaseAnonKey: options.anonKey,
            supabaseServiceRoleKey: options.serviceKey,
            databaseUrl: options.dbUrl,
            jwtSecret: options.jwtSecret,
        });
        console.error('Supabase client initialized successfully.');

        // Initialize server authentication (auto-managed user account)
        const serverAuth = new ServerAuthManager({
            userEmail: options.userEmail,
            userPassword: options.userPassword,
            serviceRoleKey: options.serviceKey,
        });

        const authState = await serverAuth.initialize(selfhostedClient.supabase);
        if (!authState.isAuthenticated) {
            console.error(`WARNING: Server authentication failed: ${authState.error}`);
            console.error('Tools will operate without a logged-in user identity.');
        }

        // Build server auth context from the logged-in session
        const serverAuthContext: AuthContext | undefined = authState.session ? {
            userId: authState.session.userId,
            email: authState.session.email,
            role: 'authenticated',
            sessionId: undefined, // Server doesn't track session ID the same way
            accessToken: authState.session.accessToken,
            expiresAt: authState.session.expiresAt,
            appMetadata: undefined,
            userMetadata: undefined,
        } : undefined;

        // Load security configuration and filter tools
        const securityConfig = loadSecurityConfig(
            options.securityProfile,
            options.toolsConfig,
            getAvailableToolNames()
        );
        console.error(`Security profile: ${securityConfig.profile}`);

        const registeredTools = filterTools(availableTools, securityConfig);
        const capabilities = buildCapabilities(registeredTools);

        // Create MCP server factory (for HTTP mode, each session gets its own server)
        const createMcpServer = () => {
            const server = new Server(
                { name: 'self-hosted-supabase-mcp', version: '1.0.0' },
                { capabilities }
            );

            setupRequestHandlers(server, registeredTools, selfhostedClient, options, auditLogger, serverAuthContext);
            return server;
        };

        // Start appropriate transport
        if (options.transport === 'http') {
            await startHttpTransport(options, createMcpServer, serverAuth);
        } else {
            await startStdioTransport(createMcpServer(), serverAuth);
        }

    } catch (error) {
        console.error('Failed to initialize MCP server:', error);
        process.exit(1);
    }
}

/**
 * Sets up request handlers on an MCP server instance.
 */
function setupRequestHandlers(
    server: Server,
    registeredTools: Record<string, AppTool>,
    selfhostedClient: SelfhostedSupabaseClient,
    options: CliOptions,
    auditLogger: AuditLogger,
    serverAuthContext?: AuthContext
): void {
    // List tools handler
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: Object.values(buildCapabilities(registeredTools).tools),
    }));

    // Call tool handler
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        const toolName = request.params.name;
        const tool = registeredTools[toolName];

        if (!tool) {
            if (availableTools[toolName]) {
                auditLogger.logBlocked(toolName, 'Tool disabled by security profile', request.params.arguments as Record<string, unknown>);
                throw new McpError(ErrorCode.MethodNotFound, `Tool "${toolName}" is disabled by the current security profile.`);
            }
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
        }

        try {
            let parsedArgs = request.params.arguments;
            if (tool.inputSchema && typeof tool.inputSchema.parse === 'function') {
                parsedArgs = (tool.inputSchema as z.ZodTypeAny).parse(request.params.arguments);
            }

            // Determine auth context:
            // 1. HTTP mode may provide per-request authContext via MCP SDK's authInfo
            // 2. Otherwise, use the server's auto-managed user identity
            const httpAuthContext = extra.authInfo?.extra?.authContext as ToolContext['authContext'] | undefined;
            const authContext = httpAuthContext ?? serverAuthContext;

            const context: ToolContext = {
                selfhostedClient,
                workspacePath: options.workspacePath,
                authContext, // Pass auth context to tools for RLS enforcement
                log: (message, level = 'info') => {
                    console.error(`[${level.toUpperCase()}] ${message}`);
                    if (level === 'warn' || level === 'error') {
                        auditLogger.logSecurityEvent(toolName, 'log', { message, level });
                    }
                },
            };

            const result = await tool.execute(parsedArgs, context);
            auditLogger.logToolExecution(toolName, parsedArgs as Record<string, unknown>, 'success');

            return {
                content: [{
                    type: 'text',
                    text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                }],
            };

        } catch (error: unknown) {
            console.error(`Error executing tool ${toolName}:`, error);

            let errorMessage = `Error executing tool ${toolName}: `;
            if (error instanceof z.ZodError) {
                errorMessage += `Input validation failed: ${error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`;
            } else if (error instanceof Error) {
                errorMessage += error.message;
            } else {
                errorMessage += String(error);
            }

            auditLogger.logToolExecution(toolName, request.params.arguments as Record<string, unknown>, 'failure', errorMessage);

            return {
                content: [{ type: 'text', text: errorMessage }],
                isError: true,
            };
        }
    });
}

/**
 * Starts the server with stdio transport.
 */
async function startStdioTransport(server: Server, serverAuth: ServerAuthManager): Promise<void> {
    console.error('Starting MCP Server in stdio mode...');
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('MCP Server connected to stdio.');

    // Cleanup on exit
    process.on('exit', () => {
        serverAuth.cleanup();
    });
}

/**
 * Starts the server with HTTP transport.
 */
async function startHttpTransport(
    options: CliOptions,
    mcpServerFactory: () => Server,
    serverAuth: ServerAuthManager
): Promise<void> {
    console.error(`Starting MCP Server in HTTP mode on ${options.host}:${options.port}...`);

    const httpServer = new HttpMcpServer(
        {
            port: options.port,
            host: options.host,
            jwtSecret: options.jwtSecret!,
        },
        mcpServerFactory
    );

    await httpServer.start();

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.error('Shutting down...');
        serverAuth.cleanup();
        await httpServer.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.error('Shutting down...');
        serverAuth.cleanup();
        await httpServer.stop();
        process.exit(0);
    });
}

main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
});
