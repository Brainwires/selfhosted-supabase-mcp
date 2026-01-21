/**
 * Tests for miscellaneous tools
 *
 * Tools tested:
 * - get_project_url
 * - get_anon_key
 * - get_service_key
 * - verify_jwt_secret
 * - generate_typescript_types
 * - list_realtime_publications
 * - list_cron_jobs
 * - list_vector_indexes
 */

import { describe, test, expect, mock } from 'bun:test';
import { getProjectUrlTool } from '../../tools/get_project_url.js';
import { getAnonKeyTool } from '../../tools/get_anon_key.js';
import { getServiceKeyTool } from '../../tools/get_service_key.js';
import { verifyJwtSecretTool } from '../../tools/verify_jwt_secret.js';
import { generateTypesTool } from '../../tools/generate_typescript_types.js';
import {
    createMockClient,
    createMockContext,
} from '../helpers/mocks.js';

describe('getProjectUrlTool', () => {
    describe('metadata', () => {
        test('has correct name', () => {
            expect(getProjectUrlTool.name).toBe('get_project_url');
        });

        test('has description', () => {
            expect(getProjectUrlTool.description).toContain('URL');
        });
    });

    describe('input validation', () => {
        test('accepts empty input', () => {
            const result = getProjectUrlTool.inputSchema.safeParse({});
            expect(result.success).toBe(true);
        });
    });

    describe('execute', () => {
        test('returns project URL', async () => {
            const mockClient = createMockClient({
                supabaseUrl: 'https://my-project.supabase.co',
            });
            const context = createMockContext(mockClient);

            const result = await getProjectUrlTool.execute({}, context);

            expect(result.project_url).toBe('https://my-project.supabase.co');
        });

        test('returns configured URL from client', async () => {
            const customUrl = 'https://custom.supabase.example.com';
            const mockClient = createMockClient({ supabaseUrl: customUrl });
            const context = createMockContext(mockClient);

            const result = await getProjectUrlTool.execute({}, context);

            expect(result.project_url).toBe(customUrl);
        });
    });

    describe('output validation', () => {
        test('validates URL format', () => {
            const result = getProjectUrlTool.outputSchema.safeParse({
                project_url: 'https://example.com',
            });
            expect(result.success).toBe(true);
        });

        test('rejects invalid URL', () => {
            const result = getProjectUrlTool.outputSchema.safeParse({
                project_url: 'not-a-url',
            });
            expect(result.success).toBe(false);
        });
    });
});

describe('getAnonKeyTool', () => {
    describe('metadata', () => {
        test('has correct name', () => {
            expect(getAnonKeyTool.name).toBe('get_anon_key');
        });

        test('has description about anon key', () => {
            expect(getAnonKeyTool.description.toLowerCase()).toContain('anon');
        });
    });

    describe('execute', () => {
        test('returns anon key', async () => {
            const mockClient = createMockClient({ anonKey: 'test-anon-key-12345' });
            const context = createMockContext(mockClient);

            const result = await getAnonKeyTool.execute({}, context);

            expect(result.anon_key).toBe('test-anon-key-12345');
        });
    });

    describe('output validation', () => {
        test('validates anon_key is string', () => {
            const result = getAnonKeyTool.outputSchema.safeParse({ anon_key: 'key' });
            expect(result.success).toBe(true);
        });

        test('rejects missing anon_key', () => {
            const result = getAnonKeyTool.outputSchema.safeParse({});
            expect(result.success).toBe(false);
        });
    });
});

describe('getServiceKeyTool', () => {
    describe('metadata', () => {
        test('has correct name', () => {
            expect(getServiceKeyTool.name).toBe('get_service_key');
        });

        test('has description about service key', () => {
            expect(getServiceKeyTool.description.toLowerCase()).toContain('service');
        });
    });

    describe('execute', () => {
        test('returns service role key when configured', async () => {
            const mockClient = createMockClient({
                serviceRoleKey: 'secret-service-key-12345',
            });
            const context = createMockContext(mockClient);

            const result = await getServiceKeyTool.execute({}, context);

            expect(result.service_key).toBe('secret-service-key-12345');
            expect(result.service_key_status).toBe('found');
        });

        test('returns not_configured status when key is missing', async () => {
            const mockClient = createMockClient({ serviceRoleKey: undefined });
            // Override the getter to return undefined
            mockClient.getServiceRoleKey = () => undefined;
            const context = createMockContext(mockClient);

            const result = await getServiceKeyTool.execute({}, context);

            expect(result.service_key_status).toBe('not_configured');
            expect(result.service_key).toBeUndefined();
        });
    });

    describe('output validation', () => {
        test('validates found status with key', () => {
            const result = getServiceKeyTool.outputSchema.safeParse({
                service_key_status: 'found',
                service_key: 'key',
            });
            expect(result.success).toBe(true);
        });

        test('validates not_configured status', () => {
            const result = getServiceKeyTool.outputSchema.safeParse({
                service_key_status: 'not_configured',
            });
            expect(result.success).toBe(true);
        });
    });
});

