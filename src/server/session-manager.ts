import type { AuthContext } from '../tools/types.js';

/**
 * Represents an authenticated client session.
 */
export interface ClientSession {
    /** MCP session ID (from transport) */
    sessionId: string;
    /** User's authentication context */
    authContext: AuthContext;
    /** When the session was created */
    connectedAt: Date;
    /** Last activity timestamp */
    lastActivityAt: Date;
}

/**
 * Manages authenticated client sessions for the HTTP MCP server.
 * Tracks active connections and handles session cleanup.
 */
export class SessionManager {
    private sessions: Map<string, ClientSession> = new Map();
    private cleanupInterval: NodeJS.Timeout | null = null;

    /** Session timeout in milliseconds (default: 30 minutes) */
    private readonly sessionTimeoutMs: number;

    /** Cleanup interval in milliseconds (default: 5 minutes) */
    private readonly cleanupIntervalMs: number;

    constructor(options?: { sessionTimeoutMs?: number; cleanupIntervalMs?: number }) {
        this.sessionTimeoutMs = options?.sessionTimeoutMs ?? 30 * 60 * 1000;
        this.cleanupIntervalMs = options?.cleanupIntervalMs ?? 5 * 60 * 1000;

        // Start periodic cleanup
        this.cleanupInterval = setInterval(
            () => this.cleanupStaleSessions(),
            this.cleanupIntervalMs
        );

        // Prevent cleanup interval from keeping the process alive
        this.cleanupInterval.unref();
    }

    /**
     * Creates a new session for a client connection.
     */
    createSession(mcpSessionId: string, authContext: AuthContext): ClientSession {
        const session: ClientSession = {
            sessionId: mcpSessionId,
            authContext,
            connectedAt: new Date(),
            lastActivityAt: new Date(),
        };
        this.sessions.set(mcpSessionId, session);
        console.error(`[SessionManager] Session created: ${mcpSessionId} (user: ${authContext.userId})`);
        return session;
    }

    /**
     * Gets a session by MCP session ID.
     * Updates last activity timestamp on access.
     */
    getSession(mcpSessionId: string): ClientSession | undefined {
        const session = this.sessions.get(mcpSessionId);
        if (session) {
            session.lastActivityAt = new Date();
        }
        return session;
    }

    /**
     * Updates the auth context for an existing session.
     * Used when a client sends a refreshed token.
     */
    updateSessionAuth(mcpSessionId: string, authContext: AuthContext): boolean {
        const session = this.sessions.get(mcpSessionId);
        if (session) {
            session.authContext = authContext;
            session.lastActivityAt = new Date();
            console.error(`[SessionManager] Session auth updated: ${mcpSessionId}`);
            return true;
        }
        return false;
    }

    /**
     * Removes a session when a client disconnects.
     */
    removeSession(mcpSessionId: string): boolean {
        const existed = this.sessions.delete(mcpSessionId);
        if (existed) {
            console.error(`[SessionManager] Session removed: ${mcpSessionId}`);
        }
        return existed;
    }

    /**
     * Gets all sessions for a specific user.
     */
    getSessionsByUserId(userId: string): ClientSession[] {
        return Array.from(this.sessions.values()).filter(
            (session) => session.authContext.userId === userId
        );
    }

    /**
     * Gets the count of active sessions.
     */
    getActiveSessionCount(): number {
        return this.sessions.size;
    }

    /**
     * Gets all active sessions (for monitoring/debugging).
     */
    getAllSessions(): ClientSession[] {
        return Array.from(this.sessions.values());
    }

    /**
     * Cleans up stale or expired sessions.
     */
    private cleanupStaleSessions(): void {
        const now = Date.now();
        let removedCount = 0;

        for (const [sessionId, session] of this.sessions.entries()) {
            const tokenExpired = session.authContext.expiresAt * 1000 < now;
            const sessionStale = now - session.lastActivityAt.getTime() > this.sessionTimeoutMs;

            if (tokenExpired || sessionStale) {
                this.sessions.delete(sessionId);
                removedCount++;
                console.error(
                    `[SessionManager] Session cleaned up: ${sessionId} ` +
                    `(expired: ${tokenExpired}, stale: ${sessionStale})`
                );
            }
        }

        if (removedCount > 0) {
            console.error(`[SessionManager] Cleanup complete: ${removedCount} sessions removed, ${this.sessions.size} active`);
        }
    }

    /**
     * Shuts down the session manager and clears all sessions.
     */
    close(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        const count = this.sessions.size;
        this.sessions.clear();
        console.error(`[SessionManager] Closed, cleared ${count} sessions`);
    }
}
