/**
 * Audit Logger for selfhosted-supabase-mcp
 *
 * Provides structured audit logging for sensitive operations.
 * Logs to stderr by default, can optionally write to a file.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export type AuditLevel = 'info' | 'warn' | 'error' | 'security';

export interface AuditEntry {
    timestamp: string;
    level: AuditLevel;
    tool: string;
    action: string;
    details?: Record<string, unknown>;
    sanitizedParams?: Record<string, unknown>;
    result?: 'success' | 'failure' | 'blocked';
    error?: string;
}

export interface AuditLoggerOptions {
    enabled: boolean;
    logFile?: string; // Optional path to write audit logs
    logToStderr?: boolean; // Default: true
    sensitiveFields?: string[]; // Fields to redact from params
}

const DEFAULT_SENSITIVE_FIELDS = [
    'password',
    'secret',
    'key',
    'token',
    'credential',
    'api_key',
    'apiKey',
    'authorization',
    'auth',
];

/**
 * Sanitizes an object by redacting sensitive fields
 */
function sanitizeObject(
    obj: Record<string, unknown>,
    sensitiveFields: string[]
): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();
        const isSensitive = sensitiveFields.some(
            (field) => lowerKey.includes(field.toLowerCase())
        );

        if (isSensitive) {
            result[key] = '[REDACTED]';
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            result[key] = sanitizeObject(value as Record<string, unknown>, sensitiveFields);
        } else if (typeof value === 'string' && value.length > 100) {
            // Truncate long strings (like SQL queries) for audit log readability
            result[key] = `${value.substring(0, 100)}... [truncated]`;
        } else {
            result[key] = value;
        }
    }

    return result;
}

/**
 * Audit Logger class for tracking sensitive operations
 */
export class AuditLogger {
    private options: Required<AuditLoggerOptions>;
    private logStream: fs.WriteStream | null = null;

    constructor(options: Partial<AuditLoggerOptions> = {}) {
        this.options = {
            enabled: options.enabled ?? true,
            logFile: options.logFile ?? '',
            logToStderr: options.logToStderr ?? true,
            sensitiveFields: options.sensitiveFields ?? DEFAULT_SENSITIVE_FIELDS,
        };

        if (this.options.logFile) {
            try {
                const logDir = path.dirname(this.options.logFile);
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }
                this.logStream = fs.createWriteStream(this.options.logFile, { flags: 'a' });
            } catch (error) {
                console.error(`Failed to open audit log file: ${error}`);
            }
        }
    }

    /**
     * Log an audit entry
     */
    log(entry: Omit<AuditEntry, 'timestamp'>): void {
        if (!this.options.enabled) return;

        const fullEntry: AuditEntry = {
            ...entry,
            timestamp: new Date().toISOString(),
        };

        // Sanitize params if provided
        if (entry.sanitizedParams) {
            fullEntry.sanitizedParams = sanitizeObject(
                entry.sanitizedParams as Record<string, unknown>,
                this.options.sensitiveFields
            );
        }

        const logLine = JSON.stringify(fullEntry);

        if (this.options.logToStderr) {
            const prefix = entry.level === 'security' ? '🔒 AUDIT' : 'AUDIT';
            console.error(`[${prefix}] ${logLine}`);
        }

        if (this.logStream) {
            this.logStream.write(logLine + '\n');
        }
    }

    /**
     * Log a tool execution
     */
    logToolExecution(
        tool: string,
        params: Record<string, unknown>,
        result: 'success' | 'failure' | 'blocked',
        error?: string
    ): void {
        this.log({
            level: result === 'blocked' ? 'security' : result === 'failure' ? 'error' : 'info',
            tool,
            action: 'execute',
            sanitizedParams: params,
            result,
            error,
        });
    }

    /**
     * Log a security-relevant event
     */
    logSecurityEvent(tool: string, action: string, details?: Record<string, unknown>): void {
        this.log({
            level: 'security',
            tool,
            action,
            details,
        });
    }

    /**
     * Log a blocked operation (e.g., missing confirmation)
     */
    logBlocked(tool: string, reason: string, params?: Record<string, unknown>): void {
        this.log({
            level: 'warn',
            tool,
            action: 'blocked',
            details: { reason },
            sanitizedParams: params,
            result: 'blocked',
        });
    }

    /**
     * Close the log stream
     */
    close(): void {
        if (this.logStream) {
            this.logStream.end();
            this.logStream = null;
        }
    }
}

// Singleton instance for convenience
let defaultLogger: AuditLogger | null = null;

/**
 * Get or create the default audit logger
 */
export function getAuditLogger(options?: Partial<AuditLoggerOptions>): AuditLogger {
    if (!defaultLogger) {
        defaultLogger = new AuditLogger(options);
    }
    return defaultLogger;
}

/**
 * Configure the default audit logger
 */
export function configureAuditLogger(options: Partial<AuditLoggerOptions>): void {
    if (defaultLogger) {
        defaultLogger.close();
    }
    defaultLogger = new AuditLogger(options);
}
