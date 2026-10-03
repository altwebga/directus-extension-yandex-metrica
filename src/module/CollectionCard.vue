<template>
	<div class="card">
		<div class="card-title">
			<v-icon name="shopping_cart" />
			<span>Коллекция заказов</span>
		</div>

		<div class="field">
			<div class="row">
				<v-select
					class="grow"
					:items="collectionItems"
					:model-value="conn.orders_collection"
					placeholder="Выберите коллекцию"
					@update:model-value="selectCollection"
				/>
				<v-button secondary @click="openCreate">
					<v-icon name="add" left /> Создать коллекцию
				</v-button>
			</div>
		</div>

		<v-progress-linear v-if="checking" indeterminate />

		<template v-else-if="check">
			<div class="field">
				<div class="label">Поля коллекции</div>
				<v-notice v-if="check.ok" type="success">Коллекция подходит для выгрузки</v-notice>
				<v-notice v-else type="danger">
					<div>
						<div v-for="p in check.problems" :key="p">{{ p }}</div>
					</div>
				</v-notice>

				<table class="fields">
					<tr v-for="f in check.fields" :key="f.field">
						<td class="icon">
							<v-icon v-if="f.status === 'ok'" name="check_circle" small class="ok" />
							<v-icon v-else-if="f.status === 'wrong_type'" name="error" small class="bad" />
							<v-icon v-else name="radio_button_unchecked" small :class="f.level === 'required' ? 'bad' : 'muted'" />
						</td>
						<td><code>{{ f.field }}</code></td>
						<td>{{ f.label }}</td>
						<td class="muted">{{ LEVELS[f.level] }}</td>
						<td class="muted">
							<template v-if="f.status === 'wrong_type'">тип {{ f.type }}, нужен {{ f.expected }}</template>
							<template v-else-if="f.status === 'missing'">нет поля</template>
						</td>
					</tr>
				</table>

				<div v-if="missingCount" class="row">
					<v-button small :loading="fixing" @click="fix">
						<v-icon name="build" left /> Добавить недостающие поля ({{ missingCount }})
					</v-button>
				</div>
			</div>

			<div v-if="check.fields.some((f) => f.field === 'status' && f.status === 'ok')" class="field">
				<div class="label">Сопоставление статусов</div>
				<div v-if="!check.statuses.length" class="muted">В коллекции пока нет значений статуса</div>
				<table v-else class="fields">
					<tr v-for="s in check.statuses" :key="s.value">
						<td>{{ s.text }} <span class="muted">({{ s.value }})</span></td>
						<td class="arrow"><v-icon name="arrow_forward" small /></td>
						<td class="status-select">
							<v-select :items="METRIKA_ITEMS" :model-value="statusMap[s.value] ?? s.suggested" @update:model-value="(v: string) => setStatus(s.value, v)" />
						</td>
					</tr>
				</table>
				<div v-if="unsavedMap" class="row">
					<v-button small :loading="savingMap" @click="saveMap">Сохранить сопоставление</v-button>
					<span class="muted">Предложенные значения ещё не сохранены</span>
				</div>
			</div>
		</template>

		<div v-else class="muted">Выберите существующую коллекцию или создайте новую со всеми нужными полями.</div>

		<v-dialog v-model="createOpen" @esc="createOpen = false">
			<v-card>
				<v-card-title>Новая коллекция заказов</v-card-title>
				<v-card-text>
					<p class="muted dialog-note">
						Будут созданы поля статуса, контактов, ClientID, выручки, UTM-меток и служебное поле синхронизации.
					</p>
					<v-input v-model="newName" placeholder="orders" autofocus @keydown.enter="create" />
					<small v-if="createError" class="bad">{{ createError }}</small>
				</v-card-text>
				<v-card-actions>
					<v-button secondary @click="createOpen = false">Отмена</v-button>
					<v-button :loading="creating" :disabled="!newName" @click="create">Создать</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { errText, type Conn } from './types';

type Check = {
	exists: boolean;
	ok: boolean;
	problems: string[];
	fields: { field: string; label: string; level: string; status: string; type?: string; expected: string }[];
	statuses: { value: string; text: string; suggested: string }[];
};

const props = defineProps<{ conn: Conn }>();
const emit = defineEmits<{ changed: []; flash: [type: 'success' | 'danger', text: string] }>();

const LEVELS: Record<string, string> = { required: 'обязательное', identifier: 'идентификатор', recommended: 'рекомендуется' };
const METRIKA_ITEMS = [
	{ text: 'В работе (IN_PROGRESS)', value: 'IN_PROGRESS' },
	{ text: 'Оплачен (PAID)', value: 'PAID' },
	{ text: 'Отменён (CANCELLED)', value: 'CANCELLED' },
	{ text: 'Спам (SPAM)', value: 'SPAM' },
];

const api = useApi();

