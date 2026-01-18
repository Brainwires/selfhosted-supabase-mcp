import jwt from 'jsonwebtoken';
import type { AuthContext } from '../tools/types.js';

/**
 * JWT payload structure for Supabase access tokens.
 * Note: `sub` is optional because service_role tokens don't have a user ID.
 */
export interface SupabaseJwtPayload {
    sub?: string;
    email?: string;
    role?: string;
    session_id?: string;
    exp: number;
    iat: number;
    aud: string;
    iss?: string;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
}

/**
 * Error thrown when authentication fails.
 */
export class AuthenticationError extends Error {
    public readonly statusCode = 401;

    constructor(message: string) {
        super(message);
        this.name = 'AuthenticationError';
    }
}

/**
 * Middleware for validating Supabase JWTs and extracting user context.
 */
export class AuthMiddleware {
    private jwtSecret: string;

    constructor(jwtSecret: string) {
        if (!jwtSecret) {
            throw new Error('JWT secret is required for HTTP transport');
        }
        this.jwtSecret = jwtSecret;
    }

    /**
     * Validates a JWT from an Authorization header and extracts the auth context.
     * @param authHeader - The Authorization header value (e.g., "Bearer <token>")
     * @returns The validated AuthContext
     * @throws AuthenticationError if validation fails
     */
    validateToken(authHeader: string | undefined): AuthContext {
        if (!authHeader) {
            throw new AuthenticationError('Missing Authorization header');
        }

        if (!authHeader.startsWith('Bearer ')) {
            throw new AuthenticationError('Invalid Authorization header format. Expected: Bearer <token>');
        }

        const token = authHeader.substring(7);

        if (!token) {
            throw new AuthenticationError('Empty token in Authorization header');
        }

        try {
            const decoded = jwt.verify(token, this.jwtSecret, {
                algorithms: ['HS256'],
            }) as SupabaseJwtPayload;

            // Handle service_role and anon tokens (no sub claim, role in payload)
            // These tokens have role: 'service_role' or 'anon' and no user ID
            if (decoded.role === 'service_role' || decoded.role === 'anon') {
                return {
                    userId: decoded.role, // Use role as identifier since there's no user
                    email: null,
                    role: decoded.role,
                    sessionId: undefined,
                    accessToken: token,
                    expiresAt: decoded.exp,
                    appMetadata: undefined,
                    userMetadata: undefined,
                };
            }

            // For user tokens, verify audience is 'authenticated'
            if (decoded.aud !== 'authenticated') {
                throw new AuthenticationError(`Invalid token audience: ${decoded.aud}`);
            }

            // User tokens must have a sub claim
            if (!decoded.sub) {
                throw new AuthenticationError('Token missing required "sub" claim');
            }

            return {
                userId: decoded.sub,
                email: decoded.email || null,
                role: decoded.role || 'authenticated',
                sessionId: decoded.session_id,
                accessToken: token,
                expiresAt: decoded.exp,
                appMetadata: decoded.app_metadata,
                userMetadata: decoded.user_metadata,
            };
        } catch (error) {
            if (error instanceof AuthenticationError) {
                throw error;
            }
            if (error instanceof jwt.TokenExpiredError) {
                throw new AuthenticationError('Token expired');
            }
            if (error instanceof jwt.JsonWebTokenError) {
                throw new AuthenticationError(`Invalid token: ${error.message}`);
            }
            if (error instanceof jwt.NotBeforeError) {
                throw new AuthenticationError('Token not yet valid');
            }
            // Re-throw unexpected errors
            throw error;
        }
    }

    /**
     * Checks if a token is close to expiring.
     * @param authContext - The auth context to check
     * @param thresholdSeconds - Seconds before expiry to consider "close" (default: 300 = 5 minutes)
     * @returns true if token expires within threshold
     */
    isTokenExpiringSoon(authContext: AuthContext, thresholdSeconds = 300): boolean {
        const now = Math.floor(Date.now() / 1000);
        return authContext.expiresAt - now <= thresholdSeconds;
    }

    /**
     * Checks if a token has expired.
     * @param authContext - The auth context to check
     * @returns true if token is expired
     */
    isTokenExpired(authContext: AuthContext): boolean {
        const now = Math.floor(Date.now() / 1000);
        return authContext.expiresAt <= now;
    }
}
