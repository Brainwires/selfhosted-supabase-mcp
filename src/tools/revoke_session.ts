import { z } from 'zod';
import type { ToolContext } from './types.js';

// Input schema
const RevokeSessionInputSchema = z.object({
    session_id: z.uuid().describe('The UUID of the session to revoke.'),
    confirm: z.boolean().optional().default(false).describe('Must be true to execute. Without this, returns a preview.'),
});
type RevokeSessionInput = z.infer<typeof RevokeSessionInputSchema>;

// Output schema
const RevokeSessionOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    action: z.enum(['preview', 'revoked', 'not_found']),
    session_details: z.object({
        id: z.string(),
        user_id: z.string(),
        email: z.string().nullable(),
        created_at: z.string(),
        updated_at: z.string(),
        user_agent: z.string().nullable(),
        ip: z.string().nullable(),
    }).optional(),
});

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        session_id: {
            type: 'string',
            format: 'uuid',
            description: 'The UUID of the session to revoke.',
        },
        confirm: {
            type: 'boolean',
            default: false,
            description: 'Must be true to execute. Without this, returns a preview.',
        },
    },
    required: ['session_id'],
};

export const revokeSessionTool = {
    name: 'revoke_session',
    description: 'Revokes (deletes) an authentication session, effectively logging out that session. Requires confirm=true to execute.',
    inputSchema: RevokeSessionInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: RevokeSessionOutputSchema,

    execute: async (input: RevokeSessionInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { session_id, confirm } = input;

        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for revoking sessions but is not configured or available.');
        }

        try {
            // First, get session details
            const sessionDetails = await client.executeTransactionWithPg(async (pgClient) => {
                const result = await pgClient.query(
                    `SELECT
                        s.id,
                        s.user_id,
                        u.email,
                        s.created_at::text,
                        s.updated_at::text,
                        s.user_agent,
                        s.ip::text
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
                    message: `Session with ID ${session_id} not found.`,
                    action: 'not_found' as const,
                };
            }

            // If not confirmed, return preview
            if (!confirm) {
                return {
                    success: true,
                    message: `Preview: Will revoke session for user ${sessionDetails.email || sessionDetails.user_id}. Set confirm=true to execute.`,
                    action: 'preview' as const,
                    session_details: sessionDetails,
                };
            }

            // Delete the session
            await client.executeTransactionWithPg(async (pgClient) => {
                await pgClient.query(
                    'DELETE FROM auth.sessions WHERE id = $1',
                    [session_id]
                );
            });

            context.log?.(`Revoked session ${session_id} for user ${sessionDetails.email || sessionDetails.user_id}`, 'warn');

            return {
                success: true,
                message: `Successfully revoked session for user ${sessionDetails.email || sessionDetails.user_id}.`,
                action: 'revoked' as const,
                session_details: sessionDetails,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to revoke session: ${errorMessage}`);
        }
    },
};
