import { z } from 'zod';
import type { ToolContext } from './types.js';

// Input schema
const RefreshSessionInputSchema = z.object({
    refresh_token: z.string().min(1).describe('The refresh token from a previous sign in or signup.'),
});
type RefreshSessionInput = z.infer<typeof RefreshSessionInputSchema>;

// Output schema
const RefreshSessionOutputSchema = z.object({
    success: z.boolean(),
    access_token: z.string().optional(),
    refresh_token: z.string().optional(),
    expires_at: z.number().optional(),
    expires_in: z.number().optional(),
    token_type: z.string().optional(),
    user_id: z.string().uuid().optional(),
    email: z.string().email().optional(),
    error: z.string().optional(),
});

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        refresh_token: {
            type: 'string',
            minLength: 1,
            description: 'The refresh token from a previous sign in or signup.',
        },
    },
    required: ['refresh_token'],
};

export const refreshSessionTool = {
    name: 'refresh_session',
    description: 'Refresh an expired access token using a refresh token. Returns new access and refresh tokens.',
    inputSchema: RefreshSessionInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: RefreshSessionOutputSchema,

    execute: async (input: RefreshSessionInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { refresh_token } = input;

        try {
            const { data, error } = await client.supabase.auth.refreshSession({
                refresh_token,
            });

            if (error) {
                context.log?.(`Session refresh failed: ${error.message}`, 'warn');
                return {
                    success: false,
                    error: error.message,
                };
            }

            if (!data.session) {
                return {
                    success: false,
                    error: 'Session refresh succeeded but no session was returned.',
                };
            }

            context.log?.(`Session refreshed successfully for user ${data.user?.id}`, 'info');

            return {
                success: true,
                access_token: data.session.access_token,
                refresh_token: data.session.refresh_token,
                expires_at: data.session.expires_at,
                expires_in: data.session.expires_in,
                token_type: data.session.token_type,
                user_id: data.user?.id,
                email: data.user?.email ?? undefined,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            context.log?.(`Session refresh exception: ${errorMessage}`, 'error');
            return {
                success: false,
                error: `Session refresh failed: ${errorMessage}`,
            };
        }
    },
};
