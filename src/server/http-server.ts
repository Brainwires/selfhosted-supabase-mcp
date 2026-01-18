import { randomUUID } from 'node:crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { AuthMiddleware, AuthenticationError } from './auth-middleware.js';
import { SessionManager, SessionLimitError } from './session-manager.js';
import type { AuthContext } from '../tools/types.js';

/**
 * Extended Express request with auth context and MCP SDK auth info.
 */
interface AuthenticatedRequest extends Request {
    authContext?: AuthContext;
    /** MCP SDK's auth info field - set by middleware for SDK to pass to handlers */
    auth?: AuthInfo;
}

/**
 * Options for creating the HTTP MCP server.
 */
export interface HttpMcpServerOptions {
    /** Port to listen on */
    port: number;
    /** JWT secret for validating Supabase tokens */
    jwtSecret: string;
    /** Host to bind to (default: '127.0.0.1') */
    host?: string;
    /** Optional allowed hosts for DNS rebinding protection */
    allowedHosts?: string[];
}

/**
 * HTTP MCP Server with Supabase JWT authentication.
 *
 * Clients must authenticate with Supabase and pass their JWT in the
 * Authorization header. All operations run as the authenticated user.
 */
export class HttpMcpServer {
    private app: Express;
    private httpServer: ReturnType<Express['listen']> | null = null;
    private authMiddleware: AuthMiddleware;
    private sessionManager: SessionManager;
    private transports: Map<string, StreamableHTTPServerTransport> = new Map();

    /** Callback to create MCP server instance for new sessions */
    private mcpServerFactory: () => Server;

    /** Store auth context by session ID for tool execution */
    private sessionAuthContexts: Map<string, AuthContext> = new Map();

    private options: HttpMcpServerOptions;

    constructor(options: HttpMcpServerOptions, mcpServerFactory: () => Server) {
        this.options = options;
        this.mcpServerFactory = mcpServerFactory;
        this.authMiddleware = new AuthMiddleware(options.jwtSecret);
        this.sessionManager = new SessionManager();

        // Create Express app with MCP SDK's helper
        this.app = createMcpExpressApp({
            host: options.host ?? '127.0.0.1',
            allowedHosts: options.allowedHosts,
        });

        this.setupRoutes();
    }

    /**
     * Gets the auth context for a given MCP session ID.
     * Used by tool execution to determine the current user.
     */
    getAuthContextForSession(sessionId: string): AuthContext | undefined {
        return this.sessionAuthContexts.get(sessionId);
    }

    /**
     * Gets the session manager for external access.
     */
    getSessionManager(): SessionManager {
        return this.sessionManager;
    }