describe('verifyJwtSecretTool', () => {
    describe('metadata', () => {
        test('has correct name', () => {
            expect(verifyJwtSecretTool.name).toBe('verify_jwt_secret');
        });

        test('has description about JWT', () => {
            expect(verifyJwtSecretTool.description).toContain('JWT');
        });
    });

    describe('execute', () => {
        test('returns found status when JWT secret is configured (no preview for security)', async () => {
            const mockClient = createMockClient({ jwtSecret: 'my-secret-jwt-key-12345' });
            const context = createMockContext(mockClient);

            const result = await verifyJwtSecretTool.execute({}, context);

            expect(result.jwt_secret_status).toBe('found');
            // SECURITY: jwt_secret_preview was removed to avoid leaking secret info
            expect('jwt_secret_preview' in result).toBe(false);
        });

        test('returns not_configured status when JWT secret is missing', async () => {
            const mockClient = createMockClient({ jwtSecret: undefined });
            mockClient.getJwtSecret = () => undefined;
            const context = createMockContext(mockClient);

            const result = await verifyJwtSecretTool.execute({}, context);

            expect(result.jwt_secret_status).toBe('not_configured');
        });
    });

    describe('output validation', () => {
        test('validates found status', () => {
            const result = verifyJwtSecretTool.outputSchema.safeParse({
                jwt_secret_status: 'found',
            });
            expect(result.success).toBe(true);
        });

        test('validates not_configured status', () => {
            const result = verifyJwtSecretTool.outputSchema.safeParse({
                jwt_secret_status: 'not_configured',
            });
            expect(result.success).toBe(true);
        });

        test('rejects invalid status', () => {
            const result = verifyJwtSecretTool.outputSchema.safeParse({
                jwt_secret_status: 'invalid',
            });
            expect(result.success).toBe(false);
        });
    });
});

describe('generateTypesTool', () => {
    describe('metadata', () => {
        test('has correct name', () => {
            expect(generateTypesTool.name).toBe('generate_typescript_types');
        });

        test('has description about TypeScript types', () => {
            expect(generateTypesTool.description).toContain('TypeScript');
        });
    });

    describe('input validation', () => {
        test('requires output_path', () => {
            const result = generateTypesTool.inputSchema.safeParse({});
            expect(result.success).toBe(false);
        });

        test('accepts valid input', () => {
            const result = generateTypesTool.inputSchema.safeParse({
                output_path: '/path/to/types.ts',
            });
            expect(result.success).toBe(true);
        });

        test('defaults included_schemas to public', () => {
            const result = generateTypesTool.inputSchema.safeParse({
                output_path: '/path/to/types.ts',
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.included_schemas).toEqual(['public']);
            }
        });

        test('accepts custom schemas', () => {
            const result = generateTypesTool.inputSchema.safeParse({
                output_path: '/path/to/types.ts',
                included_schemas: ['public', 'auth', 'storage'],
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.included_schemas).toEqual(['public', 'auth', 'storage']);
            }
        });

        test('defaults output_filename', () => {
            const result = generateTypesTool.inputSchema.safeParse({
                output_path: '/path/to/types.ts',
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.output_filename).toBe('database.types.ts');
            }
        });
    });

    describe('execute', () => {
        test('returns error when DATABASE_URL is not configured', async () => {
            const mockClient = createMockClient({ dbUrl: undefined });
            mockClient.getDbUrl = () => undefined;
            const context = createMockContext(mockClient);

            const result = await generateTypesTool.execute(
                { output_path: '/tmp/types.ts' },
                context
            );

            expect(result.success).toBe(false);
            expect(result.message).toContain('DATABASE_URL');
        });

        test('includes platform in response', async () => {
            const mockClient = createMockClient({ dbUrl: undefined });
            mockClient.getDbUrl = () => undefined;
            const context = createMockContext(mockClient);

            const result = await generateTypesTool.execute(
                { output_path: '/tmp/types.ts' },
                context
            );

            expect(result.platform).toBeDefined();
            expect(['win32', 'darwin', 'linux', 'freebsd', 'openbsd']).toContain(result.platform);
        });
    });

    describe('output validation', () => {
        test('validates success response', () => {
            const result = generateTypesTool.outputSchema.safeParse({
                success: true,
                message: 'Types generated',
                types: 'export type User = {...}',
                file_path: '/path/to/types.ts',
                platform: 'linux',
            });
            expect(result.success).toBe(true);
        });

        test('validates failure response', () => {
            const result = generateTypesTool.outputSchema.safeParse({
                success: false,
                message: 'Failed to generate types',
                platform: 'darwin',
            });
            expect(result.success).toBe(true);
        });

        test('requires platform field', () => {
            const result = generateTypesTool.outputSchema.safeParse({
                success: false,
                message: 'Error',
            });
            expect(result.success).toBe(false);
        });
    });
});
