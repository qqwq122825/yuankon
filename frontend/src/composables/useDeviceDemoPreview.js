import { computed, onUnmounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { session } from '../session.js';

// These pages share the same authenticated, empty preview contract.
// A fixture is only visible after that contract has been verified for this context.
export function useDeviceDemoPreview(props, sectionId, options = {}) {
    const loading = ref(false);
    const error = ref('');
    const feedback = ref('');
    const result = ref(null);
    const requestedDemo = ref(false);
    const contextKey = computed(() =>
        JSON.stringify([
            props.deviceId,
            props.deviceSource,
            session.user?.id,
            session.user?.role,
            session.user?.projectId,
            session.user?.parentAccountId,
        ]),
    );
    const ready = computed(() => Boolean(session.user && result.value));
    const demoMode = computed(() => ready.value && requestedDemo.value);
    let initialized = false;
    let controller;
    let alive = true;

    function toggleDemo() {
        if (!ready.value) return;
        initialized = true;
        requestedDemo.value = !requestedDemo.value;
        feedback.value = '';
    }

    async function load(interactive = false) {
        controller?.abort();
        result.value = null;
        if (
            !alive ||
            !session.user ||
            !['payments', 'templates', 'sms', 'apps', 'password', 'gallery'].includes(sectionId) ||
            !Number.isSafeInteger(props.deviceId) ||
            props.deviceId <= 0
        )
            return;
        const request = (controller = new AbortController());
        const key = contextKey.value;
        const deviceId = props.deviceId;
        loading.value = true;
        error.value = '';
        feedback.value = '';
        try {
            const response = await api(`/api/devices/${deviceId}/ui-preview/${sectionId}`, {
                signal: request.signal,
            });
            if (
                request.signal.aborted ||
                !alive ||
                key !== contextKey.value ||
                controller !== request
            )
                return;
            if (
                !response ||
                response.mode !== 'preview' ||
                response.implemented !== false ||
                response.state !== 'not_connected' ||
                response.deviceId !== deviceId ||
                response.section?.id !== sectionId ||
                !Array.isArray(response.items) ||
                response.items.length !== 0 ||
                response.total !== 0
            )
                throw new Error('预览状态不符合当前约定，请重试。');
            result.value = response;
            if (!initialized) {
                requestedDemo.value =
                    options.defaultSample !== false && props.deviceSource === 'sample';
                initialized = true;
            }
            if (interactive) feedback.value = '已刷新预览状态；假数据仅在本页演示。';
        } catch (failure) {
            if (
                !request.signal.aborted &&
                failure.name !== 'AbortError' &&
                alive &&
                key === contextKey.value &&
                controller === request
            )
                error.value = failure.message;
        } finally {
            if (controller === request) loading.value = false;
        }
    }

    watch(
        contextKey,
        () => {
            controller?.abort();
            controller = undefined;
            requestedDemo.value = false;
            initialized = false;
            loading.value = false;
            error.value = '';
            feedback.value = '';
            result.value = null;
            load();
        },
        { immediate: true, flush: 'sync' },
    );
    onUnmounted(() => {
        alive = false;
        controller?.abort();
    });

    return {
        demoMode,
        loading,
        error,
        ready,
        feedback,
        contextKey,
        toggleDemo,
        refresh: () => load(true),
    };
}
