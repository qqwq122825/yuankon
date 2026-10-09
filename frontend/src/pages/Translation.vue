<script setup>
import { ref, onMounted } from 'vue';
import { api, mutate, formatDate } from '../api.js';
const settings = ref(null),
    key = ref(''),
    busy = ref(false),
    error = ref(''),
    notice = ref('');
async function action(type) {
    busy.value = true;
    error.value = '';
    notice.value = '';
    try {
        if (type === 'load') settings.value = await api('/api/settings/translation');
        if (type === 'save') {
            const secret = key.value;
            key.value = '';
            settings.value = await mutate('/api/settings/translation', 'PUT', {
                enabled: settings.value.enabled,
                language: settings.value.language,
                ...(secret ? { apiKey: secret } : {}),
            });
            notice.value = '翻译设置已保存';
        }
        if (type === 'verify') {
            settings.value = await mutate('/api/settings/translation/verify', 'POST');
            notice.value = '真实接口验证成功';
        }
        if (type === 'clear') {
            settings.value = await mutate('/api/settings/translation', 'DELETE');
            key.value = '';
            notice.value = '密钥及设置已清除';
        }
    } catch (e) {
        error.value = e.message;
    } finally {
        busy.value = false;
    }
}
onMounted(() => action('load'));
</script>
<template>
    <div class="settings-page settings-page--centered">
        <div class="page-title-row">
            <div>
                <small>WORKSPACE / TRANSLATION</small>
                <h1>翻译设置</h1>
            </div>
            <span class="status-chip">Google Basic v2</span>
        </div>
        <div v-if="error" class="alert alert-danger" role="alert">
            {{ error }}
            <button v-if="!settings" class="btn" @click="action('load')">重新读取</button>
        </div>
        <div v-if="notice" class="alert alert-success" role="status">{{ notice }}</div>
        <form v-if="settings" class="card card-body settings-card" @submit.prevent="action('save')">
            <h2>节点阅读器翻译</h2>
            <p class="text-muted">仅按点击发送固定合成标签；设备节点正文保持剔除。</p>
            <label class="form-check form-switch mb-3"
                ><input v-model="settings.enabled" class="form-check-input" type="checkbox" /><span
                    class="form-check-label"
                    >启用翻译</span
                ></label
            ><label for="translation-key" class="form-label">API Key</label
            ><input
                id="translation-key"
                v-model="key"
                type="password"
                class="form-control"
                autocomplete="new-password"
                maxlength="300"
                :placeholder="
                    settings.hasKey
                        ? '已保存密钥，留空则保持原值'
                        : '填写 Google Cloud Translation API Key'
                "
            />
            <p class="form-hint">
                使用本地独立密钥加密保存；密钥不回显，仅按点击发送固定样例标签。
            </p>
            <label for="target-language" class="form-label mt-3">目标语言</label
            ><select id="target-language" v-model="settings.language" class="form-select">
                <option value="zh-CN">简体中文</option>
                <option value="zh-TW">繁體中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="es">Español</option>
            </select>
            <p class="form-hint mt-3">最近验证：{{ formatDate(settings.verifiedAt) }}</p>
            <div class="page-actions mt-3">
                <button class="btn btn-primary" :disabled="busy">保存设置</button
                ><button
                    type="button"
                    class="btn"
                    :disabled="busy || !settings.hasKey"
                    @click="action('verify')"
                >
                    验证已保存密钥</button
                ><button
                    type="button"
                    class="btn"
                    :disabled="busy || !settings.hasKey"
                    @click="action('clear')"
                >
                    清除配置
                </button>
            </div>
        </form>
    </div>
</template>
