<script setup>
import { computed, nextTick, ref, useId, watch } from 'vue';
import {
    UI_DEMO_PROTOCOL,
    LOCK_VALUE_TYPES,
    lockDemoValue,
    lockDemoPattern,
} from '../fixtures/device-demo-protocol.js';

const props = defineProps({ records: { type: Array, default: () => [] } });
const footnoteId = useId();
const category = ref('all');
const selectedId = ref('');
const feedback = ref('');
const copyFallback = ref('');
const fallbackInput = ref(null);
const copying = ref(false);
const categories = [
    { id: 'all', label: '全部' },
    { id: 'system', label: '系统' },
    { id: 'scenario', label: '假锁' },
    { id: 'app', label: 'APP' },
];
const records = computed(() =>
    props.records
        .filter(
            (record) =>
                record &&
                typeof record === 'object' &&
                record.synthetic === true &&
                LOCK_VALUE_TYPES.includes(record.valueType),
        )
        .map((record, index) => ({
            id: String(record.id ?? `demo-${index}`).slice(0, 64),
            category: ['system', 'scenario', 'app'].includes(record.category)
                ? record.category
                : 'scenario',
            label: String(record.label || '样例事件').slice(0, 24),
            valueType: record.valueType,
            sampleValue: lockDemoValue(record),
            source: /^dev\.mtx\.demo\.[a-z0-9._-]+$/i.test(record.source)
                ? record.source
                : 'dev.mtx.demo.sample',
            time: /^\d{2}:\d{2}:\d{2}$/.test(record.time) ? record.time : '--:--:--',
            pattern: lockDemoPattern(record),
        })),
);
const filteredRecords = computed(() =>
    records.value.filter(
        (record) => category.value === 'all' || record.category === category.value,
    ),
);
const selectedRecord = computed(() =>
    filteredRecords.value.find((record) => record.id === selectedId.value),
);
const counts = computed(() => ({
    all: records.value.length,
    system: records.value.filter((record) => record.category === 'system').length,
    scenario: records.value.filter((record) => record.category === 'scenario').length,
    app: records.value.filter((record) => record.category === 'app').length,
}));
watch(
    filteredRecords,
    (items) => {
        if (!items.some((record) => record.id === selectedId.value))
            selectedId.value = items[0]?.id || '';
        feedback.value = '';
        copyFallback.value = '';
    },
    { immediate: true },
);
function selectRecord(record) {
    selectedId.value = record.id;
    feedback.value = '';
    copyFallback.value = '';
}
async function copySample() {
    if (!selectedRecord.value || copying.value) return;
    const payload = JSON.stringify(
        {
            protocol: UI_DEMO_PROTOCOL,
            schemaVersion: 1,
            fixtureOnly: true,
            synthetic: true,
            ...selectedRecord.value,
        },
        null,
        2,
    );
    copying.value = true;
    feedback.value = '';
    copyFallback.value = '';
    try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(payload);
        feedback.value = '已复制选中的合成样例。';
    } catch {
        copyFallback.value = payload;
        feedback.value = '自动复制未完成，请复制下方已选中的样例文本。';
        await nextTick();
        fallbackInput.value?.focus();
        fallbackInput.value?.select();
    } finally {
        copying.value = false;
    }
}
function preview(version) {
    const record = selectedRecord.value;
    if (!record) return;
    const displayValue = record.pattern.length ? record.pattern.join(' → ') : record.sampleValue;
    copyFallback.value = '';
    feedback.value = `${version}：已选中「${record.label} · ${displayValue}」合成样例；仅本地演示，未下发设备指令。`;
}
</script>

