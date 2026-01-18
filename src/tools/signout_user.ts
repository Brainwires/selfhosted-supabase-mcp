import { z } from 'zod';
import type { ToolContext } from './types.js';

// Input schema
const SignoutUserInputSchema = z.object({
    user_id: z.uuid().optional().describe('The UUID of the user to sign out. If provided, revokes all sessions for this user.'),
    session_id: z.uuid().optional().describe('The UUID of a specific session to revoke. Takes precedence over user_id if both provided.'),
    scope: z.enum(['local', 'global', 'others']).optional().default('global').describe('Scope of signout: "local" (current session via Supabase client), "global" (all sessions), "others" (all except current). Default: global.'),
});
type SignoutUserInput = z.infer<typeof SignoutUserInputSchema>;

// Output schema
const SignoutUserOutputSchema = z.object({
    success: z.boolean(),
    sessions_revoked: z.number().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
});

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        user_id: {
            type: 'string',
            format: 'uuid',
            description: 'The UUID of the user to sign out. If provided, revokes all sessions for this user.',
        },
        session_id: {
            type: 'string',
            format: 'uuid',
            description: 'The UUID of a specific session to revoke. Takes precedence over user_id if both provided.',
        },
        scope: {
            type: 'string',
            enum: ['local', 'global', 'others'],
            default: 'global',
            description: 'Scope of signout: "local" (current session via Supabase client), "global" (all sessions), "others" (all except current). Default: global.',
        },
    },
    required: [],
};

export const signoutUserTool = {
    name: 'signout_user',
    description: 'Sign out a user and invalidate their sessions. Can target a specific session by session_id, all sessions for a user by user_id, or use the Supabase client signOut with scope control.',
    inputSchema: SignoutUserInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: SignoutUserOutputSchema,

    execute: async (input: SignoutUserInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { user_id, session_id, scope } = input;

        try {
            // If session_id is provided, revoke that specific session directly
            if (session_id) {
                if (!client.isPgAvailable()) {
                    return {
                        success: false,
                        error: 'Database URL is required to revoke sessions by session_id. Please provide --db-url or DATABASE_URL.',
                    };
                }

                // First, get session details to check ownership
                const sessionDetails = await client.executeTransactionWithPg(async (pgClient) => {
                    const result = await pgClient.query(
                        `SELECT s.id, s.user_id, u.email
                         FROM auth.sessions s
                         JOIN auth.users u ON u.id = s.user_id
                         WHERE s.id = $1`,
                        [session_id]
                    );
                    return result.rows[0] || null;
                });

                if (!sessionDetails) {
                    return {
                        success: false,
                        error: `Session ${session_id} not found or already revoked.`,
                    };
                }

                // Delete the specific session using parameterized query
                const deleteResult = await client.executeTransactionWithPg(async (pgClient) => {
                    const result = await pgClient.query(
                        'DELETE FROM auth.sessions WHERE id = $1 RETURNING id',
                        [session_id]
                    );
                    return result.rowCount || 0;
                });

                context.log?.(`Revoked session ${session_id}`, 'info');

                return {
                    success: true,
                    sessions_revoked: deleteResult,
                    message: `Session ${session_id} has been revoked.`,
                };
            }

            // If user_id is provided, revoke all sessions for that user
            if (user_id) {
                if (!client.isPgAvailable()) {
                    return {
                        success: false,
                        error: 'Database URL is required to revoke sessions by user_id. Please provide --db-url or DATABASE_URL.',
                    };
                }

                // Delete all sessions for the user using parameterized query
                const count = await client.executeTransactionWithPg(async (pgClient) => {
                    const result = await pgClient.query(
                        'DELETE FROM auth.sessions WHERE user_id = $1 RETURNING id',
                        [user_id]
                    );
                    return result.rowCount || 0;
                });

                context.log?.(`Revoked ${count} session(s) for user ${user_id}`, 'info');

                return {
                    success: true,
                    sessions_revoked: count,
                    message: count > 0
                        ? `Revoked ${count} session(s) for user ${user_id}.`
                        : `No active sessions found for user ${user_id}.`,
                };
            }

            // Otherwise, use the Supabase client signOut with scope
            const { error } = await client.supabase.auth.signOut({
                scope: scope as 'local' | 'global' | 'others',
            });

            if (error) {
                context.log?.(`Sign out failed: ${error.message}`, 'warn');
                return {
                    success: false,
                    error: error.message,
                };
            }

            context.log?.(`Sign out successful with scope: ${scope}`, 'info');

            return {
                success: true,
                message: `Sign out completed with scope: ${scope}.`,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            context.log?.(`Sign out exception: ${errorMessage}`, 'error');
            return {
                success: false,
                error: `Sign out failed: ${errorMessage}`,
            };
        }
    },
};
