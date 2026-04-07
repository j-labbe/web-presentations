import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/env.js';

export const ADMIN_SESSION_COOKIE = 'admin_session';

const ADMIN_JWT_ISSUER = 'presentations-admin';
const ADMIN_JWT_AUDIENCE = 'presentations-admin';

const LOGIN_RATE_LIMIT = {
    max: 10,
    timeWindow: '1 minute',
} as const;

const missingPrincipalPasswordHashPromise = argon2.hash(
    'missing-admin-principal-fallback'
);

function getJwtSecretKey(secret: string): Uint8Array {
    return new TextEncoder().encode(secret);
}

async function verifyAdminJwt(
    token: string,
    secret: string
): Promise<{ sub: string; exp: number } | null> {
    try {
        const { payload } = await jwtVerify(token, getJwtSecretKey(secret), {
            algorithms: ['HS256'],
            issuer: ADMIN_JWT_ISSUER,
            audience: ADMIN_JWT_AUDIENCE,
        });
        if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
            return null;
        }
        const exp = payload.exp;
        if (typeof exp !== 'number') {
            return null;
        }
        return { sub: payload.sub, exp };
    } catch {
        return null;
    }
}

export type AdminAuthConfig = Pick<
    AppConfig,
    'NODE_ENV' | 'JWT_SECRET' | 'ADMIN_TOKEN_TTL_SECONDS' | 'UPLOAD_PRINCIPALS'
>;

/**
 * Registers the admin login endpoint and returns the requireAdminAuth
 * preHandler hook factory.
 */
export function registerAdminAuth(
    app: FastifyInstance,
    config: AdminAuthConfig
): void {
    app.post(
        '/admin/auth/login',
        {
            config: {
                rateLimit: LOGIN_RATE_LIMIT,
            },
        },
        async (request, reply) => {
            const body = request.body as
                | { username?: string; password?: string }
                | undefined;
            const username = body?.username;
            const password = body?.password;

            if (
                typeof username !== 'string' ||
                !username.trim() ||
                typeof password !== 'string' ||
                !password
            ) {
                return reply
                    .code(400)
                    .send({ error: 'Username and password are required' });
            }

            const principal = config.UPLOAD_PRINCIPALS.find(
                (p) => p.username.toLowerCase() === username.toLowerCase()
            );
            const passwordHash =
                principal?.passwordHash ??
                (await missingPrincipalPasswordHashPromise);
            const passwordMatches = await argon2
                .verify(passwordHash, password)
                .catch(() => false);

            if (!principal || !passwordMatches) {
                return reply.code(401).send({ error: 'Invalid credentials' });
            }

            const jwt = await new SignJWT({})
                .setProtectedHeader({ alg: 'HS256' })
                .setSubject(principal.username)
                .setIssuedAt()
                .setIssuer(ADMIN_JWT_ISSUER)
                .setAudience(ADMIN_JWT_AUDIENCE)
                .setExpirationTime(`${config.ADMIN_TOKEN_TTL_SECONDS}s`)
                .sign(getJwtSecretKey(config.JWT_SECRET));

            const expiresAt = new Date(
                Date.now() + config.ADMIN_TOKEN_TTL_SECONDS * 1000
            );

            reply.setCookie(ADMIN_SESSION_COOKIE, jwt, {
                httpOnly: true,
                sameSite: 'lax',
                secure: config.NODE_ENV === 'production',
                path: '/admin',
                maxAge: config.ADMIN_TOKEN_TTL_SECONDS,
            });

            return reply.send({
                username: principal.username,
                expiresAt: expiresAt.toISOString(),
            });
        }
    );

    app.post('/admin/auth/logout', async (_request, reply) => {
        reply.clearCookie(ADMIN_SESSION_COOKIE, { path: '/admin' });
        return reply.code(204).send();
    });

    app.get('/admin/auth/session', async (request, reply) => {
        const token = request.cookies[ADMIN_SESSION_COOKIE];
        if (typeof token !== 'string' || !token) {
            return reply.code(401).send({ error: 'Not authenticated' });
        }

        const verified = await verifyAdminJwt(token, config.JWT_SECRET);
        if (!verified) {
            return reply.code(401).send({ error: 'Invalid or expired session' });
        }

        return reply.send({
            username: verified.sub,
            expiresAt: new Date(verified.exp * 1000).toISOString(),
        });
    });
}

/**
 * Fastify preHandler that verifies the admin JWT from the session cookie or
 * Authorization bearer token.
 */
export function requireAdminAuth(
    config: Pick<AppConfig, 'JWT_SECRET'>
): (
    request: FastifyRequest,
    reply: FastifyReply,
    done?: () => void
) => Promise<void> {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        let token: string | undefined;

        const cookieToken = request.cookies[ADMIN_SESSION_COOKIE];
        if (typeof cookieToken === 'string' && cookieToken.length > 0) {
            token = cookieToken;
        } else {
            const raw = request.headers.authorization;
            if (!raw) {
                return reply.code(401).send({ error: 'Not authenticated' });
            }

            const [scheme, bearerToken] = raw.split(' ');
            if (scheme?.toLowerCase() !== 'bearer' || !bearerToken) {
                return reply.code(401).send({ error: 'Invalid authorization header' });
            }

            token = bearerToken;
        }

        const verified = await verifyAdminJwt(token, config.JWT_SECRET);
        if (!verified) {
            return reply.code(401).send({ error: 'Invalid or expired token' });
        }

        (request as FastifyRequest & { adminUser?: string }).adminUser =
            verified.sub;
    };
}
