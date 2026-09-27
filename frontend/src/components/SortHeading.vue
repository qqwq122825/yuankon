<script setup>
defineProps({ label: String, field: String, sort: String, direction: String });
defineEmits(['sort']);
</script>
<template>
    <th :aria-sort="sort === field ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'">
        <button class="sort-button" @click="$emit('sort', field)">
            {{ label }} <span>{{ sort === field ? (direction === 'asc' ? '↑' : '↓') : '⇅' }}</span>
        </button>
    </th>
</template>
