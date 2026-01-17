import { z } from 'zod';
import jwt from 'jsonwebtoken';
import type { ToolContext } from './types.js';

// Input schema
const GetCurrentSessionInputSchema = z.object({
    access_token: z.string().min(1).describe('The JWT access token to validate and decode.'),
    verify_signature: z.boolean().optional().default(true).describe('Whether to verify the JWT signature (requires JWT secret). Default: true.'),
});
type GetCurrentSessionInput = z.infer<typeof GetCurrentSessionInputSchema>;

// JWT payload type
interface JwtPayload {
    aud?: string;
    exp?: number;
    iat?: number;
    sub?: string;
    email?: string;
    role?: string;
    session_id?: string;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
    [key: string]: unknown;
}

// Output schema
const GetCurrentSessionOutputSchema = z.object({
    valid: z.boolean(),
    expired: z.boolean().optional(),
    user_id: z.string().uuid().optional(),
    email: z.string().optional(),
    role: z.string().optional(),
    session_id: z.string().uuid().optional(),
    expires_at: z.number().optional(),
    issued_at: z.number().optional(),
    audience: z.string().optional(),
    app_metadata: z.record(z.unknown()).optional(),
    user_metadata: z.record(z.unknown()).optional(),
    signature_verified: z.boolean().optional(),
    error: z.string().optional(),
});

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        access_token: {
            type: 'string',
            minLength: 1,
            description: 'The JWT access token to validate and decode.',
        },
        verify_signature: {
            type: 'boolean',
            default: true,
            description: 'Whether to verify the JWT signature (requires JWT secret). Default: true.',
        },
    },
    required: ['access_token'],
};

export const getCurrentSessionTool = {
    name: 'get_current_session',
    description: 'Validate and decode a JWT access token. Returns the token payload including user_id, email, role, expiration, and metadata. Optionally verifies the signature using the configured JWT secret.',
    inputSchema: GetCurrentSessionInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: GetCurrentSessionOutputSchema,

    execute: async (input: GetCurrentSessionInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { access_token, verify_signature } = input;

        try {
            const jwtSecret = client.getJwtSecret();

            if (verify_signature && !jwtSecret) {
                return {
                    valid: false,
                    error: 'JWT secret is not configured. Either provide --jwt-secret or set verify_signature=false to decode without verification.',
                };
            }

            let payload: JwtPayload;
            let signatureVerified = false;

            if (verify_signature && jwtSecret) {
                // Verify and decode
                try {
                    payload = jwt.verify(access_token, jwtSecret, { algorithms: ['HS256'] }) as JwtPayload;
                    signatureVerified = true;
                } catch (verifyError: unknown) {
                    const error = verifyError as { name?: string; message?: string };

                    if (error.name === 'TokenExpiredError') {
                        // Token is expired but signature was valid - decode it anyway to show info
                        payload = jwt.decode(access_token) as JwtPayload;
                        if (!payload) {
                            return {
                                valid: false,
                                error: 'Failed to decode expired token.',
                            };
                        }

                        return {
                            valid: false,
                            expired: true,
                            signature_verified: true,
                            user_id: payload.sub,
                            email: payload.email,
                            role: payload.role,
                            session_id: payload.session_id,
                            expires_at: payload.exp,
                            issued_at: payload.iat,
                            audience: payload.aud,
                            app_metadata: payload.app_metadata,
                            user_metadata: payload.user_metadata,
                            error: 'Token has expired.',
                        };
                    }

                    if (error.name === 'JsonWebTokenError') {
                        return {
                            valid: false,
                            signature_verified: false,
                            error: `Invalid token: ${error.message}`,
                        };
                    }

                    return {
                        valid: false,
                        error: `Token verification failed: ${error.message || 'Unknown error'}`,
                    };
                }
            } else {
                // Decode without verification
                const decoded = jwt.decode(access_token);
                if (!decoded || typeof decoded === 'string') {
                    return {
                        valid: false,
                        error: 'Failed to decode token. Invalid JWT format.',
                    };
                }
                payload = decoded as JwtPayload;
            }

            // Check if token is expired
            const now = Math.floor(Date.now() / 1000);
            const isExpired = payload.exp ? payload.exp < now : false;

            context.log?.(`Token decoded for user ${payload.sub}, expired: ${isExpired}`, 'info');

            return {
                valid: !isExpired,
                expired: isExpired,
                signature_verified: signatureVerified,
                user_id: payload.sub,
                email: payload.email,
                role: payload.role,
                session_id: payload.session_id,
                expires_at: payload.exp,
                issued_at: payload.iat,
                audience: payload.aud,
                app_metadata: payload.app_metadata,
                user_metadata: payload.user_metadata,
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            context.log?.(`Token validation exception: ${errorMessage}`, 'error');
            return {
                valid: false,
                error: `Token validation failed: ${errorMessage}`,
            };
        }
    },
};
