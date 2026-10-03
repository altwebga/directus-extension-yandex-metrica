<template>
	<private-view title="Яндекс Метрика">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="analytics" />
			</v-button>
		</template>

		<div class="page">
			<v-notice v-if="flash" :type="flash.type">{{ flash.text }}</v-notice>

			<div v-if="awaitingCode" class="card">
				<p>Разрешите доступ во вкладке Яндекса и вставьте сюда код подтверждения:</p>
				<div class="actions">
					<v-input v-model="code" placeholder="Код подтверждения" autofocus @keydown.enter="submitCode" />
					<v-button :loading="connecting" :disabled="!code" @click="submitCode">Подтвердить</v-button>
					<v-button secondary @click="awaitingCode = false">Отмена</v-button>
				</div>
			</div>

			<v-progress-circular v-if="loading && !conn" indeterminate />

			<div v-else-if="conn" class="columns">
				<connection-card :conn="conn" @connect="connect" @disconnect="disconnect" @changed="load" @flash="showFlash" />
				<collection-card :conn="conn" @changed="load" @flash="showFlash" />
			</div>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import ConnectionCard from './ConnectionCard.vue';
import CollectionCard from './CollectionCard.vue';
import { errText, type Conn } from './types';

const api = useApi();
const conn = ref<Conn | null>(null);
const loading = ref(true);
const connecting = ref(false);
const awaitingCode = ref(false);
const code = ref('');
const flash = ref<{ type: 'success' | 'danger'; text: string } | null>(null);

const showFlash = (type: 'success' | 'danger', text: string) => (flash.value = { type, text });

async function load() {
	loading.value = true;
	try {
		const { data } = await api.get('/metrika/connection');
		conn.value = data;
	} catch (e) {
		showFlash('danger', errText(e));
	} finally {
		loading.value = false;
	}
}

async function connect() {
	// вкладку открываем синхронно по клику, иначе после await её заблокирует браузер
	const tab = window.open('', '_blank');
	if (tab) tab.opener = null; // открытая страница не получит доступ к окну Directus
	try {
		const { data } = await api.get('/metrika/auth-url');
		if (tab) tab.location.href = data.url;
		else window.open(data.url, '_blank', 'noopener');
		awaitingCode.value = true;
		code.value = '';
	} catch (e) {
		tab?.close();
		showFlash('danger', errText(e));
	}
}

async function submitCode() {
	connecting.value = true;
	try {
		const { data } = await api.post('/metrika/connect', { code: code.value });
		showFlash('success', `Подключён ${data.login || 'аккаунт Яндекса'}`);
		awaitingCode.value = false;
		await load();
	} catch (e) {
		showFlash('danger', errText(e));
	} finally {
		connecting.value = false;
	}
}

async function disconnect() {
	if (!confirm(`Отключить ${conn.value?.yandex_login ?? 'аккаунт Яндекса'}? Выбор коллекции и статусов сохранится.`)) return;
	try {
		await api.delete('/metrika/connection');
		showFlash('success', 'Аккаунт Яндекса отключён');
		await load();
	} catch (e) {
		showFlash('danger', errText(e));
	}
}

onMounted(load);
</script>

<style scoped>
.page {
	padding: 0 var(--content-padding) var(--content-padding-bottom);
	max-width: 1400px;
	display: grid;
	gap: 16px;
	container-type: inline-size;
}
.columns {
	display: grid;
	gap: 16px;
	align-items: start;
}
.columns > * {
	min-width: 0;
}
/* на ПК: аккаунт и отправка слева (уже), коллекция справа */
@container (min-width: 880px) {
	.columns {
		grid-template-columns: minmax(320px, 2fr) 3fr;
	}
}
.card {
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 16px;
	display: grid;
	gap: 12px;
}
.actions {
	display: flex;
	gap: 8px;
	align-items: center;
}
</style>
