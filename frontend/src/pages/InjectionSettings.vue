<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { session } from '../session.js';

const regions = [
    ['in', '🇮🇳', '印度'],
    ['pk', '🇵🇰', '巴基斯坦'],
    ['bd', '🇧🇩', '孟加拉'],
    ['np', '🇳🇵', '尼泊尔'],
    ['lk', '🇱🇰', '斯里兰卡'],
    ['mv', '🇲🇻', '马尔代夫'],
    ['id', '🇮🇩', '印尼'],
    ['ph', '🇵🇭', '菲律宾'],
    ['vn', '🇻🇳', '越南'],
    ['th', '🇹🇭', '泰国'],
    ['my', '🇲🇾', '马来西亚'],
    ['sg', '🇸🇬', '新加坡'],
    ['bn', '🇧🇳', '文莱'],
    ['jp', '🇯🇵', '日本'],
    ['kr', '🇰🇷', '韩国'],
    ['tw', '🌐', '台湾'],
    ['hk', '🇭🇰', '香港'],
    ['mn', '🇲🇳', '蒙古'],
    ['us', '🇺🇸', '美国'],
    ['ca', '🇨🇦', '加拿大'],
    ['gb', '🇬🇧', '英国'],
    ['de', '🇩🇪', '德国'],
    ['fr', '🇫🇷', '法国'],
    ['it', '🇮🇹', '意大利'],
    ['es', '🇪🇸', '西班牙'],
    ['pt', '🇵🇹', '葡萄牙'],
    ['at', '🇦🇹', '奥地利'],
    ['ch', '🇨🇭', '瑞士'],
    ['be', '🇧🇪', '比利时'],
    ['nl', '🇳🇱', '荷兰'],
    ['ie', '🇮🇪', '爱尔兰'],
    ['lu', '🇱🇺', '卢森堡'],
    ['mt', '🇲🇹', '马耳他'],
    ['se', '🇸🇪', '瑞典'],
    ['no', '🇳🇴', '挪威'],
    ['dk', '🇩🇰', '丹麦'],
    ['fi', '🇫🇮', '芬兰'],
    ['ee', '🇪🇪', '爱沙尼亚'],
    ['lv', '🇱🇻', '拉脱维亚'],
    ['lt', '🇱🇹', '立陶宛'],
    ['ru', '🇷🇺', '俄罗斯'],
    ['ua', '🇺🇦', '乌克兰'],
    ['pl', '🇵🇱', '波兰'],
    ['cz', '🇨🇿', '捷克'],
    ['hu', '🇭🇺', '匈牙利'],
].map(([id, flag, name]) => ({ id, flag, name }));
const categories = [
    { id: 'interface', name: '通用界面', icon: '▤' },
    { id: 'status', name: '状态展示', icon: '◉' },
    { id: 'helper', name: '辅助示例', icon: '◇' },
];
const steps = [
    { icon: '◷', title: '1. 选择模板', lines: ['按地区浏览演示模板', '选择需要查看的界面'] },
    { icon: '⌕', title: '2. 检查界面', lines: ['查看模板名称与示例包名', '确认分类与展示状态'] },
    { icon: '✎', title: '3. 预览配置', lines: ['管理员调整本地演示草稿', '总台与子台只读查看'] },
    { icon: '✓', title: '4. 等待接入', lines: ['本页仅完成界面预览', '模板保存与设备调用待接入'] },
];
function createDemoTemplates() {
    return Object.fromEntries(
        regions.map(({ id }) => [
            id,
            Array.from({ length: 12 }, (_, index) => {
                const number = String(index + 1).padStart(2, '0');
                const category = index < 6 ? 'interface' : index < 10 ? 'status' : 'helper';
                return {
                    id: `${id}-sample${number}`,
                    name: `${category === 'interface' ? '通用' : category === 'status' ? '状态' : '辅助'}模板 ${number}`,
                    packageName: `com.example.preview.${id}.sample${number}`,
                    category,
                    enabled: true,
                };
            }),
        ]),
    );
}
const templates = ref(createDemoTemplates());
const canEdit = computed(() => session.user?.role === 'superadmin');
const selectedRegionId = ref('');
const selectedRegion = computed(() => regions.find(({ id }) => id === selectedRegionId.value));
const groupedTemplates = computed(() =>
    categories.map((category) => ({
        ...category,
        items: (templates.value[selectedRegionId.value] || []).filter(
            (item) => item.category === category.id,
        ),
    })),
);
const countryDialog = ref(null);
const editorDialog = ref(null);
let countryOpener = null;
let editorOpener = null;
let nextTemplateId = 1;
const editorMode = ref('create');
const editingId = ref('');
const notice = ref('');
const editorError = ref('');
const form = reactive({ regionId: 'in', name: '', packageName: '', category: 'interface' });