const collections = ref<{ collection: string; ok: boolean }[]>([]);
const check = ref<Check | null>(null);
const checking = ref(false);
const fixing = ref(false);
const statusMap = ref<Record<string, string>>({ ...(props.conn.status_map ?? {}) });
const savingMap = ref(false);

const createOpen = ref(false);
const newName = ref('orders');
const creating = ref(false);
const createError = ref('');

const collectionItems = computed(() =>
	collections.value.map((c) => ({ text: c.ok ? c.collection : `${c.collection} — не хватает полей`, value: c.collection })),
);
const missingCount = computed(() => check.value?.fields.filter((f) => f.status === 'missing').length ?? 0);
// есть статусы, для которых значение только предложено, но не сохранено
const unsavedMap = computed(() => !!check.value?.statuses.some((s) => !(s.value in statusMap.value)));

async function loadCollections() {
	try {
		const { data } = await api.get('/metrika/collections');
		collections.value = data;
	} catch (e) {
		emit('flash', 'danger', errText(e));
	}
}

async function runCheck() {
	if (!props.conn.orders_collection) return (check.value = null);
	checking.value = true;
	try {
		const { data } = await api.get(`/metrika/collections/${props.conn.orders_collection}/check`);
		check.value = data;
	} catch (e) {
		emit('flash', 'danger', errText(e));
	} finally {
		checking.value = false;
	}
}

async function selectCollection(name: string) {
	try {
		// у другой коллекции свои статусы: старое сопоставление не переносим
		await api.patch('/metrika/connection/settings', { orders_collection: name, status_map: null });
		props.conn.orders_collection = name;
		statusMap.value = {};
		await runCheck();
		emit('changed');
	} catch (e) {
		emit('flash', 'danger', errText(e));
	}
}

async function fix() {
	fixing.value = true;
	try {
		const { data } = await api.post(`/metrika/collections/${props.conn.orders_collection}/fix`);
		check.value = data;
		emit('flash', 'success', `Добавлены поля: ${data.added.join(', ') || 'нет'}`);
		emit('changed');
		await loadCollections();
	} catch (e) {
		emit('flash', 'danger', errText(e));
	} finally {
		fixing.value = false;
	}
}

function setStatus(value: string, metrikaStatus: string) {
	statusMap.value = { ...statusMap.value, [value]: metrikaStatus };
	saveMap();
}

async function saveMap() {
	savingMap.value = true;
	// сохраняем вместе с предложенными значениями, чтобы сопоставление было полным
	const full = Object.fromEntries((check.value?.statuses ?? []).map((s) => [s.value, statusMap.value[s.value] ?? s.suggested]));
	try {
		await api.patch('/metrika/connection/settings', { status_map: { ...statusMap.value, ...full } });
		statusMap.value = { ...statusMap.value, ...full };
		emit('flash', 'success', 'Сопоставление статусов сохранено');
	} catch (e) {
		emit('flash', 'danger', errText(e));
	} finally {
		savingMap.value = false;
	}
}

function openCreate() {
	createError.value = '';
	newName.value = collections.value.some((c) => c.collection === 'orders') ? 'crm_orders' : 'orders';
	createOpen.value = true;
}

async function create() {
	creating.value = true;
	createError.value = '';
	try {
		const { data } = await api.post('/metrika/collections', { name: newName.value });
		props.conn.orders_collection = data.collection;
		statusMap.value = Object.fromEntries(data.statuses.map((s: any) => [s.value, s.suggested]));
		check.value = data;
		createOpen.value = false;
		await loadCollections();
		emit('changed');
		emit('flash', 'success', `Коллекция ${data.collection} создана. Обновите страницу, чтобы она появилась в «Контенте»`);
	} catch (e) {
		createError.value = errText(e);
	} finally {
		creating.value = false;
	}
}

onMounted(() => {
	loadCollections();
	runCheck();
});
</script>

<style scoped>
.card {
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 16px;
	display: grid;
	gap: 16px;
}
.card-title {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 16px;
	font-weight: 600;
}
.card-title .muted {
	font-weight: 400;
}
.row {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
}
.grow {
	flex: 1;
	min-width: 220px;
}
.field {
	display: grid;
	gap: 8px;
}
.label {
	font-weight: 600;
}
.fields {
	border-collapse: collapse;
	width: 100%;
}
.fields td {
	padding: 4px 8px 4px 0;
	vertical-align: middle;
}
.icon,
.arrow {
	width: 28px;
}
.status-select {
	width: 260px;
}
.status {
	color: var(--theme--foreground-subdued);
	display: flex;
	align-items: center;
	gap: 6px;
}
.muted {
	color: var(--theme--foreground-subdued);
}
.ok {
	--v-icon-color: var(--theme--success);
}
.bad {
	color: var(--theme--danger);
	--v-icon-color: var(--theme--danger);
}
.dialog-note {
	margin-bottom: 12px;
}
</style>
