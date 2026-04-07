import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../../src/config/env.js';

const validEnv: NodeJS.ProcessEnv = {
    DATABASE_URL: 'file:./test.db',
    LOCAL_ASSETS_ROOT: './test-assets',
    JWT_SECRET: '01234567890123456789012345678901',
    UPLOAD_PRINCIPALS: JSON.stringify([
        {
            username: 'deploy-bot',
            passwordHash: '$argon2id$example-hash',
        },
    ]),
};

describe('loadEnv', () => {
    const originalEnv = process.env;

    afterEach(() => {
        process.env = originalEnv;
        vi.restoreAllMocks();
    });

    it('applies defaults for optional configuration', () => {
        const config = loadEnv(validEnv);

        expect(config.NODE_ENV).toBe('development');
        expect(config.HOST).toBe('127.0.0.1');
        expect(config.PORT).toBe(3000);
        expect(config.LOCAL_ASSETS_ROOT).toBe(
            path.resolve('./test-assets')
        );
        expect(config.UPLOAD_MAX_BYTES).toBe(50 * 1024 * 1024);
        expect(config.UPLOAD_MAX_FILES_IN_ZIP).toBe(500);
        expect(config.UPLOAD_MAX_CONCURRENT).toBe(2);
        expect(config.UNLOCK_TOKEN_TTL_SECONDS).toBe(3600);
        expect(config.TRUST_PROXY).toBe(false);
    });

    it('parses explicit numeric overrides', () => {
        const config = loadEnv({
            ...validEnv,
            NODE_ENV: 'production',
            HOST: '0.0.0.0',
            PORT: '8080',
            UPLOAD_MAX_BYTES: '2048',
            UPLOAD_MAX_FILES_IN_ZIP: '25',
            UPLOAD_MAX_CONCURRENT: '4',
            UNLOCK_TOKEN_TTL_SECONDS: '90',
        });

        expect(config.NODE_ENV).toBe('production');
        expect(config.HOST).toBe('0.0.0.0');
        expect(config.PORT).toBe(8080);
        expect(config.UPLOAD_MAX_BYTES).toBe(2048);
        expect(config.UPLOAD_MAX_FILES_IN_ZIP).toBe(25);
        expect(config.UPLOAD_MAX_CONCURRENT).toBe(4);
        expect(config.UNLOCK_TOKEN_TTL_SECONDS).toBe(90);
    });

    it('loads the default .env file when parsing process.env', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'envtest-'));
        const prevCwd = process.cwd();
        await writeFile(path.join(dir, '.env'), '');
        process.chdir(dir);
        process.env = { ...validEnv };
        const loadEnvFile = vi
            .spyOn(process, 'loadEnvFile')
            .mockImplementation(() => undefined);

        try {
            const config = loadEnv();
            expect(loadEnvFile).toHaveBeenCalledTimes(1);
            expect(config.DATABASE_URL).toBe(validEnv.DATABASE_URL);
        } finally {
            process.chdir(prevCwd);
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('does not load the default .env file when an env object is provided', () => {
        const loadEnvFile = vi
            .spyOn(process, 'loadEnvFile')
            .mockImplementation(() => undefined);

        const config = loadEnv(validEnv);

        expect(loadEnvFile).not.toHaveBeenCalled();
        expect(config.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    });

    it.each([
        {
            name: 'a required database URL is missing',
            env: {
                ...validEnv,
                DATABASE_URL: '',
            },
        },
        {
            name: 'the JWT secret is too short',
            env: {
                ...validEnv,
                JWT_SECRET: 'too-short',
            },
        },
        {
            name: 'LOCAL_ASSETS_ROOT is empty',
            env: {
                ...validEnv,
                LOCAL_ASSETS_ROOT: '',
            },
        },
        {
            name: 'the upload principals payload is invalid JSON',
            env: {
                ...validEnv,
                UPLOAD_PRINCIPALS: 'not-json',
            },
        },
        {
            name: 'an upload principal hash is malformed',
            env: {
                ...validEnv,
                UPLOAD_PRINCIPALS: JSON.stringify([
                    {
                        username: 'deploy-bot',
                        passwordHash: 'plain-text-password',
                    },
                ]),
            },
        },
        {
            name: 'upload principal usernames are duplicated',
            env: {
                ...validEnv,
                UPLOAD_PRINCIPALS: JSON.stringify([
                    {
                        username: 'deploy-bot',
                        passwordHash: '$argon2id$first',
                    },
                    {
                        username: 'DEPLOY-BOT',
                        passwordHash: '$argon2id$second',
                    },
                ]),
            },
        },
        {
            name: 'NODE_ENV is invalid',
            env: {
                ...validEnv,
                NODE_ENV: 'staging',
            },
        },
    ])('rejects invalid input when $name', ({ env }) => {
        expect(() => loadEnv(env)).toThrow();
    });
});