const enabledCount = (items) => items.filter((item) => item.enabled).length;
async function openRegion(region, event) {
    if (countryDialog.value?.open) return;
    selectedRegionId.value = region.id;
    countryOpener = event.currentTarget;
    await nextTick();
    countryDialog.value.showModal();
    countryDialog.value.querySelector('button')?.focus();
}
function closeRegion() {
    const wasOpen = countryDialog.value?.open;
    countryDialog.value?.close();
    if (wasOpen && countryOpener?.isConnected) countryOpener.focus();
}
function onBackdrop(event, close) {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
    )
        close();
}
function keepDialogFocus(event) {
    if (
        event.key !== 'Tab' ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.defaultPrevented
    )
        return;
    const dialog = event.currentTarget;
    const focusable = Array.from(
        dialog.querySelectorAll('button, input, select, textarea, a[href], [tabindex]'),
    ).filter(
        (element) =>
            element.tabIndex >= 0 &&
            !element.matches(':disabled') &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== 'hidden',
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = dialog.ownerDocument.activeElement;
    if (focusable.length === 1 || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
    }
}
async function openEditor(event, item = null) {
    if (!canEdit.value || editorDialog.value?.open) return;
    editorOpener = event.currentTarget;
    editorMode.value = item ? 'edit' : 'create';
    editingId.value = item?.id || '';
    editorError.value = '';
    Object.assign(form, {
        regionId: selectedRegionId.value || 'in',
        name: item?.name || '',
        packageName: item?.packageName || 'com.example.preview.custom.sample13',
        category: item?.category || 'interface',
    });
    await nextTick();
    if (!canEdit.value || !editorDialog.value) return;
    editorDialog.value.showModal();
    editorDialog.value.querySelector('input')?.focus();
}
function closeEditor() {
    const wasOpen = editorDialog.value?.open;
    editorDialog.value?.close();
    editorError.value = '';
    form.name = '';
    form.packageName = '';
    if (wasOpen && canEdit.value && editorOpener?.isConnected) editorOpener.focus();
    else if (wasOpen && countryDialog.value?.open)
        countryDialog.value.querySelector('button')?.focus();
}
function applyPreview() {
    if (!canEdit.value) return;
    const name = form.name.trim();
    const packageName = form.packageName.trim();
    const items = templates.value[form.regionId];
    if (
        !items ||
        !categories.some(({ id }) => id === form.category) ||
        !name ||
        !/^com\.example\.preview\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(packageName)
    ) {
        editorError.value = '请填写模板名称，并使用 com.example.preview. 开头的示例包名。';
        return;
    }
    if (items.some((item) => item.packageName === packageName && item.id !== editingId.value)) {
        editorError.value = '当前地区已有相同的示例包名。';
        return;
    }
    if (editorMode.value === 'edit') {
        const item = items.find(({ id }) => id === editingId.value);
        if (!item) return;
        Object.assign(item, { name, packageName, category: form.category });
    } else {
        items.push({
            id: `${form.regionId}-draft${nextTemplateId++}`,
            name,
            packageName,
            category: form.category,
            enabled: true,
        });
    }
    notice.value = `已${editorMode.value === 'edit' ? '修改' : '添加'}演示模板；仅当前页面预览，配置接口待接入。`;
    closeEditor();
}
function changePreview(item, event) {
    if (!canEdit.value) return;
    item.enabled = event.target.checked;
    notice.value = '已调整演示开关；仅当前页面预览，配置接口待接入。';
}
function resetPreview() {
    closeEditor();
    closeRegion();
    templates.value = createDemoTemplates();
    nextTemplateId = 1;
    notice.value = '已重置当前页面的演示草稿；配置接口待接入。';
}
watch(canEdit, (editable) => {
    if (!editable) {
        closeEditor();
        templates.value = createDemoTemplates();
        nextTemplateId = 1;
        notice.value = '';
    }
});
onBeforeUnmount(() => {
    editorDialog.value?.close();
    countryDialog.value?.close();
});
</script>

<template>
    <div class="settings-page injection-settings-page">
        <div class="page-title-row injection-title-row">
            <div class="injection-title-actions">
                <h1>
                    <img src="/vendor/icons/injection.svg" width="18" height="18" alt="" /> 注入管理
                </h1>
                <button type="button" class="btn injection-refresh" @click="resetPreview">
                    刷新
                </button>
            </div>
            <button
                v-if="canEdit"
                type="button"
                class="btn btn-primary"
                @click="openEditor($event)"
            >
                新增模板
            </button>
        </div>

        <div class="injection-mode-banner" data-testid="injection-mode-banner">
            <span aria-hidden="true" class="injection-banner-icon">{{ canEdit ? '▣' : '🔒' }}</span>
            <div>
                <strong>{{ canEdit ? '管理员预览模式' : '只读模式' }}</strong>
                <p>
                    {{
                        canEdit
                            ? '管理员可新增和修改演示模板；更改仅保留在当前页面，配置接口待接入。'
                            : '注入设置由超级管理员统一管理，如需修改请联系管理员。'
                    }}
                </p>
                <p class="injection-banner-note">
                    本页使用虚构模板展示 UI预览，不保存配置或调用设备；总台和子台仅可查看。
                </p>
            </div>
        </div>
        <p v-if="notice" class="injection-notice" role="status">{{ notice }}</p>

        <section
            class="card card-body injection-section"
            aria-labelledby="injection-workflow-title"
        >
            <h2 id="injection-workflow-title"><span aria-hidden="true">▤</span> 工作流程</h2>
            <div class="injection-workflow-grid">
                <article v-for="step in steps" :key="step.title" class="injection-workflow-step">
                    <span class="injection-step-icon" aria-hidden="true">{{ step.icon }}</span>
                    <h3>{{ step.title }}</h3>
                    <p v-for="line in step.lines" :key="line">{{ line }}</p>
                </article>
            </div>
        </section>

        <section class="card card-body injection-section" aria-labelledby="injection-apps-title">
            <div class="injection-section-heading">
                <h2 id="injection-apps-title">
                    <img src="/vendor/icons/injection.svg" width="17" height="17" alt="" /> APP 注入
                </h2>
                <p>仅展示本项目通用演示模板；点击地区查看配置，所有状态均为界面预览。</p>
            </div>
            <div class="injection-country-grid" data-testid="injection-country-grid">
                <button
                    v-for="region in regions"
                    :key="region.id"
                    type="button"
                    class="injection-country-card"
                    :aria-label="`${region.name} APP 注入配置`"
                    :data-region="region.id"
                    @click="openRegion(region, $event)"
                >
                    <strong
                        ><span aria-hidden="true">{{ region.flag }}</span> {{ region.name }}</strong
                    >
                    <span data-testid="injection-country-count"
                        >{{ enabledCount(templates[region.id]) }}/{{
                            templates[region.id].length
                        }}
                        演示开启</span
                    >
                </button>
            </div>
        </section>
        <p class="injection-page-footnote">
            模板管理入口已预留；刷新或离开页面后，当前演示草稿会重置。
        </p>

        <dialog
            ref="countryDialog"
            class="injection-dialog injection-country-dialog"
            aria-labelledby="injection-country-title"
            @cancel.prevent="closeRegion"
            @keydown="keepDialogFocus"
            @click="onBackdrop($event, closeRegion)"
        >
            <div class="injection-dialog-header">
                <h2 id="injection-country-title">
                    <span aria-hidden="true">{{ selectedRegion?.flag }}</span>
                    {{ selectedRegion?.name }} APP 注入配置
                </h2>
                <button
                    type="button"
                    class="injection-dialog-close"
                    aria-label="关闭配置弹窗"
                    @click="closeRegion"
                >
                    ×
                </button>
            </div>
            <p class="injection-dialog-description">
                {{
                    canEdit
                        ? '演示配置 · 管理员可调整本地草稿，保存接口待接入。'
                        : '演示配置 · 只读查看，更改请联系管理员。'
                }}
            </p>
            <div class="injection-dialog-body" data-testid="injection-template-list">
                <section
                    v-for="group in groupedTemplates"
                    :key="group.id"
                    class="injection-template-group"
                    :aria-labelledby="`injection-group-${group.id}`"
                >
                    <h3 :id="`injection-group-${group.id}`">
                        <span aria-hidden="true">{{ group.icon }}</span> {{ group.name }} ({{
                            enabledCount(group.items)
                        }}/{{ group.items.length }})
                    </h3>
                    <div
                        v-for="item in group.items"
                        :key="item.id"
                        class="injection-template-row"
                        :data-template-id="item.id"
                    >
                        <div class="injection-template-description">
                            <strong>{{ item.name }}</strong
                            ><span>{{ item.packageName }}</span>
                        </div>
                        <div class="injection-template-controls">
                            <button
                                v-if="canEdit"
                                type="button"
                                class="injection-template-edit"
                                :aria-label="`编辑 ${item.name}`"
                                @click="openEditor($event, item)"
                            >
                                编辑
                            </button>
                            <label class="injection-template-switch">
                                <input
                                    type="checkbox"
                                    role="switch"
                                    :checked="item.enabled"
                                    :disabled="!canEdit"
                                    :aria-label="`${item.name} 预览开关`"
                                    @change="changePreview(item, $event)"
                                />
                                <span class="visually-hidden">{{
                                    item.enabled ? '演示开启' : '演示关闭'
                                }}</span>
                            </label>
                        </div>
                    </div>
                </section>
            </div>
        </dialog>

        <dialog
            ref="editorDialog"
            class="injection-dialog injection-editor-dialog"
            aria-labelledby="injection-editor-title"
            @cancel.prevent="closeEditor"
            @keydown="keepDialogFocus"
            @click="onBackdrop($event, closeEditor)"
        >
            <div class="injection-dialog-header">
                <h2 id="injection-editor-title">
                    {{ editorMode === 'edit' ? '编辑模板' : '新增模板' }}
                </h2>
                <button
                    type="button"
                    class="injection-dialog-close"
                    aria-label="关闭模板编辑弹窗"
                    @click="closeEditor"
                >
                    ×
                </button>
            </div>
            <p class="injection-dialog-description">
                管理员演示入口 · 仅修改当前页面预览，不上传或保存模板。
            </p>
            <form class="injection-editor-form" @submit.prevent="applyPreview">
                <label for="injection-template-region">地区</label>
                <select
                    id="injection-template-region"
                    v-model="form.regionId"
                    class="form-select"
                    :disabled="editorMode === 'edit'"
                    required
                >
                    <option v-for="region in regions" :key="region.id" :value="region.id">
                        {{ region.name }}
                    </option>
                </select>
                <label for="injection-template-name">模板名称</label>
                <input
                    id="injection-template-name"
                    v-model="form.name"
                    class="form-control"
                    required
                    maxlength="60"
                    autocomplete="off"
                    placeholder="例如：通用演示模板"
                />
                <label for="injection-template-package">示例包名</label>
                <input
                    id="injection-template-package"
                    v-model="form.packageName"
                    class="form-control"
                    required
                    maxlength="160"
                    pattern="com\.example\.preview\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*"
                    autocomplete="off"
                    aria-describedby="injection-package-hint"
                />
                <small id="injection-package-hint"
                    >仅使用 com.example.preview. 开头的虚构示例包名。</small
                >
                <label for="injection-template-category">模板分类</label>
                <select
                    id="injection-template-category"
                    v-model="form.category"
                    class="form-select"
                    required
                >
                    <option v-for="category in categories" :key="category.id" :value="category.id">
                        {{ category.name }}
                    </option>
                </select>
                <p v-if="editorError" class="injection-editor-error" role="alert">
                    {{ editorError }}
                </p>
                <div class="injection-editor-actions">
                    <button type="submit" class="btn btn-primary" :disabled="!canEdit">
                        应用到预览</button
                    ><button type="button" class="btn" @click="closeEditor">取消</button>
                </div>
            </form>
        </dialog>
    </div>
</template>

<style scoped>
:global(.console-main:has(> .injection-settings-page)) {
    background: var(--lab-bg);
}
.injection-settings-page {
    max-width: none;
    color: var(--lab-ink);
}
.injection-title-row {
    margin-bottom: 16px;
    gap: 12px;
}
.injection-title-actions {
    display: flex;
    align-items: center;
    gap: 12px;
}
.injection-title-row h1 {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 18px;
    font-weight: 650;
    margin: 0;
}
.injection-title-row .btn {
    min-height: 30px;
    padding: 5px 14px;
    font-size: 11px;
}
.injection-refresh {
    border-color: #8d99ff;
    color: #5363f6;
    background: var(--lab-surface);
}
.injection-mode-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    background: #ef4444;
    color: #fff;
    border-radius: 10px;
    padding: 16px 20px;
    margin-bottom: 18px;
}
.injection-banner-icon {
    font-size: 20px;
}
.injection-mode-banner strong {
    font-size: 14px;
}
.injection-mode-banner p {
    margin: 2px 0 0;
    font-size: 12px;
    line-height: 1.5;
}
.injection-mode-banner .injection-banner-note {
    font-size: 11px;
    opacity: 0.9;
}
.injection-notice {
    color: #3c58c7;
    padding: 10px 14px;
    margin: 0 0 16px;
    font-size: 12px;
    border: 1px solid var(--lab-line);
    background: var(--lab-surface);
    border-radius: 8px;
}
.injection-section {
    padding: 20px;
    margin-bottom: 20px;
    border: 1px solid var(--lab-line);
    border-radius: 12px;
    background: var(--lab-surface);
    box-shadow: none;
}
.injection-section h2 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 14px;
    font-size: 16px;
    font-weight: 650;
}
.injection-workflow-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
}
.injection-workflow-step {
    padding: 16px 12px;
    min-height: 124px;
    border: 1px solid var(--lab-line);
    border-radius: 9px;
    background: var(--lab-bg);
    text-align: center;
}
.injection-step-icon {
    display: block;
    margin-bottom: 8px;
    font-size: 26px;
    line-height: 30px;
    color: var(--lab-muted);
}
.injection-workflow-step:last-child .injection-step-icon {
    color: #22a557;
}
.injection-workflow-step h3 {
    font-size: 12px;
    font-weight: 650;
    margin: 0 0 6px;
}
.injection-workflow-step p {
    color: var(--lab-muted);
    font-size: 11px;
    line-height: 1.5;
    margin: 0;
}
.injection-section-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 20px;
    margin-bottom: 16px;
}
.injection-section-heading h2 {
    margin: 0;
}
.injection-section-heading p {
    margin: 0;
    color: var(--lab-muted);
    font-size: 11px;
}
.injection-country-grid {
    display: grid;
    grid-template-columns: repeat(9, minmax(0, 1fr));
    gap: 12px;
}
.injection-country-card {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 5px;
    min-height: 72px;
    padding: 12px 6px;
    background: var(--lab-surface);
    border: 1px solid var(--lab-line);
    border-radius: 10px;
    color: var(--lab-ink);
    font-family: inherit;
    cursor: pointer;
    transition:
        border-color 0.15s,
        background 0.15s;
}
.injection-country-card:hover {
    border-color: #8b96ef;
    background: var(--lab-bg);
}
.injection-country-card strong {
    font-size: 12px;
    font-weight: 650;
    white-space: nowrap;
}
.injection-country-card > span {
    font-size: 11px;
    color: var(--lab-muted);
    white-space: nowrap;
}
.injection-page-footnote {
    color: var(--lab-muted);
    margin: 0;
    font-size: 11px;
}
.injection-dialog {
    position: fixed;
    inset: 0;
    width: 560px;
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 100px);
    padding: 28px;
    margin: auto;
    border: 1px solid var(--lab-line);
    border-radius: 16px;
    background: var(--lab-surface);
    color: var(--lab-ink);
    box-shadow: 0 20px 60px #11182733;
    overflow: hidden;
}
.injection-dialog[open] {
    display: flex;
    flex-direction: column;
}
.injection-dialog::backdrop {
    background: #0005;
    backdrop-filter: blur(2px);
}
.injection-dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-shrink: 0;
}
.injection-dialog-header h2 {
    margin: 0;
    font-size: 20px;
    line-height: 1.35;
    font-weight: 650;
}
.injection-dialog-header h2 > span {
    margin-right: 4px;
    font-size: 16px;
}
.injection-dialog-close {
    flex: 0 0 30px;
    width: 30px;
    height: 30px;
    border: 1px solid var(--lab-line);
    border-radius: 8px;
    background: var(--lab-bg);
    color: var(--lab-muted);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
}
.injection-dialog-description {
    flex-shrink: 0;
    font-size: 11px;
    line-height: 1.5;
    color: var(--lab-muted);
    margin: 10px 0 14px;
}
.injection-dialog-body {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    padding-right: 7px;
}
.injection-template-group h3 {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--lab-muted);
    font-size: 13px;
    margin: 0;
    padding: 12px 0 9px;
    border-bottom: 1px solid var(--lab-line);
}
.injection-template-group:first-child h3 {
    padding-top: 0;
}
.injection-template-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 60px;
    padding: 11px 0;
    border-bottom: 1px solid var(--lab-line);
}
.injection-template-description {
    display: flex;
    flex-direction: column;
    min-width: 0;
}
.injection-template-description strong {
    font-size: 15px;
    font-weight: 600;
}
.injection-template-description > span {
    font-size: 12px;
    color: var(--lab-muted);
    overflow-wrap: anywhere;
}
.injection-template-controls {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
}
.injection-template-edit {
    padding: 4px 6px;
    background: transparent;
    border: 0;
    border-radius: 5px;
    color: #6370e7;
    cursor: pointer;
    font-size: 11px;
}
.injection-template-switch {
    display: flex;
    margin: 0;
}
.injection-template-switch input {
    appearance: none;
    width: 44px;
    height: 25px;
    border: 0;
    border-radius: 20px;
    background: #cdd2e1;
    position: relative;
    cursor: pointer;
    margin: 0;
    transition: background 0.15s;
}
.injection-template-switch input::after {
    content: '';
    display: block;
    width: 19px;
    height: 19px;
    position: absolute;
    top: 3px;
    left: 3px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
}
.injection-template-switch input:checked {
    background: #a1adff;
}
.injection-template-switch input:checked::after {
    transform: translateX(19px);
}
.injection-template-switch input:disabled {
    cursor: default;
    opacity: 0.86;
}
.injection-editor-form {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
}
.injection-editor-form label {
    margin-top: 5px;
    font-size: 12px;
    font-weight: 600;
}
.injection-editor-form .form-control,
.injection-editor-form .form-select {
    font-size: 12px;
    min-height: 34px;
}
.injection-editor-form small {
    color: var(--lab-muted);
    font-size: 11px;
}
.injection-editor-error {
    font-size: 12px;
    color: #ef4444;
    margin: 0;
}
.injection-editor-actions {
    display: flex;
    gap: 10px;
    margin-top: 12px;
}
.injection-editor-actions .btn {
    min-height: 32px;
    font-size: 12px;
}
</style>
