import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validityDisplay, roleLabel } from '../../frontend/src/account-display.js';

test('account validity labels use the last valid Beijing date, not session expiry or browser timezone', () => {
    const until = Date.parse('2026-10-12T00:00:00+08:00');
    assert.deepEqual(validityDisplay(null), { label: '长期有效', state: 'permanent' });
    assert.deepEqual(validityDisplay(until, Date.parse('2026-09-28T00:00:00Z')), {
        label: '到期 2026-10-11',
        state: 'active',
    });
    assert.equal(validityDisplay(until, until - 7 * 86400000).state, 'expiring');
    assert.equal(validityDisplay(until, until - 1).state, 'expiring');
    assert.deepEqual(validityDisplay(until, until), {
        label: '已到期 2026-10-11',
        state: 'expired',
    });
    for (const bad of [undefined, NaN, 0, -1, Number.MAX_SAFE_INTEGER, '2026-10-11'])
        assert.equal(validityDisplay(bad).state, 'unknown');
    assert.equal(roleLabel('superadmin'), '超管');
    assert.equal(roleLabel('studio_admin'), '总台');
    assert.equal(roleLabel('member'), '员工');
    assert.equal(roleLabel('bad'), '账号');
});
