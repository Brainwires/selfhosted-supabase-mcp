/**
 * Server Auth Manager - Handles automatic authentication for the MCP server.
 * On startup: loads saved credentials OR creates a new account, then logs in.
 * The server operates as this logged-in user identity for all tool operations.
 */

import type { SupabaseClient, Session } from '@supabase/supabase-js';
import { CredentialManager, type StoredCredentials, type SessionTokens } from './credential-manager.js';

export interface ServerAuthManagerOptions {
    /** Override with explicit user email (skips auto-managed account) */
    userEmail?: string;
    /** Password for the explicit user account */
    userPassword?: string;
    /** Service role key for account creation with auto-confirm */
    serviceRoleKey?: string;
}

export interface AuthState {
    /** Whether the server is authenticated */
    isAuthenticated: boolean;
    /** Current session tokens (if authenticated) */
    session: SessionTokens | null;
    /** Whether using an explicit user override vs auto-managed */
    isExplicitUser: boolean;
    /** Error message if authentication failed */
    error?: string;
}

/**
 * Manages server-level authentication.
 * Automatically handles credential persistence, account creation, and login.
 */
export class ServerAuthManager {
    private readonly credentialManager: CredentialManager;
    private readonly options: ServerAuthManagerOptions;
    private authState: AuthState = {
        isAuthenticated: false,
        session: null,
        isExplicitUser: false,
    };
    private refreshTimer: NodeJS.Timeout | null = null;

    constructor(options: ServerAuthManagerOptions = {}) {
        this.options = options;
        this.credentialManager = new CredentialManager();
    }

    /**
     * Initializes authentication - call this on server startup.
     * Handles the full flow: load/create credentials → login → persist.
     */
    async initialize(supabase: SupabaseClient): Promise<AuthState> {
        console.error('[ServerAuth] Initializing server authentication...');

        try {
            // Determine credentials to use
            const credentials = await this.resolveCredentials(supabase);
            if (!credentials) {
                this.authState = {
                    isAuthenticated: false,
                    session: null,
                    isExplicitUser: !!this.options.userEmail,
                    error: 'Failed to resolve user credentials',
                };
                return this.authState;
            }

            // Login with the credentials
            const session = await this.login(supabase, credentials);
            if (!session) {
                this.authState = {
                    isAuthenticated: false,
                    session: null,
                    isExplicitUser: !!this.options.userEmail,
                    error: 'Login failed',
                };
                return this.authState;
            }

            this.authState = {
                isAuthenticated: true,
                session,
                isExplicitUser: !!this.options.userEmail,
            };

            // Setup token refresh
            this.setupTokenRefresh(supabase, credentials);

            console.error(`[ServerAuth] Authenticated as ${session.email} (${session.userId})`);
            return this.authState;

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error('[ServerAuth] Authentication failed:', errorMsg);
            this.authState = {
                isAuthenticated: false,
                session: null,
                isExplicitUser: !!this.options.userEmail,
                error: errorMsg,
            };
            return this.authState;
        }
    }

    /**
     * Gets the current authentication state.
     */
    getAuthState(): AuthState {
        return this.authState;
    }

    /**
     * Gets the current session tokens (if authenticated).
     */
    getSession(): SessionTokens | null {
        return this.authState.session;
    }

    /**
     * Checks if the server is authenticated.
     */
    isAuthenticated(): boolean {
        return this.authState.isAuthenticated;
    }

