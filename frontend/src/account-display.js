export const roleLabel = (role) =>
    ({ superadmin: '超管', studio_admin: '总台', member: '子账号' })[role] || '账号';

// Account validity is separate from the eight-hour login session. Display dates
// in the billing timezone, including the last valid instant of the chosen day.
const day = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});
export function validityDisplay(validUntil, now = Date.now()) {
    if (validUntil === null) return { label: '长期有效', state: 'permanent' };
    if (!Number.isSafeInteger(validUntil) || validUntil <= 0 || validUntil > 8640000000000000)
        return { label: '有效期待确认', state: 'unknown' };
    const date = day.format(new Date(validUntil - 1));
    if (validUntil <= now) return { label: `已到期 ${date}`, state: 'expired' };
    return {
        label: `到期 ${date}`,
        state: validUntil - now <= 7 * 86400000 ? 'expiring' : 'active',
    };
}