<template>
    <section class="lock-event-demo" aria-label="锁屏事件合成数据演示">
        <p class="lock-event-demo-notice">
            合成测试数据 · 非设备记录
            <span class="lock-event-demo-protocol" :title="UI_DEMO_PROTOCOL"
                >协议 v1 · 固定假值</span
            >
        </p>
        <div class="lock-event-demo-tabs" role="group" aria-label="筛选样例类型">
            <button
                v-for="tab in categories"
                :key="tab.id"
                type="button"
                class="lock-event-demo-tab"
                :class="{ active: category === tab.id }"
                :data-category="tab.id"
                :aria-pressed="category === tab.id"
                @click="category = tab.id"
            >
                {{ tab.label }} {{ counts[tab.id] }}
            </button>
        </div>
        <div class="lock-event-demo-list" aria-label="合成事件样例列表">
            <button
                v-for="record in filteredRecords"
                :key="record.id"
                type="button"
                class="lock-event-demo-record"
                :class="{ selected: selectedId === record.id }"
                :data-record-id="record.id"
                :aria-pressed="selectedId === record.id"
                @click="selectRecord(record)"
            >
                <span class="lock-event-demo-tag">{{ record.label }}</span>
                <span
                    v-if="record.pattern.length"
                    class="lock-event-demo-pattern"
                    aria-hidden="true"
                >
                    <i
                        v-for="point in 9"
                        :key="point"
                        :class="{ lit: record.pattern.includes(point) }"
                    ></i>
                </span>
                <span class="lock-event-demo-value">
                    <strong :title="record.sampleValue">{{
                        record.pattern.length ? record.pattern.join(' → ') : record.sampleValue
                    }}</strong>
                    <span :title="record.source">{{ record.source }}</span>
                </span>
                <time class="lock-event-demo-time">{{ record.time }}</time>
            </button>
            <p v-if="!filteredRecords.length" class="lock-event-demo-empty">暂无合成样例</p>
        </div>
        <footer class="lock-event-demo-footer">
            <div class="lock-event-demo-actions">
                <button
                    type="button"
                    class="lock-event-demo-copy"
                    :disabled="!selectedRecord || copying"
                    @click="copySample"
                >
                    {{ copying ? '复制中…' : '复制样例' }}
                </button>
                <button
                    type="button"
                    class="lock-event-demo-unlock"
                    aria-label="一键解锁"
                    :aria-describedby="footnoteId"
                    :disabled="!selectedRecord"
                    @click="preview('一键解锁')"
                >
                    一键解锁
                </button>
                <button
                    type="button"
                    class="lock-event-demo-v2"
                    aria-label="V2解锁"
                    :aria-describedby="footnoteId"
                    :disabled="!selectedRecord"
                    @click="preview('V2解锁')"
                >
                    V2解锁
                </button>
            </div>
            <p :id="footnoteId" class="lock-event-demo-footnote">固定假数据 · 仅本地界面演示</p>
            <p v-if="feedback" class="lock-event-demo-feedback" role="status">{{ feedback }}</p>
            <textarea
                v-if="copyFallback"
                ref="fallbackInput"
                class="lock-event-demo-copy-fallback"
                aria-label="样例复制内容"
                readonly
                :value="copyFallback"
            ></textarea>
        </footer>
    </section>
</template>

