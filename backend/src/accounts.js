import { EventEmitter } from 'node:events';
import { hkdfSync, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import { Passport } from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import jwtPackage from 'passport-jwt';
import { parseCookie } from 'cookie';
import { z } from 'zod';
import { fail } from './protocol.js';
import { assignAccountApkId } from './account-apk.js';

const { Strategy: JwtStrategy, ExtractJwt } = jwtPackage;
export const loginSchema = z
    .object({
        username: z
            .string()
            .regex(/^[a-zA-Z0-9_]{3,32}$/)
            .transform((v) => v.toLowerCase()),
        password: z.string().min(1),
    })
    .strict();
export const installationSchema = z
    .object({
        username: z
            .string()
            .regex(/^[a-zA-Z0-9_]{3,32}$/)
            .transform((v) => v.toLowerCase()),
        password: z.string().min(1),
        confirmPassword: z.string().min(1),
    })
    .strict()
    .refine((value) => value.password === value.confirmPassword, {
        message: '两次输入的密码不一致',
        path: ['confirmPassword'],
    });
const hashPassword = (value) =>
    argon2.hash(value, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
const SESSION_SECONDS = 8 * 3600;
const validAccount = (user) =>
    user.valid_until === null ||
    (Number.isSafeInteger(user.valid_until) &&
        user.valid_until <= 8640000000000000 &&
        user.valid_until > Date.now());

export class Accounts extends EventEmitter {
    constructor(db, config, masterKey) {
        super();
        this.db = db;
        this.config = config;
        this.key = Buffer.from(hkdfSync('sha256', masterKey, 'boundary', 'account-jwt-v1', 32));
        this.passport = new Passport();
        this.passport.use(
            new LocalStrategy((username, password, done) => {
                this.checkPassword(username, password)
                    .then((user) => done(null, user || false))
                    .catch(done);
            }),
        );
        this.passport.use(
            new JwtStrategy(
                {
                    jwtFromRequest: (req) =>
                        req.headers.authorization
                            ? ExtractJwt.fromAuthHeaderAsBearerToken()(req)
                            : parseCookie(req.headers.cookie || '')[this.cookieName()] || null,
                    secretOrKey: this.key,
                    algorithms: ['HS256'],
                    issuer: 'boundary-accounts',
                    audience: 'boundary-http',
                },
                (payload, done) => {
                    this.resolveSession(payload)
                        .then((user) => done(null, user))
                        .catch((e) => (e.status === 401 ? done(null, false) : done(e)));
                },
            ),
        );
    }
    cookieName() {
        return `boundary_session_${new URL(this.config.origin).port || 'default'}`;
    }
    cookieOptions() {
        return {
            httpOnly: true,
            sameSite: 'strict',
            secure: this.config.origin.startsWith('https:'),
            path: '/api',
            maxAge: SESSION_SECONDS * 1000,
        };
    }
    async publicUser(row) {
        return {
            id: row.id,
            username: row.username,
            role: row.role,
            expiresAt: row.session_expires_at,
            validUntil: row.valid_until,
            apkId: row.apk_id,
        };
    }
    async initialize({ seedDefault = false } = {}) {
        if (
            seedDefault &&
            !(await this.db('node_migrations').where('name', '003_superadmin_seed').first())
        ) {
            const password_hash = await hashPassword('mtx123');
            await this.db.transaction(async (trx) => {
                if (await trx('node_migrations').where('name', '003_superadmin_seed').first())
                    return;
                if (!(await trx('accounts').first())) {
                    const [id] = await trx('accounts').insert({
                        username: 'mtx',
                        password_hash,
                        role: 'superadmin',
                        enabled: true,
                        created_at: Date.now(),
                    });
                    await assignAccountApkId(trx, { id }, this.config.projectId);
                }
                await trx('node_migrations').insert({
                    name: '003_superadmin_seed',
                    created_at: new Date().toISOString(),
                });
            });
        }
        // Preserve old APK routes for installed artifacts; expose one canonical ID per account.
        await this.db.transaction(async (trx) => {
            for (const account of await trx('accounts').whereNull('apk_id').orderBy('id'))
                await assignAccountApkId(trx, account, this.config.projectId);
        });
        // A fixed-cost verification is still performed for unknown usernames.
        this.dummyHash = await hashPassword(randomUUID());
    }
    async install(input, ip) {
        const data = installationSchema.parse(input);
        const password_hash = await hashPassword(data.password);
        return await this.db.transaction(async (trx) => {
            if (await trx('accounts').first()) throw fail(409, '系统已完成初始化安装');
            const [id] = await trx('accounts').insert({
                username: data.username,
                password_hash,
                role: 'superadmin',
                enabled: true,
                created_at: Date.now(),
            });
            await assignAccountApkId(trx, { id }, this.config.projectId);
            if (!(await trx('node_migrations').where('name', '003_superadmin_seed').first()))
                await trx('node_migrations').insert({
                    name: '003_superadmin_seed',
                    created_at: new Date().toISOString(),
                });
            await this.audit('installed', id, ip, trx);
            return await trx('accounts').where('id', id).first();
        });
    }
    async checkPassword(username, password) {
        const user = await this.db('accounts').where('username', username.toLowerCase()).first();
        const matches = await argon2.verify(user?.password_hash || this.dummyHash, password);
        return matches && user?.enabled && user.role === 'superadmin' ? user : null;
    }
    async resolveSession(payload, db = this.db) {
        if (
            !payload?.sub ||
            typeof payload.sid !== 'string' ||
            !Number.isFinite(payload.exp) ||
            payload.exp * 1000 <= Date.now()
        )
            throw fail(401, '登录状态已失效，请重新登录');
        const user = await db('accounts').where('id', Number(payload.sub)).first();
        if (
            !user?.enabled ||
            user.role !== 'superadmin' ||
            user.session_id !== payload.sid ||
            user.session_expires_at <= Date.now() ||
            !validAccount(user)
        )
            throw fail(401, '登录状态已失效，请重新登录');
        return user;
    }
    async sign(user, audience, ttl = SESSION_SECONDS) {
        return new SignJWT({ sid: user.session_id })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuer('boundary-accounts')
            .setAudience(audience)
            .setSubject(String(user.id))
            .setIssuedAt()
            .setExpirationTime(
                Math.min(
                    Math.floor(user.session_expires_at / 1000),
                    Math.floor(Date.now() / 1000) + ttl,
                ),
            )
            .sign(this.key);
    }
    async login(verified, ip) {
        const user = await this.db.transaction(async (trx) => {
            const current = await trx('accounts').where('id', verified.id).first();
            if (
                !current?.enabled ||
                current.role !== 'superadmin' ||
                current.password_hash !== verified.password_hash
            )
                throw fail(401, '账号或密码错误');
            if (!validAccount(current)) throw fail(401, '账号已到期，请联系管理员续费');
            const session_id = randomUUID(),
                session_expires_at = Math.min(
                    Date.now() + SESSION_SECONDS * 1000,
                    current.valid_until ?? Infinity,
                );
            await trx('accounts')
                .where('id', current.id)
                .update({ session_id, session_expires_at });
            await this.audit('login', current.id, ip, trx);
            return { ...current, session_id, session_expires_at };
        });
        this.emit('sessionChanged', {
            userId: user.id,
            reason: 'kicked',
            keepSid: user.session_id,
        });
        return {
            token: await this.sign(user, 'boundary-http'),
            expiresIn: Math.max(0, Math.floor((user.session_expires_at - Date.now()) / 1000)),
            user: await this.publicUser(user),
        };
    }
    async logout(user, ip) {
        await this.db('accounts')
            .where({ id: user.id, session_id: user.session_id })
            .update({ session_id: null, session_expires_at: null });
        await this.audit('logout', user.id, ip);
        // A delayed logout for an old session never kicks a newer login.
        this.emit('sessionChanged', {
            userId: user.id,
            reason: 'session_expired',
            onlySid: user.session_id,
        });
    }
    requireLogin() {
        return (req, res, next) =>
            this.passport.authenticate('jwt', { session: false }, (error, user) => {
                if (error) return next(error);
                if (!user) return next(fail(401, '请登录或重新登录'));
                req.user = user;
                next();
            })(req, res, next);
    }
    async panelTicket(user) {
        return {
            token: await this.sign(user, 'boundary-panel', 600),
            expiresIn: 600,
            mode: 'authenticated-local',
        };
    }
    async verifyPanel(token) {
        try {
            const { payload } = await jwtVerify(token, this.key, {
                algorithms: ['HS256'],
                issuer: 'boundary-accounts',
                audience: 'boundary-panel',
            });
            const user = await this.resolveSession(payload);
            return { ...payload, role: 'panel', user };
        } catch (e) {
            if (e.status) throw e;
            throw fail(401, '连接凭证已失效');
        }
    }
    async changePassword(user, input, ip) {
        const data = z
            .object({
                oldPassword: z.string().min(1).max(128),
                newPassword: z.string().min(6).max(128),
            })
            .strict()
            .parse(input);
        if (!(await argon2.verify(user.password_hash, data.oldPassword)))
            throw fail(422, '原密码不匹配');
        const password_hash = await hashPassword(data.newPassword);
        await this.db.transaction(async (trx) => {
            await this.resolveSession(
                {
                    sub: String(user.id),
                    sid: user.session_id,
                    exp: Math.floor(user.session_expires_at / 1000),
                },
                trx,
            );
            const current = await trx('accounts').where('id', user.id).first();
            if (current.password_hash !== user.password_hash) throw fail(401, '登录状态已变更');
            await trx('accounts')
                .where('id', user.id)
                .update({ password_hash, session_id: null, session_expires_at: null });
            await this.audit('password_changed', user.id, ip, trx);
        });
        this.emit('sessionChanged', { userId: user.id, reason: 'password_changed' });
    }
    async audit(event, actorId = null, ip = null, db = this.db) {
        await db('account_audit').insert({ ts: Date.now(), actor_id: actorId, event, ip });
    }
}
