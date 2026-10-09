<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const modules = {
    performance: {
        title: '性能',
        icon: 'gauge',
        description: '当前未接入独立性能面板；设备连接状态可在顶栏查看。',
    },
};
const module = computed(() => modules[route.meta.workspaceModule]);
</script>

<template>
    <div v-if="module" class="settings-page settings-page--centered">
        <div class="page-title-row">
            <div>
                <small>WORKSPACE / {{ String(route.meta.workspaceModule).toUpperCase() }}</small>
                <h1>{{ module.title }}</h1>
            </div>
            <RouterLink to="/">返回设备</RouterLink>
        </div>
        <section class="card card-body settings-card" aria-labelledby="module-status-title">
            <div class="page-title-row">
                <h2 id="module-status-title">
                    <img
                        class="module-status-icon"
                        :src="`/vendor/icons/${module.icon}.svg`"
                        width="20"
                        height="20"
                        alt=""
                    />
                    当前状态
                </h2>
                <span class="status-chip" role="status">待接入</span>
            </div>
            <p class="text-muted">{{ module.description }}</p>
            <div class="page-actions mt-3">
                <RouterLink to="/builds" class="btn">前往构建</RouterLink>
            </div>
        </section>
    </div>
</template>

<style scoped>
.module-status-icon {
    filter: invert(44%) sepia(9%) saturate(599%) hue-rotate(183deg) brightness(96%) contrast(87%);
}
</style>
