import { z } from 'zod';
import type { ToolContext } from './types.js';

// Input schema
const SignupUserInputSchema = z.object({
    email: z.string().email().describe('The email address for the new user.'),
    password: z.string().min(6).describe('The password for the new user (min 6 characters).'),
    return_session: z.boolean().optional().default(true).describe('Whether to return session tokens after signup (default: true).'),
    user_metadata: z.record(z.unknown()).optional().describe('Optional user metadata to attach to the user.'),
    email_confirm: z.boolean().optional().default(false).describe('Whether to auto-confirm the email (requires service role key, default: false).'),
});
type SignupUserInput = z.infer<typeof SignupUserInputSchema>;

// Output schema
const SignupUserOutputSchema = z.object({
    success: z.boolean(),
    user_id: z.string().uuid().optional(),
    email: z.string().email().optional(),
    email_confirmed: z.boolean().optional(),
    access_token: z.string().optional(),
    refresh_token: z.string().optional(),
    expires_at: z.number().optional(),
    expires_in: z.number().optional(),
    confirmation_sent_at: z.string().optional(),
    error: z.string().optional(),
});

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        email: {
            type: 'string',
            format: 'email',
            description: 'The email address for the new user.',
        },
        password: {
            type: 'string',
            minLength: 6,
            description: 'The password for the new user (min 6 characters).',
        },
        return_session: {
            type: 'boolean',
            default: true,
            description: 'Whether to return session tokens after signup (default: true).',
        },
        user_metadata: {
            type: 'object',
            description: 'Optional user metadata to attach to the user.',
        },
        email_confirm: {
            type: 'boolean',
            default: false,
            description: 'Whether to auto-confirm the email (requires service role key, default: false).',
        },
    },
    required: ['email', 'password'],
};

export const signupUserTool = {
    name: 'signup_user',
    description: 'Register a new user with email and password. Optionally returns session tokens for immediate authentication. Use email_confirm=true to skip email verification (requires service role).',
    inputSchema: SignupUserInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: SignupUserOutputSchema,

    execute: async (input: SignupUserInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { email, password, return_session, user_metadata, email_confirm } = input;

        try {
            // Build signup options
            const options: {
                data?: Record<string, unknown>;
                emailRedirectTo?: string;
            } = {};

            if (user_metadata) {
                options.data = user_metadata;
            }

            const { data, error } = await client.supabase.auth.signUp({
                email,
                password,
                options,
            });

            if (error) {
                context.log?.(`Signup failed for ${email}: ${error.message}`, 'warn');
                return {
                    success: false,
                    error: error.message,
                };
            }

            if (!data.user) {
                return {
                    success: false,
                    error: 'Signup succeeded but no user was returned.',
                };
            }

            // If email_confirm is requested and we have service role key, confirm the email
            if (email_confirm && client.getServiceRoleKey()) {
                try {
                    // Use admin API to update the user's email confirmation
                    const { error: confirmError } = await client.supabase.auth.admin.updateUserById(
                        data.user.id,
                        { email_confirm: true }
                    );
                    if (confirmError) {
                        context.log?.(`Failed to auto-confirm email for ${email}: ${confirmError.message}`, 'warn');
                    }
                } catch (confirmErr) {
                    context.log?.(`Exception during email confirmation: ${confirmErr}`, 'warn');
                }
            }

            context.log?.(`User ${email} signed up successfully with ID ${data.user.id}`, 'info');

            const result: z.infer<typeof SignupUserOutputSchema> = {
                success: true,
                user_id: data.user.id,
                email: data.user.email ?? undefined,
                email_confirmed: !!data.user.email_confirmed_at,
                confirmation_sent_at: data.user.confirmation_sent_at ?? undefined,
            };

            // Include session tokens if requested and available
            if (return_session && data.session) {
                result.access_token = data.session.access_token;
                result.refresh_token = data.session.refresh_token;
                result.expires_at = data.session.expires_at;
                result.expires_in = data.session.expires_in;
            }

            return result;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            context.log?.(`Signup exception for ${email}: ${errorMessage}`, 'error');
            return {
                success: false,
                error: `Signup failed: ${errorMessage}`,
            };
        }
    },
};