    /**
     * Express middleware for JWT authentication.
     * Sets both our custom authContext and the MCP SDK's auth field.
     */
    private authMiddlewareHandler = (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction
    ): void => {
        try {
            const authContext = this.authMiddleware.validateToken(req.headers.authorization);
            req.authContext = authContext;

            // Set MCP SDK's auth field so it's passed to request handlers via extra.authInfo
            // We store the full AuthContext in the 'extra' field for tools to access
            req.auth = {
                token: authContext.accessToken,
                clientId: authContext.userId,
                scopes: [authContext.role],
                expiresAt: authContext.expiresAt,
                extra: {
                    // Store the full AuthContext for tool execution
                    authContext: authContext,
                },
            };

            next();
        } catch (error) {
            if (error instanceof AuthenticationError) {
                res.status(401).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32001,
                        message: error.message,
                    },
                    id: null,
                });
                return;
            }
            console.error('[HttpMcpServer] Unexpected auth error:', error);
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: 'Internal server error',
                },
                id: null,
            });
        }
    };

    /**
     * Sets up Express routes for MCP protocol.
     */
    private setupRoutes(): void {
        // Apply auth middleware to all /mcp routes
        this.app.use('/mcp', this.authMiddlewareHandler);

        // POST /mcp - Main MCP endpoint for requests
        this.app.post('/mcp', this.handleMcpPost.bind(this));

        // GET /mcp - SSE stream for server-to-client messages
        this.app.get('/mcp', this.handleMcpGet.bind(this));

        // DELETE /mcp - Session termination
        this.app.delete('/mcp', this.handleMcpDelete.bind(this));

        // Health check endpoint (no auth required)
        this.app.get('/health', (_req, res) => {
            res.json({
                status: 'ok',
                activeSessions: this.sessionManager.getActiveSessionCount(),
            });
        });
    }

    /**
     * Handles POST requests (MCP JSON-RPC requests).
     */
    private async handleMcpPost(req: AuthenticatedRequest, res: Response): Promise<void> {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        const authContext = req.authContext!;

        try {
            let transport: StreamableHTTPServerTransport;

            if (sessionId && this.transports.has(sessionId)) {
                // Reuse existing transport
                transport = this.transports.get(sessionId)!;

                // Update auth context (client may have refreshed token)
                this.sessionAuthContexts.set(sessionId, authContext);
                this.sessionManager.updateSessionAuth(sessionId, authContext);

            } else if (!sessionId && isInitializeRequest(req.body)) {
                // New initialization request - create new transport
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    onsessioninitialized: (newSessionId) => {
                        console.error(`[HttpMcpServer] Session initialized: ${newSessionId} (user: ${authContext.userId})`);
                        this.transports.set(newSessionId, transport);
                        this.sessionAuthContexts.set(newSessionId, authContext);
                        this.sessionManager.createSession(newSessionId, authContext);
                    },
                });

                // Set up cleanup on transport close
                transport.onclose = () => {
                    const sid = transport.sessionId;
                    if (sid) {
                        console.error(`[HttpMcpServer] Transport closed for session: ${sid}`);
                        this.transports.delete(sid);
                        this.sessionAuthContexts.delete(sid);
                        this.sessionManager.removeSession(sid);
                    }
                };

                // Create and connect MCP server instance
                const mcpServer = this.mcpServerFactory();
                await mcpServer.connect(transport);

                // Handle the initialization request
                await transport.handleRequest(req, res, req.body);
                return;

            } else {
                // Invalid request
                res.status(400).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32000,
                        message: 'Bad Request: Missing or invalid session ID',
                    },
                    id: null,
                });
                return;
            }

            // Handle the request with existing transport
            await transport.handleRequest(req, res, req.body);

        } catch (error) {
            console.error('[HttpMcpServer] Error handling POST request:', error);
            if (!res.headersSent) {
                // Handle session limit errors with 429 Too Many Requests
                if (error instanceof SessionLimitError) {
                    res.status(429).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32002,
                            message: error.message,
                        },
                        id: null,
                    });
                    return;
                }

                res.status(500).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: 'Internal server error',
                    },
                    id: null,
                });
            }
        }
    }

    /**
     * Handles GET requests (SSE stream for server messages).
     */
    private async handleMcpGet(req: AuthenticatedRequest, res: Response): Promise<void> {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        const authContext = req.authContext!;

        if (!sessionId || !this.transports.has(sessionId)) {
            res.status(400).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Invalid or missing session ID',
                },
                id: null,
            });
            return;
        }

        // Verify session belongs to this user
        const session = this.sessionManager.getSession(sessionId);
        if (session && session.authContext.userId !== authContext.userId) {
            res.status(403).json({
                jsonrpc: '2.0',
                error: {
                    code: -32003,
                    message: 'Session belongs to different user',
                },
                id: null,
            });
            return;
        }

        const lastEventId = req.headers['last-event-id'];
        if (lastEventId) {
            console.error(`[HttpMcpServer] Client reconnecting with Last-Event-ID: ${lastEventId}`);
        }

        const transport = this.transports.get(sessionId)!;
        await transport.handleRequest(req, res);
    }

    /**
     * Handles DELETE requests (session termination).
     */
    private async handleMcpDelete(req: AuthenticatedRequest, res: Response): Promise<void> {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        const authContext = req.authContext!;

        if (!sessionId || !this.transports.has(sessionId)) {
            res.status(400).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Invalid or missing session ID',
                },
                id: null,
            });
            return;
        }

        // Verify session belongs to this user
        const session = this.sessionManager.getSession(sessionId);
        if (session && session.authContext.userId !== authContext.userId) {
            res.status(403).json({
                jsonrpc: '2.0',
                error: {
                    code: -32003,
                    message: 'Cannot terminate session belonging to different user',
                },
                id: null,
            });
            return;
        }

        console.error(`[HttpMcpServer] Session termination requested: ${sessionId}`);

        try {
            const transport = this.transports.get(sessionId)!;
            await transport.handleRequest(req, res);
        } catch (error) {
            console.error('[HttpMcpServer] Error handling DELETE request:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: 'Error processing session termination',
                    },
                    id: null,
                });
            }
        }
    }

    /**
     * Starts the HTTP server.
     */
    async start(): Promise<void> {
        const { port, host = '127.0.0.1' } = this.options;

        return new Promise((resolve, reject) => {
            this.httpServer = this.app.listen(port, host, () => {
                console.error(`[HttpMcpServer] Listening on ${host}:${port}`);
                console.error(`[HttpMcpServer] MCP endpoint: http://${host}:${port}/mcp`);
                console.error(`[HttpMcpServer] Health check: http://${host}:${port}/health`);
                resolve();
            });

            this.httpServer.on('error', (error) => {
                console.error('[HttpMcpServer] Failed to start:', error);
                reject(error);
            });
        });
    }

    /**
     * Stops the HTTP server and cleans up all sessions.
     */
    async stop(): Promise<void> {
        console.error('[HttpMcpServer] Shutting down...');

        // Close all transports
        for (const [sessionId, transport] of this.transports.entries()) {
            try {
                console.error(`[HttpMcpServer] Closing transport for session: ${sessionId}`);
                await transport.close();
            } catch (error) {
                console.error(`[HttpMcpServer] Error closing transport ${sessionId}:`, error);
            }
        }
        this.transports.clear();
        this.sessionAuthContexts.clear();

        // Close session manager
        this.sessionManager.close();

        // Close HTTP server
        if (this.httpServer) {
            return new Promise((resolve) => {
                this.httpServer!.close(() => {
                    console.error('[HttpMcpServer] Shutdown complete');
                    resolve();
                });
            });
        }
    }
}
