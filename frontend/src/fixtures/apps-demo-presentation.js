import { readAppsDemo } from './device-fixture-protocol.js';
import { matchInjectionDemo } from './injection-demo-match.js';
import { attachInjectionSubmissions } from './injection-submission-demo.js';

const actions = Object.freeze({
    open: { id: 'open', label: '打开', tone: 'default' },
    popup: { id: 'popup', label: '弹窗', tone: 'popup' },
    banner: { id: 'banner', label: '横幅', tone: 'banner' },
    inject: { id: 'inject', label: '注入', tone: 'inject' },
    reinject: { id: 'reinject', label: '重注', tone: 'reinject' },
    uninstall: { id: 'uninstall', label: '卸载', tone: 'uninstall' },
});
const statusLabels = {
    skipped: '注入目标 (示例)',
    injected: '已注入 (示例)',
    submitted: '已提交 (示例)',
};
function emptyPresentation() {
    return {
        valid: false,
        applications: [],
        configuredApplications: [],
        counts: {
            installed: 0,
            user: 0,
            system: 0,
            matched: 0,
            ordinary: 0,
            configured: 0,
            registry: 0,
            enabled: 0,
        },
    };
}

// A local view model, not a device message or an executable command registry.
export function readAppsPresentation(appsFixture, matchFixture, submissionFixture) {
    const catalog = readAppsDemo(appsFixture);
    const match = attachInjectionSubmissions(matchInjectionDemo(matchFixture), submissionFixture);
    if (!catalog.valid || !match.valid) return emptyPresentation();
    const byPackage = new Map(catalog.applications.map((app) => [app.packageName, app]));
    const users = catalog.applications.filter((app) => !app.system);
    const userPackages = new Set(users.map((app) => app.packageName));
    if (
        matchFixture.installedApplications.length !== users.length ||
        matchFixture.installedApplications.some((app) => !userPackages.has(app.packageName)) ||
        matchFixture.globalInjectionList.some((entry) => {
            const installed = byPackage.get(entry.packageName);
            return (
                installed && (entry.name !== installed.name || entry.initial !== installed.initial)
            );
        }) ||
        match.applications.some((entry) => {
            const installed = byPackage.get(entry.packageName);
            return !installed || installed.system || installed.name !== entry.name;
        })
    )
        return emptyPresentation();
    const targets = new Map(match.applications.map((app) => [app.packageName, app]));
    const applications = catalog.applications.map((app) => {
        const target = targets.get(app.packageName);
        const presentationGroup = app.system ? 'system' : target ? 'target' : 'ordinary';
        const matchStatus = target?.status || 'sample';
        const actionIds = ['open'];
        if (target) {
            actionIds.push('popup', 'banner', 'inject');
            if (['injected', 'submitted'].includes(matchStatus)) actionIds.push('reinject');
        }
        if (!app.system) actionIds.push('uninstall');
        return {
            ...app,
            presentationGroup,
            matchStatus,
            statusLabel: app.system
                ? '系统应用'
                : target
                  ? statusLabels[matchStatus]
                  : '已安装 (示例)',
            actions: actionIds.map((id) => ({ ...actions[id] })),
        };
    });
    const configuredApplications = matchFixture.globalInjectionList
        .filter((app) => app.enabled && !byPackage.has(app.packageName))
        .map(({ id, name, packageName, initial }) => ({
            id,
            name,
            packageName,
            initial,
            actions: [],
        }));
    return {
        valid: true,
        applications,
        configuredApplications,
        counts: {
            installed: applications.length,
            user: users.length,
            system: applications.length - users.length,
            matched: targets.size,
            ordinary: users.length - targets.size,
            configured: configuredApplications.length,
            registry: match.registryCount,
            enabled: matchFixture.globalInjectionList.filter((app) => app.enabled).length,
        },
    };
}
