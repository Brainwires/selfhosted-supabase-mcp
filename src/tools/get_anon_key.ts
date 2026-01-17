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
const GetAnonKeyInputSchema = z.object({
    reveal: z.boolean().optional().default(false).describe(
        'Set to true to reveal the full anon key. Default is false (masked).'
    ),
});
type GetAnonKeyInput = z.infer<typeof GetAnonKeyInputSchema>;

// Output schema
const GetAnonKeyOutputSchema = z.object({
    anon_key: z.string(),
    masked: z.boolean().describe('Whether the returned key is masked.'),
});

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        reveal: {
            type: 'boolean',
            default: false,
            description: 'Set to true to reveal the full anon key. Default is false (masked).',
        },
    },
    required: [],
};

// The tool definition
export const getAnonKeyTool = {
    name: 'get_anon_key',
    description: 'Returns the configured Supabase anon key for this server. ' +
        'By default, the key is masked for security. Use reveal=true to get the full key.',
    inputSchema: GetAnonKeyInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: GetAnonKeyOutputSchema,
    execute: async (input: GetAnonKeyInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const key = client.getAnonKey();

        if (input.reveal) {
            return { anon_key: key, masked: false };
        }
        return { anon_key: maskKey(key), masked: true };
    },
}; 