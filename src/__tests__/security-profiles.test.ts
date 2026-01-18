import { describe, test, expect } from 'bun:test';
import { SECURITY_PROFILES, getProfileTools, isValidProfile } from '../security-profiles.js';

describe('Security Profiles', () => {
    describe('SECURITY_PROFILES', () => {
        test('readonly profile exists and has expected properties', () => {
            expect(SECURITY_PROFILES.readonly).toBeDefined();
            expect(SECURITY_PROFILES.readonly.name).toBe('readonly');
            expect(SECURITY_PROFILES.readonly.enabledTools).toBeArray();
        });

        test('standard profile exists and has expected properties', () => {
            expect(SECURITY_PROFILES.standard).toBeDefined();
            expect(SECURITY_PROFILES.standard.name).toBe('standard');
            expect(SECURITY_PROFILES.standard.enabledTools).toBeArray();
        });

        test('admin profile exists and has expected properties', () => {
            expect(SECURITY_PROFILES.admin).toBeDefined();
            expect(SECURITY_PROFILES.admin.name).toBe('admin');
            expect(SECURITY_PROFILES.admin.enabledTools).toBeArray();
        });
    });

    describe('Tool hierarchy', () => {
        test('readonly profile contains list_tables', () => {
            expect(SECURITY_PROFILES.readonly.enabledTools).toContain('list_tables');
        });

        test('readonly profile does not contain destructive tools', () => {
            const destructiveTools = [
                'apply_migration',
                'create_index',
                'drop_index',
                'delete_storage_bucket',
            ];
            for (const tool of destructiveTools) {
                expect(SECURITY_PROFILES.readonly.enabledTools).not.toContain(tool);
            }
        });

        test('standard profile includes all readonly tools', () => {
            for (const tool of SECURITY_PROFILES.readonly.enabledTools) {
                expect(SECURITY_PROFILES.standard.enabledTools).toContain(tool);
            }
        });

        test('admin profile includes all standard tools', () => {
            for (const tool of SECURITY_PROFILES.standard.enabledTools) {
                expect(SECURITY_PROFILES.admin.enabledTools).toContain(tool);
            }
        });

        test('admin profile includes destructive tools', () => {
            const adminOnlyTools = [
                'apply_migration',
                'generate_user_token',
                'get_service_key',
                'revoke_session',
            ];
            for (const tool of adminOnlyTools) {
                expect(SECURITY_PROFILES.admin.enabledTools).toContain(tool);
            }
        });
    });

    describe('getProfileTools', () => {
        test('returns tools for valid profiles', () => {
            expect(getProfileTools('readonly')).toEqual(SECURITY_PROFILES.readonly.enabledTools);
            expect(getProfileTools('standard')).toEqual(SECURITY_PROFILES.standard.enabledTools);
            expect(getProfileTools('admin')).toEqual(SECURITY_PROFILES.admin.enabledTools);
        });

        test('returns null for custom profile', () => {
            expect(getProfileTools('custom')).toBeNull();
        });
    });

    describe('isValidProfile', () => {
        test('returns true for valid profiles', () => {
            expect(isValidProfile('readonly')).toBe(true);
            expect(isValidProfile('standard')).toBe(true);
            expect(isValidProfile('admin')).toBe(true);
            expect(isValidProfile('custom')).toBe(true);
        });

        test('returns false for invalid profiles', () => {
            expect(isValidProfile('invalid')).toBe(false);
            expect(isValidProfile('')).toBe(false);
            expect(isValidProfile('superadmin')).toBe(false);
        });
    });
});
