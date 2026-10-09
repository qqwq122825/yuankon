<script setup>
import { computed, reactive, ref } from 'vue';

const providers = [
    { id: 'qwen', name: '通义千问' },
    { id: 'deepseek', name: 'DeepSeek' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'siliconflow', name: '硅基流动' },
    { id: 'custom', name: '自定义' },
];
const selectedProvider = ref('deepseek');
const provider = computed(() => providers.find((item) => item.id === selectedProvider.value));
const connections = reactive(
    Object.fromEntries(
        providers.map(({ id }) => [
            id,
            {
                baseUrl: id === 'deepseek' ? 'https://api.deepseek.com' : '',
                apiKey: '',
                model: id === 'deepseek' ? 'deepseek-chat' : '',
            },
        ]),
    ),
);
const connection = computed(() => connections[selectedProvider.value]);
const DEFAULT_ANALYSIS_PROMPT =
    '请根据以下合成短信样本整理金融相关事实，区分已知信息与未知信息，列出金额、时间和类型，不推断信用资格或提供投资决策。\n\n短信样本：\n{{SMS}}';
const enabled = ref(false),
    prompt = ref(DEFAULT_ANALYSIS_PROMPT),
    smsCount = ref(50),
    minimumSms = ref(10),
    automatic = ref(false),
    intervalMinutes = ref(60),
    cooldownDays = ref(7),
    accessibilityEnabled = ref(true),
    accessibilityDisabled = ref(false),
    fetchWithoutCache = ref(false),
    temperature = ref(0.3),
    maxTokens = ref(2048),
    notice = ref('');

function restorePrompt() {
    prompt.value = DEFAULT_ANALYSIS_PROMPT;
}
function previewAction(action) {
    notice.value = `界面预览，${action}接口待接入。`;
}
</script>

