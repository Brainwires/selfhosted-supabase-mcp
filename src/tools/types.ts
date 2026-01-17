import type { SelfhostedSupabaseClient } from '../client/index.js';

// Define log function type
type LogFunction = (message: string, level?: 'info' | 'warn' | 'error') => void;

/**
 * Authentication context extracted from a validated Supabase JWT.
 * Present when using HTTP transport with auth passthrough.
 */
export interface AuthContext {
    /** User ID from JWT 'sub' claim */
    userId: string;
    /** User email from JWT 'email' claim */
    email: string | null;
    /** User role from JWT 'role' claim (typically 'authenticated') */
    role: string;
    /** Session ID from JWT 'session_id' claim if present */
    sessionId?: string;
    /** The raw JWT access token for Supabase client calls */
    accessToken: string;
    /** Token expiration time (Unix timestamp) from JWT 'exp' claim */
    expiresAt: number;
    /** App metadata from JWT */
    appMetadata?: Record<string, unknown>;
    /** User metadata from JWT */
    userMetadata?: Record<string, unknown>;
}

/**
 * Defines the expected shape of the context object passed to tool execute functions.
 */
export interface ToolContext {
    selfhostedClient: SelfhostedSupabaseClient;
    log: LogFunction; // Explicitly define the log function
    workspacePath?: string; // Path to the workspace root
    /** Authentication context - present when using HTTP transport */
    authContext?: AuthContext;
    [key: string]: unknown; // Allow other context properties, though log is now typed
} 