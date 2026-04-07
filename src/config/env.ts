import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const booleanFromEnv = z.preprocess((value) => {
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') {
            return true;
        }
        if (normalized === 'false') {
            return false;
        }
    }

    return value;
}, z.boolean());

const uploadPrincipalSchema = z.object({
    username: z.string().trim().min(1),
    passwordHash: z.string().trim().startsWith('$argon2'),
});

const uploadPrincipalsFromEnv = z
    .preprocess((value) => {
        if (typeof value !== 'string') {
            return value;
        }

        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }, z.array(uploadPrincipalSchema).min(1))
    .superRefine((principals, context) => {
        const seenUsernames = new Set<string>();

        principals.forEach((principal, index) => {
            const normalizedUsername = principal.username.toLowerCase();
            if (seenUsernames.has(normalizedUsername)) {
                context.addIssue({
                    code: 'custom',
                    message: 'Upload principal usernames must be unique.',
                    path: [index, 'username'],
                });
                return;
            }

            seenUsernames.add(normalizedUsername);
        });
    });

const envSchema = z.object({
    NODE_ENV: z
        .enum(['development', 'test', 'production'])
        .default('development'),
    HOST: z.string().trim().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
    LOCAL_ASSETS_ROOT: z
        .string()
        .min(1)
        .transform((value) => path.resolve(value)),
    TRUST_PROXY: booleanFromEnv.default(false),
    JWT_SECRET: z.string().min(32),
    UPLOAD_PRINCIPALS: uploadPrincipalsFromEnv,
    UPLOAD_MAX_BYTES: z.coerce
        .number()
        .int()
        .positive()
        .default(50 * 1024 * 1024),
    UPLOAD_MAX_FILES_IN_ZIP: z.coerce.number().int().positive().default(500),
    UPLOAD_MAX_CONCURRENT: z.coerce.number().int().positive().default(2),
    UNLOCK_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
    ADMIN_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
});

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Parses and validates raw environment variables into application config.
 */
export function loadEnv(rawEnv: NodeJS.ProcessEnv = process.env): AppConfig {
    if (rawEnv === process.env && existsSync(path.join(process.cwd(), '.env'))) {
        process.loadEnvFile?.();
    }

    return envSchema.parse(rawEnv);
}
