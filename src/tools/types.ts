import type { SelfhostedSupabaseClient } from '../client/index.js';

// Define log function type
type LogFunction = (message: string, level?: 'info' | 'warn' | 'error') => void;

/**
 * Privilege levels for tools.
 * - 'regular': Safe read-only operations, can be called by any authenticated user
 * - 'privileged': Requires service_role key or direct DB connection, performs admin operations
 * - 'sensitive': Returns sensitive configuration data (keys, secrets) - use with caution
 */
export type ToolPrivilegeLevel = 'regular' | 'privileged' | 'sensitive';

/**
 * User context from JWT authentication (HTTP mode only).
 */
export interface UserContext {
    userId: string;
    email: string | null;
    role: string;
}

/**
 * Maps JWT roles to allowed tool privilege levels.
 * - 'service_role': Can access all tools including sensitive
 * - 'authenticated': Can only access regular tools
 * - 'anon': Can only access regular tools (same as authenticated)
 */
const ROLE_PRIVILEGE_MAP: Record<string, Set<ToolPrivilegeLevel>> = {
    service_role: new Set<ToolPrivilegeLevel>(['regular', 'privileged', 'sensitive']),
    authenticated: new Set<ToolPrivilegeLevel>(['regular']),
    anon: new Set<ToolPrivilegeLevel>(['regular']),
};

/**
 * Checks if a JWT role can access a tool with the given privilege level.
 *
 * @param userRole - The role from the JWT token
 * @param toolPrivilegeLevel - The privilege level required by the tool
 * @returns true if access is allowed, false otherwise
 */
export function canAccessTool(
    userRole: string,
    toolPrivilegeLevel: ToolPrivilegeLevel
): boolean {
    const allowedLevels = ROLE_PRIVILEGE_MAP[userRole] ?? ROLE_PRIVILEGE_MAP.authenticated;
    return allowedLevels.has(toolPrivilegeLevel);
}

/**
 * Defines the expected shape of the context object passed to tool execute functions.
 */
export interface ToolContext {
    selfhostedClient: SelfhostedSupabaseClient;
    log: LogFunction; // Explicitly define the log function
    workspacePath?: string; // Path to the workspace root
    user?: UserContext; // User context from JWT (HTTP mode only)
    [key: string]: unknown; // Allow other context properties
} 