<template>
    <div class="settings-page settings-page--centered ai-settings-page">
        <div class="page-title-row">
            <h1>AI 配置</h1>
        </div>
        <p class="ai-introduction">
            每个登录账号使用自己的 AI
            密钥做金融分析，费用走你自己的账户。未配置或未启用时，设备不会调用任何外部 AI。
        </p>
        <p class="ai-preview-banner">
            <strong>界面预览 · 功能待接入</strong>
            此页不会验证密钥、保存配置或调用AI/设备。
        </p>

        <section class="card card-body settings-card" aria-labelledby="ai-enable-title">
            <h2 id="ai-enable-title" class="visually-hidden">启用 AI</h2>
            <div class="ai-enable-row">
                <label for="ai-enabled" class="ai-checkbox">
                    <input id="ai-enabled" v-model="enabled" type="checkbox" />
                    启用 AI 金融分析
                </label>
                <span class="status-chip" data-testid="ai-connection-status">未验证 · UI预览</span>
            </div>
        </section>

        <section class="card card-body settings-card" aria-labelledby="ai-provider-title">
            <h2 id="ai-provider-title">选择提供商</h2>
            <div class="ai-provider-options" role="group" aria-label="AI 服务商">
                <button
                    v-for="item in providers"
                    :key="item.id"
                    type="button"
                    class="btn ai-provider-option"
                    :class="{ active: item.id === selectedProvider }"
                    :aria-pressed="item.id === selectedProvider"
                    @click="selectedProvider = item.id"
                >
                    {{ item.name }}
                </button>
            </div>
            <aside class="ai-provider-guide" :aria-label="`${provider.name} 接入指南`">
                <h3>{{ provider.name }} 配置引导</h3>
                <ol v-if="selectedProvider === 'deepseek'">
                    <li>打开 DeepSeek 开放平台并登录。</li>
                    <li>
                        在
                        <a
                            href="https://platform.deepseek.com/api_keys"
                            target="_blank"
                            rel="noopener noreferrer"
                            >DeepSeek API Keys</a
                        >
                        创建密钥并复制。
                    </li>
                    <li>账户需有余额（按 token 计费）。</li>
                    <li>模型可用 deepseek-chat 或 deepseek-reasoner。</li>
                    <li>验证通过后保存（验证、保存接口待接入）。</li>
                </ol>
                <p v-else class="text-muted">
                    {{ provider.name }} 的连接信息请按实际配置填写；本页仅展示字段。
                </p>
                <a
                    v-if="selectedProvider === 'deepseek'"
                    class="ai-provider-docs"
                    href="https://platform.deepseek.com/api_keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    >打开官方文档获取 API Key →</a
                >
            </aside>
        </section>

        <section class="card card-body settings-card" aria-labelledby="ai-connection-title">
            <h2 id="ai-connection-title">连接参数</h2>
            <div class="ai-field-grid ai-connection-fields">
                <div class="ai-field">
                    <label for="ai-base-url">Base URL</label>
                    <input
                        id="ai-base-url"
                        v-model="connection.baseUrl"
                        type="url"
                        class="form-control"
                        autocomplete="off"
                        placeholder="填写服务商 Base URL"
                    />
                </div>
                <div class="ai-field">
                    <label for="ai-api-key">API Key</label>
                    <input
                        id="ai-api-key"
                        v-model="connection.apiKey"
                        type="password"
                        class="form-control"
                        autocomplete="off"
                        placeholder="留空表示不修改已保存密钥"
                        aria-describedby="ai-key-hint"
                    />
                    <small id="ai-key-hint" class="text-muted">尚未保存密钥</small>
                </div>
                <div class="ai-field ai-field-wide">
                    <label for="ai-model">模型名</label>
                    <input
                        id="ai-model"
                        v-model="connection.model"
                        class="form-control"
                        autocomplete="off"
                        placeholder="填写模型名称"
                    />
                </div>
            </div>
            <p class="text-muted">密钥仅保留在当前页面内存中，不写入浏览器存储。</p>
        </section>

        <section class="card card-body settings-card" aria-labelledby="ai-prompt-title">
            <div class="ai-card-heading">
                <h2 id="ai-prompt-title">分析提示词</h2>
                <button type="button" class="btn" @click="restorePrompt">恢复默认</button>
            </div>
            <p class="text-muted">
                下方为当前金融分析的合成默认提示词，可自行修改。模板设计中短信内容将替换
                <code v-text="'{{SMS}}'"></code
                >；删除该占位符后，短信将追加在末尾。替换、追加和分析流程均待接入。
            </p>
            <label for="ai-prompt">分析提示词</label>
            <textarea
                id="ai-prompt"
                v-model="prompt"
                class="form-control ai-prompt"
                rows="7"
                spellcheck="false"
            ></textarea>
        </section>

        <section class="card card-body settings-card" aria-labelledby="ai-parameters-title">
            <h2 id="ai-parameters-title">分析参数</h2>
            <div class="ai-field-grid">
                <div class="ai-field">
                    <label for="ai-sms-count">分析短信条数</label>
                    <input
                        id="ai-sms-count"
                        v-model.number="smsCount"
                        type="number"
                        min="10"
                        max="200"
                        step="1"
                        class="form-control"
                    />
                    <small class="text-muted">取最近 N 条，10–200</small>
                </div>
                <div class="ai-field">
                    <label for="ai-minimum-sms">最少短信条数</label>
                    <input
                        id="ai-minimum-sms"
                        v-model.number="minimumSms"
                        type="number"
                        min="1"
                        max="50"
                        step="1"
                        class="form-control"
                    />
                    <small class="text-muted">少于此数不分析，1–50</small>
                </div>
            </div>
        </section>

        <section class="card card-body settings-card" aria-labelledby="ai-strategy-title">
            <h2 id="ai-strategy-title">分析策略</h2>
            <label for="ai-automatic" class="ai-checkbox">
                <input id="ai-automatic" v-model="automatic" type="checkbox" />
                收到短信后自动分析（关闭后仅可在设备页手动触发）
            </label>
            <div class="ai-field-grid">
                <div class="ai-field">
                    <label for="ai-interval">最短分析间隔（分钟）</label>
                    <input
                        id="ai-interval"
                        v-model.number="intervalMinutes"
                        type="number"
                        min="5"
                        max="1440"
                        step="1"
                        class="form-control"
                    />
                    <small class="text-muted">两次分析至少间隔，5–1440，默认 60</small>
                </div>
                <div class="ai-field">
                    <label for="ai-cooldown">分析后多少天可再分析</label>
                    <input
                        id="ai-cooldown"
                        v-model.number="cooldownDays"
                        type="number"
                        min="0"
                        step="1"
                        class="form-control"
                    />
                    <small class="text-muted">0=不限制；成功分析后冷却天数，默认 7</small>
                </div>
            </div>
            <fieldset class="ai-checkbox-group">
                <legend>无障碍状态</legend>
                <label for="ai-accessibility-enabled" class="ai-checkbox">
                    <input
                        id="ai-accessibility-enabled"
                        v-model="accessibilityEnabled"
                        type="checkbox"
                    />
                    分析「已开启无障碍」的设备
                </label>
                <label for="ai-accessibility-disabled" class="ai-checkbox">
                    <input
                        id="ai-accessibility-disabled"
                        v-model="accessibilityDisabled"
                        type="checkbox"
                    />
                    分析「未开启无障碍」的设备
                </label>
            </fieldset>
            <label for="ai-fetch-without-cache" class="ai-checkbox">
                <input id="ai-fetch-without-cache" v-model="fetchWithoutCache" type="checkbox" />
                无短信缓存时自动拉取短信，获取后再分析
            </label>
            <details class="ai-advanced">
                <summary>高级参数</summary>
                <div class="ai-field-grid">
                    <div class="ai-field">
                        <label for="ai-temperature">Temperature</label>
                        <input
                            id="ai-temperature"
                            v-model.number="temperature"
                            type="number"
                            min="0"
                            max="2"
                            step="0.1"
                            class="form-control"
                        />
                    </div>
                    <div class="ai-field">
                        <label for="ai-max-tokens">Max Tokens</label>
                        <input
                            id="ai-max-tokens"
                            v-model.number="maxTokens"
                            type="number"
                            min="1"
                            step="1"
                            class="form-control"
                        />
                    </div>
                </div>
            </details>
        </section>

        <section
            class="card card-body settings-card ai-permissions"
            aria-labelledby="ai-permissions-title"
        >
            <div class="ai-card-heading">
                <h2 id="ai-permissions-title">AI 权限（已锁定）</h2>
                <span class="status-chip">功能待接入</span>
            </div>
            <p class="text-muted">权限设计预览 · 功能待接入。外部 AI 的设计权限仅包括：</p>
            <ol>
                <li>接收短信文本并返回分析结果。</li>
                <li>由本系统代发「拉取短信」指令。</li>
            </ol>
            <p class="text-muted">
                其它服务器操作（注入、命令、改库、控制设备等）均不开放给
                AI。上述权限能力和接口均待接入。
            </p>
        </section>

        <div class="ai-settings-actions">
            <div class="page-actions">
                <button type="button" class="btn" @click="previewAction('验证')">验证密钥</button>
                <button type="button" class="btn btn-primary" @click="previewAction('保存')">
                    保存配置
                </button>
                <button type="button" class="btn btn-outline-danger" @click="previewAction('删除')">
                    删除配置
                </button>
                <RouterLink to="/" class="btn">返回设备</RouterLink>
            </div>
            <p v-if="notice" class="ai-action-notice" role="status">{{ notice }}</p>
            <p class="text-muted ai-save-status">
                上次保存：<span data-testid="ai-last-saved">—</span>（后端待接入）
            </p>
            <p class="text-muted ai-footer-hint">
                提示：接口统一为 OpenAI
                兼容协议。改密钥后需重新验证。分析费用与配额由你选择的服务商账户承担。相关接口与费用业务待接入。
            </p>
        </div>
    </div>
