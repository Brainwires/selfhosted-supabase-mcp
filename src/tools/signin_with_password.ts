import { z } from 'zod';
import type { ToolContext } from './types.js';

// Input schema
const SigninWithPasswordInputSchema = z.object({
    email: z.email().describe('The email address of the user to sign in.'),
    password: z.string().min(1).describe('The password for the user.'),
});
type SigninWithPasswordInput = z.infer<typeof SigninWithPasswordInputSchema>;

// Output schema
const SigninWithPasswordOutputSchema = z.object({
    success: z.boolean(),
    access_token: z.string().optional(),
    refresh_token: z.string().optional(),
    expires_at: z.number().optional(),
    expires_in: z.number().optional(),
    token_type: z.string().optional(),
    user_id: z.uuid().optional(),
    email: z.email().optional(),
    error: z.string().optional(),
});

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        email: {
            type: 'string',
            format: 'email',
            description: 'The email address of the user to sign in.',
        },
        password: {
            type: 'string',
            minLength: 1,
            description: 'The password for the user.',
        },
    },
    required: ['email', 'password'],
};

export const signinWithPasswordTool = {
    name: 'signin_with_password',
    description: 'Sign in a user with email and password to get JWT tokens for authenticated requests. Returns access_token and refresh_token that can be used to authenticate API calls.',
    inputSchema: SigninWithPasswordInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: SigninWithPasswordOutputSchema,

    execute: async (input: SigninWithPasswordInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { email, password } = input;

        try {
            const { data, error } = await client.supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (error) {
                context.log?.(`Sign in failed for ${email}: ${error.message}`, 'warn');
                return {
                    success: false,
                    error: error.message,
                };
            }

            if (!data.session) {
                return {
                    success: false,
                    error: 'Sign in succeeded but no session was returned.',
                };
            }

            context.log?.(`User ${email} signed in successfully`, 'info');

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
            context.log?.(`Sign in exception for ${email}: ${errorMessage}`, 'error');
            return {
                success: false,
                error: `Sign in failed: ${errorMessage}`,
            };
        }
    },
};
