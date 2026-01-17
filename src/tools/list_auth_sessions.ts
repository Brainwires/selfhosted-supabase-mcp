import { z } from 'zod';
import type { ToolContext } from './types.js';

// Output schema for auth sessions
const ListAuthSessionsOutputSchema = z.array(z.object({
    id: z.string(),
    user_id: z.string(),
    email: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    factor_id: z.string().nullable(),
    aal: z.string().nullable(),
    not_after: z.string().nullable(),
    refreshed_at: z.string().nullable(),
    user_agent: z.string().nullable(),
    ip: z.string().nullable(),
    tag: z.string().nullable(),
}));

// Input schema with optional filters
const ListAuthSessionsInputSchema = z.object({
    user_id: z.uuid().optional().describe('Filter sessions by user ID.'),
    limit: z.number().optional().default(50).describe('Maximum number of sessions to return.'),
    offset: z.number().optional().default(0).describe('Number of sessions to skip.'),
});
type ListAuthSessionsInput = z.infer<typeof ListAuthSessionsInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        user_id: {
            type: 'string',
            format: 'uuid',
            description: 'Filter sessions by user ID.',
        },
        limit: {
            type: 'number',
            default: 50,
            description: 'Maximum number of sessions to return.',
        },
        offset: {
            type: 'number',
            default: 0,
            description: 'Number of sessions to skip.',
        },
    },
    required: [],
};

export const listAuthSessionsTool = {
    name: 'list_auth_sessions',
    description: 'Lists active authentication sessions. When using HTTP transport, users can only see their own sessions (RLS enforced). The user_id filter is ignored in HTTP mode.',
    inputSchema: ListAuthSessionsInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ListAuthSessionsOutputSchema,

    execute: async (input: ListAuthSessionsInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { limit, offset } = input;
        let { user_id } = input;

        if (!client.isPgAvailable()) {
            throw new Error('Direct database connection (DATABASE_URL) is required for accessing auth sessions but is not configured or available.');
        }

        // RLS enforcement: In HTTP mode, users can only see their own sessions
        if (context.authContext) {
            const currentUserId = context.authContext.userId;

            // Force user_id to current user (ignore any provided value)
            if (user_id && user_id !== currentUserId) {
                context.log(`RLS: Ignoring user_id filter '${user_id}', restricting to current user '${currentUserId}'`, 'warn');
            }
            user_id = currentUserId;
        }

        try {
            const sessions = await client.executeTransactionWithPg(async (pgClient) => {
                let query = `
                    SELECT
                        s.id,
                        s.user_id,
                        u.email,
                        s.created_at::text,
                        s.updated_at::text,
                        s.factor_id::text,
                        s.aal::text,
                        s.not_after::text,
                        s.refreshed_at::text,
                        s.user_agent,
                        s.ip::text,
                        s.tag
                    FROM auth.sessions s
                    JOIN auth.users u ON u.id = s.user_id
                `;

                const params: unknown[] = [];
                let paramIndex = 1;

                if (user_id) {
                    query += ` WHERE s.user_id = $${paramIndex}`;
                    params.push(user_id);
                    paramIndex++;
                }

                query += ` ORDER BY s.updated_at DESC`;
                query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
                params.push(limit, offset);

                const result = await pgClient.query(query, params);
                return result.rows;
            });

            return ListAuthSessionsOutputSchema.parse(sessions);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to list auth sessions: ${errorMessage}`);
        }
    },
};
