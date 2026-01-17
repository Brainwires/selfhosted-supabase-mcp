import { z } from 'zod';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import type { ToolContext } from './types.js';
import { executeSqlWithFallback, isSqlErrorResponse } from './utils.js';
import type { PoolClient } from 'pg';

// Input schema
const GenerateUserTokenInputSchema = z.object({
    user_id: z.uuid().describe('The UUID of the user to generate a token for.'),
    create_session: z.boolean().optional().default(false).describe('Whether to create a real session in auth.sessions (default: false). When true, the session will appear in list_auth_sessions.'),
    expires_in: z.number().optional().default(3600).describe('Token expiration time in seconds (default: 3600 = 1 hour).'),
});
type GenerateUserTokenInput = z.infer<typeof GenerateUserTokenInputSchema>;

// Output schema
const GenerateUserTokenOutputSchema = z.object({
    success: z.boolean(),
    access_token: z.string().optional(),
    refresh_token: z.string().optional(),
    expires_at: z.number().optional(),
    expires_in: z.number().optional(),
    session_id: z.uuid().optional(),
    user_id: z.uuid().optional(),
    email: z.string().optional(),
    mode: z.enum(['jwt_only', 'full_session']).optional(),
    error: z.string().optional(),
});

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        user_id: {
            type: 'string',
            format: 'uuid',
            description: 'The UUID of the user to generate a token for.',
        },
        create_session: {
            type: 'boolean',
            default: false,
            description: 'Whether to create a real session in auth.sessions (default: false). When true, the session will appear in list_auth_sessions.',
        },
        expires_in: {
            type: 'number',
            default: 3600,
            description: 'Token expiration time in seconds (default: 3600 = 1 hour).',
        },
    },
    required: ['user_id'],
};

export const generateUserTokenTool = {
    name: 'generate_user_token',
    description: 'Generate a JWT token for any user without knowing their password (sudo capability). By default generates a stateless JWT. Use create_session=true to create a full session with refresh token that appears in list_auth_sessions. Requires JWT secret configuration.',
    inputSchema: GenerateUserTokenInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: GenerateUserTokenOutputSchema,

    execute: async (input: GenerateUserTokenInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { user_id, create_session, expires_in } = input;

        // Check for required JWT secret
        const jwtSecret = client.getJwtSecret();
        if (!jwtSecret) {
            return {
                success: false,
                error: 'JWT secret is not configured. Please provide --jwt-secret or SUPABASE_AUTH_JWT_SECRET environment variable.',
            };
        }

        // For full session mode, we need database access
        if (create_session && !client.isPgAvailable()) {
            return {
                success: false,
                error: 'Database URL is required for create_session=true mode. Please provide --db-url or DATABASE_URL environment variable.',
            };
        }

        try {
            // Fetch user details
            const userResult = await executeSqlWithFallback(client, `
                SELECT id, email, role, raw_app_meta_data, raw_user_meta_data
                FROM auth.users
                WHERE id = '${user_id.replace(/'/g, "''")}'
            `, true);

            if (isSqlErrorResponse(userResult)) {
                return {
                    success: false,
                    error: `Failed to fetch user: ${userResult.error.message}`,
                };
            }

            const users = userResult as Array<{
                id: string;
                email: string | null;
                role: string | null;
                raw_app_meta_data: Record<string, unknown> | null;
                raw_user_meta_data: Record<string, unknown> | null;
            }>;

            if (users.length === 0) {
                return {
                    success: false,
                    error: `User with ID ${user_id} not found.`,
                };
            }

            const user = users[0];
            const now = Math.floor(Date.now() / 1000);
            const expiresAt = now + expires_in;

            if (create_session) {
                // Full session mode: create session in DB + JWT with session_id
                return await createFullSession(client, user, jwtSecret, expires_in, now, expiresAt, context);
            } else {
                // JWT-only mode: generate stateless token
                return createJwtOnlyToken(user, jwtSecret, expires_in, now, expiresAt, context);
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            context.log?.(`Token generation failed for user ${user_id}: ${errorMessage}`, 'error');
            return {
                success: false,
                error: `Token generation failed: ${errorMessage}`,
            };
        }
    },
};

function createJwtOnlyToken(
    user: { id: string; email: string | null; role: string | null; raw_app_meta_data: Record<string, unknown> | null; raw_user_meta_data: Record<string, unknown> | null },
    jwtSecret: string,
    expiresIn: number,
    now: number,
    expiresAt: number,
    context: ToolContext
): z.infer<typeof GenerateUserTokenOutputSchema> {
    const payload = {
        aud: 'authenticated',
        exp: expiresAt,
        iat: now,
        sub: user.id,
        email: user.email,
        role: user.role || 'authenticated',
        app_metadata: user.raw_app_meta_data || {},
        user_metadata: user.raw_user_meta_data || {},
    };

    const accessToken = jwt.sign(payload, jwtSecret, { algorithm: 'HS256' });

    context.log?.(`Generated JWT-only token for user ${user.id} (${user.email})`, 'info');

    return {
        success: true,
        access_token: accessToken,
        expires_at: expiresAt,
        expires_in: expiresIn,
        user_id: user.id,
        email: user.email ?? undefined,
        mode: 'jwt_only',
    };
}

async function createFullSession(
    client: ToolContext['selfhostedClient'],
    user: { id: string; email: string | null; role: string | null; raw_app_meta_data: Record<string, unknown> | null; raw_user_meta_data: Record<string, unknown> | null },
    jwtSecret: string,
    expiresIn: number,
    now: number,
    expiresAt: number,
    context: ToolContext
): Promise<z.infer<typeof GenerateUserTokenOutputSchema>> {
    const sessionId = randomUUID();
    const refreshToken = randomUUID();
    const notAfter = new Date(expiresAt * 1000).toISOString();

    // Create session and refresh token in a transaction
    await client.executeTransactionWithPg(async (pgClient: PoolClient) => {
        // Insert session
        await pgClient.query(`
            INSERT INTO auth.sessions (id, user_id, created_at, updated_at, factor_id, aal, not_after)
            VALUES ($1, $2, now(), now(), null, 'aal1', $3)
        `, [sessionId, user.id, notAfter]);

        // Insert refresh token
        await pgClient.query(`
            INSERT INTO auth.refresh_tokens (token, user_id, session_id, revoked, created_at, updated_at)
            VALUES ($1, $2, $3, false, now(), now())
        `, [refreshToken, user.id, sessionId]);
    });

    // Generate JWT with session_id
    const payload = {
        aud: 'authenticated',
        exp: expiresAt,
        iat: now,
        sub: user.id,
        email: user.email,
        role: user.role || 'authenticated',
        session_id: sessionId,
        app_metadata: user.raw_app_meta_data || {},
        user_metadata: user.raw_user_meta_data || {},
    };

    const accessToken = jwt.sign(payload, jwtSecret, { algorithm: 'HS256' });

    context.log?.(`Generated full session token for user ${user.id} (${user.email}), session_id: ${sessionId}`, 'info');

    return {
        success: true,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        expires_in: expiresIn,
        session_id: sessionId,
        user_id: user.id,
        email: user.email ?? undefined,
        mode: 'full_session',
    };
}