    /**
     * Cleans up resources (stops refresh timer).
     */
    cleanup(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    /**
     * Resolves credentials: uses explicit override, loads from disk, or creates new.
     */
    private async resolveCredentials(supabase: SupabaseClient): Promise<StoredCredentials | null> {
        // 1. Check for explicit user override
        if (this.options.userEmail && this.options.userPassword) {
            console.error(`[ServerAuth] Using explicit user account: ${this.options.userEmail}`);
            return {
                email: this.options.userEmail,
                password: this.options.userPassword,
                createdAt: new Date().toISOString(),
            };
        }

        // 2. Check for stored credentials
        const stored = this.credentialManager.loadCredentials();
        if (stored) {
            console.error(`[ServerAuth] Loaded stored credentials for: ${stored.email}`);
            return stored;
        }

        // 3. Create new auto-managed account
        console.error('[ServerAuth] No stored credentials found, creating new MCP user account...');
        return this.createAutoManagedAccount(supabase);
    }

    /**
     * Creates a new auto-managed user account and persists credentials.
     */
    private async createAutoManagedAccount(supabase: SupabaseClient): Promise<StoredCredentials | null> {
        const email = CredentialManager.generateEmail();
        const password = CredentialManager.generatePassword();

        console.error(`[ServerAuth] Creating account: ${email}`);

        try {
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
            });

            if (error) {
                console.error(`[ServerAuth] Signup failed: ${error.message}`);
                return null;
            }

            if (!data.user) {
                console.error('[ServerAuth] Signup succeeded but no user returned');
                return null;
            }

            // Auto-confirm if we have service role key
            if (this.options.serviceRoleKey) {
                try {
                    const { error: confirmError } = await supabase.auth.admin.updateUserById(
                        data.user.id,
                        { email_confirm: true }
                    );
                    if (confirmError) {
                        console.error(`[ServerAuth] Auto-confirm failed: ${confirmError.message}`);
                        // Continue anyway - might work without confirmation in dev
                    } else {
                        console.error('[ServerAuth] Email auto-confirmed');
                    }
                } catch (err) {
                    console.error('[ServerAuth] Auto-confirm exception:', err);
                }
            }

            const credentials: StoredCredentials = {
                email,
                password,
                userId: data.user.id,
                createdAt: new Date().toISOString(),
            };

            // Persist credentials
            this.credentialManager.saveCredentials(credentials);
            console.error(`[ServerAuth] Account created and credentials saved: ${email}`);

            return credentials;

        } catch (error) {
            console.error('[ServerAuth] Account creation failed:', error);
            return null;
        }
    }

    /**
     * Logs in with the given credentials and returns session tokens.
     */
    private async login(supabase: SupabaseClient, credentials: StoredCredentials): Promise<SessionTokens | null> {
        console.error(`[ServerAuth] Logging in as ${credentials.email}...`);

        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email: credentials.email,
                password: credentials.password,
            });

            if (error) {
                console.error(`[ServerAuth] Login failed: ${error.message}`);

                // If login fails for auto-managed account, might need to recreate
                if (!this.options.userEmail) {
                    console.error('[ServerAuth] Auto-managed account login failed, credentials may be stale');
                    // Delete stale credentials so next startup creates fresh account
                    this.credentialManager.deleteCredentials();
                }
                return null;
            }

            if (!data.session) {
                console.error('[ServerAuth] Login succeeded but no session returned');
                return null;
            }

            return this.sessionToTokens(data.session, data.user?.id, data.user?.email);

        } catch (error) {
            console.error('[ServerAuth] Login exception:', error);
            return null;
        }
    }

    /**
     * Converts Supabase Session to our SessionTokens format.
     */
    private sessionToTokens(session: Session, userId?: string, email?: string | null): SessionTokens {
        return {
            accessToken: session.access_token,
            refreshToken: session.refresh_token,
            expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
            userId: userId ?? session.user?.id ?? '',
            email: email ?? session.user?.email ?? '',
        };
    }

    /**
     * Sets up automatic token refresh before expiry.
     */
    private setupTokenRefresh(supabase: SupabaseClient, credentials: StoredCredentials): void {
        if (!this.authState.session) return;

        const expiresAt = this.authState.session.expiresAt;
        const now = Math.floor(Date.now() / 1000);
        const timeUntilExpiry = expiresAt - now;

        // Refresh 5 minutes before expiry (or immediately if already close)
        const refreshIn = Math.max((timeUntilExpiry - 300) * 1000, 60000);

        console.error(`[ServerAuth] Token refresh scheduled in ${Math.round(refreshIn / 1000)}s`);

        this.refreshTimer = setTimeout(async () => {
            console.error('[ServerAuth] Refreshing token...');

            // Try to refresh using the refresh token
            try {
                const { data, error } = await supabase.auth.refreshSession();

                if (error || !data.session) {
                    console.error('[ServerAuth] Token refresh failed, re-logging in...');
                    // Fallback: re-login with credentials
                    const session = await this.login(supabase, credentials);
                    if (session) {
                        this.authState.session = session;
                        this.setupTokenRefresh(supabase, credentials);
                    }
                } else {
                    this.authState.session = this.sessionToTokens(data.session, data.user?.id, data.user?.email);
                    this.setupTokenRefresh(supabase, credentials);
                    console.error('[ServerAuth] Token refreshed successfully');
                }
            } catch (err) {
                console.error('[ServerAuth] Token refresh exception:', err);
            }
        }, refreshIn);

        // Prevent timer from keeping process alive
        this.refreshTimer.unref();
    }
}