</template>

<style scoped>
:global(.console-main:has(> .ai-settings-page)) {
    background: var(--lab-bg);
}
.ai-settings-page > .page-title-row {
    margin-bottom: 8px;
}
.ai-introduction {
    margin-bottom: 12px;
    color: var(--lab-muted);
    font-size: 12px;
}
.ai-settings-page > .ai-preview-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    margin: 0 0 16px;
    border: 1px solid var(--lab-line);
    border-left: 3px solid var(--lab-accent);
    border-radius: 8px;
    background: var(--lab-bg);
    color: var(--lab-ink);
    font-size: 11px;
    line-height: 1.6;
}
.ai-preview-banner strong {
    flex-shrink: 0;
    white-space: nowrap;
}
.ai-settings-page > .settings-card {
    margin: 0 0 16px;
    padding: 18px;
}
.ai-settings-page h2 {
    margin: 0 0 12px;
    font-size: 14px;
}
.ai-settings-page label,
.ai-settings-page legend {
    font-size: 12px;
}
.ai-settings-page .form-control {
    min-height: 34px;
    padding: 7px 10px;
    font-size: 12px;
}
.ai-settings-page input.form-control {
    height: 34px;
}
.ai-settings-page p,
.ai-settings-page li {
    font-size: 12px;
    line-height: 1.6;
}
.ai-settings-page .text-muted {
    margin: 8px 0 0;
}
.ai-settings-page small.text-muted {
    font-size: 11px;
}
.ai-card-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
}
.ai-card-heading h2 {
    margin: 0;
}
.ai-checkbox {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin: 0 0 12px;
}
.ai-checkbox input {
    accent-color: var(--lab-accent);
}
.ai-enable-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}
.ai-enable-row .ai-checkbox {
    margin-bottom: 0;
}
.ai-provider-options {
    display: flex;
    gap: 7px;
    margin-bottom: 14px;
}
.ai-settings-page .ai-provider-option {
    flex: 0 0 auto;
    min-height: 34px;
    padding: 8px 12px;
}
.ai-provider-option.active {
    color: var(--lab-accent);
    border-color: var(--lab-accent);
    background: var(--lab-bg);
}
.ai-provider-guide {
    padding: 14px;
    border-radius: 7px;
    background: var(--lab-bg);
    color: var(--lab-ink);
}
.ai-provider-guide h3 {
    margin: 0 0 8px;
    font-size: 12px;
}
.ai-provider-guide ol {
    margin: 0;
    padding-left: 20px;
}
.ai-provider-guide li + li {
    margin-top: 4px;
}
.ai-provider-docs {
    display: inline-block;
    margin-top: 10px;
    font-size: 11px;
}
.ai-field-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px 16px;
}
.ai-connection-fields {
    grid-template-columns: minmax(0, 1fr);
}
.ai-field {
    display: grid;
    gap: 6px;
    align-content: start;
}
.ai-field-wide {
    grid-column: 1 / -1;
}
.ai-prompt {
    min-height: 150px;
    margin-top: 6px;
    resize: vertical;
    line-height: 1.6;
}
.ai-checkbox-group {
    display: flex;
    align-items: center;
    gap: 18px;
    margin: 16px 0 0;
    padding: 0;
    border: 0;
}
.ai-checkbox-group legend {
    float: none;
    width: auto;
    margin-bottom: 8px;
}
.ai-advanced {
    margin-top: 4px;
    border-top: 1px solid var(--lab-line);
    padding-top: 12px;
}
.ai-advanced summary {
    color: var(--lab-muted);
    cursor: pointer;
    font-size: 12px;
}
.ai-advanced[open] summary {
    margin-bottom: 14px;
}
.ai-permissions {
    background: var(--lab-bg);
}
.ai-permissions ol {
    margin: 10px 0 0;
    padding-left: 18px;
}
.ai-settings-actions {
    padding-top: 2px;
}
.ai-action-notice {
    margin: 12px 0 0;
    color: var(--lab-accent);
}
.ai-settings-page .ai-save-status {
    margin-top: 12px;
    font-size: 11px;
}
</style>
