import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { loginSchema } from './accounts.js';
import { fail } from './protocol.js';

export function authRoutes(accounts, config) {
    const router = Router();
    const limit = rateLimit({
        windowMs: 15 * 60000,
        limit: config.loginLimit || 10,
        skipSuccessfulRequests: true,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: '登录尝试过多，请稍后再试' },
    });
    router.post('/login', limit, (req, res, next) => {
        const result = loginSchema.safeParse(req.body);
        if (!result.success) return next(fail(422, '请输入有效账号和密码'));
        req.body = result.data;
        accounts.passport.authenticate('local', { session: false }, async (error, user) => {
            try {
                if (error) throw error;
                if (!user) {
                    await accounts.audit('login_failed', null, req.socket.remoteAddress);
                    throw fail(401, '账号或密码错误');
                }
                const session = await accounts.login(user, req.socket.remoteAddress);
                res.cookie(accounts.cookieName(), session.token, accounts.cookieOptions()).json(
                    session,
                );
            } catch (e) {
                next(e);
            }
        })(req, res, next);
    });
    router.use(accounts.requireLogin());
    router.get('/me', async (req, res) => res.json({ user: await accounts.publicUser(req.user) }));
    router.post('/logout', async (req, res) => {
        await accounts.logout(req.user, req.socket.remoteAddress);
        res.clearCookie(accounts.cookieName(), {
            ...accounts.cookieOptions(),
            maxAge: undefined,
        }).json({ success: true });
    });
    router.post('/change-password', limit, async (req, res) => {
        await accounts.changePassword(req.user, req.body, req.socket.remoteAddress);
        res.clearCookie(accounts.cookieName(), {
            ...accounts.cookieOptions(),
            maxAge: undefined,
        }).json({ success: true });
    });
    return router;
}
