import { ref } from 'vue';
import { api } from './api.js';

export const fleetStats = ref(null);
let revision = 0;

export function setFleetStats(value) {
    revision++;
    fleetStats.value = value || null;
}

export async function refreshFleetStats() {
    const request = ++revision;
    const result = await api('/api/devices');
    if (request === revision) fleetStats.value = result.stats || null;
    return fleetStats.value;
}

export function clearFleetStats() {
    revision++;
    fleetStats.value = null;
}
