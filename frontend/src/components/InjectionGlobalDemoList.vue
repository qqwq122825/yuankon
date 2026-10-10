<script setup>
import { useId } from 'vue';
import fixture from '../fixtures/device-injection-match-demo.json';
import { INJECTION_DEMO_PROTOCOL, matchInjectionDemo } from '../fixtures/injection-demo-match.js';

const headingId = useId();
const matchSummary = matchInjectionDemo(fixture);
const validFixture = matchSummary.valid;
const applications = validFixture
    ? fixture.globalInjectionList.map((item) => ({
          id: item.id,
          name: item.name,
          initial: item.initial,
          packageName: item.packageName,
          enabled: item.enabled,
      }))
    : [];
const enabledTotal = applications.filter((item) => item.enabled).length;
</script>

<template>
    <section
        class="card injection-global-demo-list"
        data-testid="injection-global-demo-list"
        :aria-labelledby="headingId"
        :data-protocol="validFixture ? fixture.protocol : ''"
        :data-dataset-id="validFixture ? fixture.datasetId : undefined"
        :data-registry-id="validFixture ? fixture.registryId : ''"
        data-fixture-only="true"
    >
        <header class="injection-global-demo-heading">
            <div>
                <h2 :id="headingId">全局注入列表（假数据）</h2>
                <p>只读假数据 · 非设备扫描结果</p>
            </div>
            <span class="injection-global-demo-count">
                共 {{ applications.length }} 项 · {{ enabledTotal }} 项样例启用
            </span>
        </header>
        <p class="injection-global-demo-protocol">
            协议 <code>{{ INJECTION_DEMO_PROTOCOL }}</code>
            <span>总台与子台查看同一份固定样例，列表不接受配置或操作。</span>
        </p>
        <table class="injection-global-demo-table">
            <colgroup>
                <col class="injection-global-demo-name-column" />
                <col class="injection-global-demo-package-column" />
                <col class="injection-global-demo-status-column" />
            </colgroup>
            <thead>
                <tr>
                    <th scope="col">名称</th>
                    <th scope="col">示例包名</th>
                    <th scope="col">启用状态</th>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="application in applications"
                    :key="application.id"
                    class="injection-global-demo-row"
                    :data-template-id="application.id"
                    :data-enabled="application.enabled"
                >
                    <td class="injection-global-demo-name">
                        <span class="injection-global-demo-icon" aria-hidden="true">{{
                            application.initial
                        }}</span>
                        <span>{{ application.name }}</span>
                    </td>
                    <td class="injection-global-demo-package">{{ application.packageName }}</td>
                    <td>
                        <span
                            class="injection-global-demo-status"
                            :data-enabled="application.enabled"
                        >
                            {{ application.enabled ? '样例启用' : '样例停用' }}
                        </span>
                    </td>
                </tr>
                <tr v-if="!applications.length">
                    <td colspan="3" class="injection-global-demo-empty">
                        {{
                            validFixture
                                ? '暂无全局合成应用'
                                : '固定假数据协议不匹配，当前没有可展示的样例。'
                        }}
                    </td>
                </tr>
            </tbody>
        </table>
    </section>
</template>

<style scoped>
.injection-global-demo-list {
    margin-bottom: 20px;
    overflow: hidden;
    border: 1px solid var(--lab-line);
    border-radius: 12px;
    background: var(--lab-surface, #fff);
    color: var(--lab-ink);
    box-shadow: none;
}
.injection-global-demo-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 15px 20px 8px;
}
.injection-global-demo-heading h2 {
    margin: 0 0 4px;
    font-size: 14px;
    font-weight: 650;
    line-height: 20px;
}
.injection-global-demo-heading p {
    margin: 0;
    color: var(--lab-muted);
    font-size: 10px;
    line-height: 16px;
}
.injection-global-demo-count {
    color: var(--lab-muted);
    font-size: 11px;
    white-space: nowrap;
}
.injection-global-demo-protocol {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    padding: 0 20px 12px;
    color: var(--lab-muted);
    font-size: 10px;
    line-height: 16px;
}
.injection-global-demo-protocol code {
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--lab-bg);
    color: #6173bc;
    font-size: 10px;
}
.injection-global-demo-protocol span {
    margin-left: 5px;
}
.injection-global-demo-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 11px;
}
.injection-global-demo-name-column {
    width: 34%;
}
.injection-global-demo-package-column {
    width: 46%;
}
.injection-global-demo-status-column {
    width: 20%;
}
.injection-global-demo-table th,
.injection-global-demo-table td {
    height: 36px;
    padding: 7px 20px;
    border-top: 1px solid var(--lab-line);
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.injection-global-demo-table th {
    background: var(--lab-bg);
    color: var(--lab-muted);
    font-size: 10px;
    font-weight: 600;
}
.injection-global-demo-name span {
    vertical-align: middle;
}
.injection-global-demo-icon {
    display: inline-grid;
    width: 24px;
    height: 24px;
    margin-right: 8px;
    border-radius: 6px;
    background: var(--lab-bg);
    color: var(--lab-muted);
    place-items: center;
    font-size: 11px;
    font-weight: 600;
}
.injection-global-demo-package {
    color: var(--lab-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10px;
}
.injection-global-demo-status {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    background: #eafaf3;
    color: #16a378;
    font-size: 10px;
    line-height: 14px;
}
.injection-global-demo-status[data-enabled='false'] {
    background: var(--lab-bg);
    color: var(--lab-muted);
}
.injection-global-demo-empty {
    color: var(--lab-muted);
    text-align: center !important;
}
:global([data-bs-theme='dark']) .injection-global-demo-protocol code {
    color: #a6b5ec;
}
:global([data-bs-theme='dark']) .injection-global-demo-status[data-enabled='true'] {
    background: #203c37;
    color: #8bdac0;
}
</style>