<style scoped>
.lock-event-demo {
    --demo-row: #f2f3f8;
    --demo-selected: #edf0ff;
    --demo-tag: #e8ebf2;
    --demo-line: #dfe3ef;
    --demo-muted: #929cad;
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
    color: var(--lab-ink, #242a38);
    background: var(--lab-surface, #fff);
    font-size: 12px;
}
.lock-event-demo-notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    flex: 0 0 auto;
    margin: 0;
    padding: 6px 9px 0;
    color: var(--demo-muted);
    font-size: 10px;
}
.lock-event-demo-protocol {
    flex: 0 0 auto;
    font-size: 8px;
    white-space: nowrap;
}
.lock-event-demo-tabs {
    display: flex;
    flex: 0 0 auto;
    gap: 4px;
    padding: 7px 9px;
}
.lock-event-demo-tab {
    flex: 1;
    min-width: 0;
    padding: 5px 3px;
    border: 1px solid var(--demo-line);
    border-radius: 8px;
    color: #697386;
    background: var(--demo-row);
    font-size: 11px;
    font-weight: 600;
    line-height: 1.35;
    white-space: nowrap;
}
.lock-event-demo-tab.active {
    border-color: #aab4ff;
    color: #5266ff;
    background: var(--demo-selected);
}
.lock-event-demo-list {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 4px;
    max-height: 274px;
    min-height: 0;
    padding: 0 7px 8px;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: #cdd2df transparent;
}
.lock-event-demo-record {
    display: flex;
    align-items: center;
    position: relative;
    flex-shrink: 0;
    gap: 5px;
    width: 100%;
    min-height: 51px;
    padding: 7px 8px;
    border: 1px solid var(--demo-line);
    border-radius: 10px;
    background: var(--demo-row);
    color: inherit;
    text-align: left;
}
.lock-event-demo-record.selected {
    border-color: #abb5ff;
    background: var(--demo-selected);
    box-shadow: inset 2px 0 0 #596eff;
}
.lock-event-demo-tag {
    flex: 0 0 auto;
    max-width: 62px;
    padding: 3px 5px;
    border-radius: 5px;
    background: var(--demo-tag);
    color: #687284;
    font-size: 10px;
    font-weight: 600;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.lock-event-demo-pattern {
    display: grid;
    flex: 0 0 auto;
    grid-template-columns: repeat(3, 6px);
    grid-template-rows: repeat(3, 6px);
    gap: 2px;
}
.lock-event-demo-pattern i {
    border-radius: 50%;
    background: #ccd1dc;
}
.lock-event-demo-pattern i.lit {
    background: #3178ff;
    box-shadow: 0 0 0 1px #b6ccff;
}
.lock-event-demo-value {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    gap: 3px;
    padding-bottom: 1px;
}
.lock-event-demo-value strong {
    overflow: hidden;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 13px;
    font-weight: 700;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.lock-event-demo-value > span {
    max-width: calc(100% - 42px);
    overflow: hidden;
    color: var(--demo-muted);
    font-size: 10px;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.lock-event-demo-time {
    position: absolute;
    right: 8px;
    bottom: 7px;
    color: var(--demo-muted);
    font-size: 9px;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
}
.lock-event-demo-empty {
    margin: 0;
    padding: 32px 8px;
    color: var(--demo-muted);
    text-align: center;
}
.lock-event-demo-footer {
    flex: 0 0 auto;
    position: sticky;
    bottom: 0;
    padding: 9px 10px 8px;
    border-top: 1px solid var(--demo-line);
    background: var(--demo-row);
}
.lock-event-demo-actions {
    display: grid;
    grid-template-columns: 0.9fr 1.15fr 1.15fr;
    gap: 5px;
}
.lock-event-demo-actions button {
    min-height: 32px;
    padding: 6px 3px;
    border: 1px solid var(--demo-line);
    border-radius: 8px;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
}
.lock-event-demo-copy {
    background: var(--demo-tag);
    color: #697386;
}
.lock-event-demo-actions .lock-event-demo-unlock {
    border-color: #347cff;
    background: linear-gradient(110deg, #3983fa, #2866ee);
    color: #fff;
    box-shadow: 0 3px 8px #2774f226;
}
.lock-event-demo-actions .lock-event-demo-v2 {
    border-color: #6655ef;
    background: linear-gradient(110deg, #7365f8, #5141e7);
    color: #fff;
    box-shadow: 0 3px 8px #6252e626;
}
.lock-event-demo-actions button:disabled {
    cursor: default;
    opacity: 0.55;
}
.lock-event-demo-footnote {
    margin: 6px 0 0;
    color: var(--demo-muted);
    font-size: 9px;
    text-align: center;
}
.lock-event-demo-feedback {
    margin: 7px 0 0;
    color: var(--lab-accent, #5366ff);
    font-size: 10px;
    line-height: 1.5;
}
.lock-event-demo-copy-fallback {
    display: block;
    width: 100%;
    max-height: 100px;
    margin-top: 6px;
    padding: 6px;
    border: 1px solid var(--demo-line);
    border-radius: 5px;
    background: var(--lab-surface, #fff);
    color: inherit;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 10px;
    resize: vertical;
}
.lock-event-demo button {
    cursor: pointer;
}
.lock-event-demo button:focus-visible,
.lock-event-demo textarea:focus-visible {
    outline: 2px solid #5366ff;
    outline-offset: 2px;
}
:global([data-bs-theme='dark']) .lock-event-demo {
    --demo-row: #202737;
    --demo-selected: #28365a;
    --demo-tag: #2b3448;
    --demo-line: #364156;
    --demo-muted: #9aa7bf;
}
:global([data-bs-theme='dark']) .lock-event-demo-tab,
:global([data-bs-theme='dark']) .lock-event-demo-tag,
:global([data-bs-theme='dark']) .lock-event-demo-copy {
    color: #b3bfd3;
}
:global([data-bs-theme='dark']) .lock-event-demo-tab.active {
    color: #abb6ff;
    border-color: #697bbc;
}
</style>
