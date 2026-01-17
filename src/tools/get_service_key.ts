import { z } from 'zod';
import type { SelfhostedSupabaseClient } from '../client/index.js';
import type { ToolContext } from './types.js';

/**
 * Masks a key, showing only the first and last few characters.
 * Example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." -> "eyJhb...J9.Xz"
 */
function maskKey(key: string, showStart: number = 5, showEnd: number = 4): string {
    if (key.length <= showStart + showEnd + 3) {
        return '*'.repeat(key.length); // Key too short to meaningfully mask
    }
    return `${key.substring(0, showStart)}...${key.substring(key.length - showEnd)}`;
}

// Input schema with reveal option
const GetServiceKeyInputSchema = z.object({
    reveal: z.boolean().optional().default(false).describe(
        'Set to true to reveal the full service key. Default is false (masked). ' +
        'WARNING: Only use this when you actually need the full key value.'
    ),
});
type GetServiceKeyInput = z.infer<typeof GetServiceKeyInputSchema>;

// Output schema
const GetServiceKeyOutputSchema = z.object({
    service_key_status: z.enum(['found', 'not_configured']).describe('Whether the service key was provided to the server.'),
    service_key: z.string().optional().describe('The configured Supabase service role key (masked unless reveal=true).'),
    masked: z.boolean().optional().describe('Whether the returned key is masked.'),
});

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        reveal: {
            type: 'boolean',
            default: false,
            description: 'Set to true to reveal the full service key. Default is false (masked). WARNING: Only use this when you actually need the full key value.',
        },
    },
    required: [],
};

// The tool definition
export const getServiceKeyTool = {
    name: 'get_service_key',
    description: 'Returns the configured Supabase service role key for this server, if available. ' +
        'By default, the key is masked for security. Use reveal=true to get the full key.',
    inputSchema: GetServiceKeyInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: GetServiceKeyOutputSchema,
    execute: async (input: GetServiceKeyInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const key = client.getServiceRoleKey();

        if (key) {
            if (input.reveal) {
                context.log?.('Service role key revealed - ensure this is intentional', 'warn');
                return {
                    service_key_status: 'found' as const,
                    service_key: key,
                    masked: false,
                };
            }
            return {
                service_key_status: 'found' as const,
                service_key: maskKey(key),
                masked: true,
            };
        }
        return { service_key_status: 'not_configured' as const };
    },
}; 