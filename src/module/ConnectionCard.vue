<template>
	<div class="card">
		<div class="card-title">
			<v-icon name="account_circle" />
			<span>Аккаунт Яндекса</span>
			<strong v-if="conn.connected">{{ conn.yandex_login || 'подключён' }}</strong>
		</div>

		<template v-if="conn.connected">
			<div class="field">
				<div class="label">Счётчик</div>
				<v-select
					:items="counters ?? []"
					:model-value="conn.counter_id"
					:placeholder="counters ? 'Выберите счётчик' : 'Загрузка счётчиков…'"
					@update:model-value="selectCounter"
				/>
			</div>

			<v-divider />

			<div class="field">
				<div class="label">Отправка данных в Метрику</div>
				<v-select :items="SCHEDULE_ITEMS" :model-value="conn.sync_schedule" @update:model-value="selectSchedule" />

				<div class="status">
					<v-icon name="schedule_send" small />
					<span v-if="conn.pending === null">Очередь: выберите коллекцию заказов</span>
					<span v-else>В очереди: {{ conn.pending }} {{ plural(conn.pending) }}</span>
				</div>
				<div v-if="nextRun" class="status">
					<v-icon name="update" small />
					<span>Следующая отправка: {{ nextRun }}</span>
				</div>

				<div class="row">
					<v-button
						:secondary="conn.sync_schedule !== 'manual'"
						:small="conn.sync_schedule !== 'manual'"
						:loading="sending"
						:disabled="!canSend"
						@click="sendNow"
					>
						<v-icon name="send" left /> {{ conn.sync_schedule === 'manual' ? 'Отправить' : 'Отправить сейчас' }}
					</v-button>
				</div>
			</div>

			<div class="status">
				<template v-if="conn.last_sync_error">
					<v-icon name="error" small class="bad" /> Ошибка: {{ conn.last_sync_error }}
				</template>
				<template v-else-if="conn.last_sync_at">
					<v-icon name="check_circle" small class="ok" /> Последняя успешная синхронизация: {{ fmt(conn.last_sync_at) }}
				</template>
				<template v-else>Ещё не отправлялось</template>
			</div>

			<v-divider />

			<div class="row">
				<v-button secondary small @click="emit('connect')">Сменить аккаунт</v-button>
				<v-button secondary small kind="danger" @click="emit('disconnect')">Отключить</v-button>
			</div>
		</template>

		<template v-else>
			<div class="status">Подключите аккаунт Яндекса, у которого есть права на запись в нужный счётчик Метрики.</div>
			<div class="row">
				<v-button @click="emit('connect')">
					<v-icon name="link" left /> Подключить Яндекс
				</v-button>
			</div>
		</template>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { errText, SCHEDULE_HOURS, type Conn, type Schedule } from './types';

const props = defineProps<{ conn: Conn }>();
const emit = defineEmits<{ connect: []; disconnect: []; changed: []; flash: [type: 'success' | 'danger', text: string] }>();

const SCHEDULE_ITEMS: { text: string; value: Schedule }[] = [
	{ text: 'Вручную', value: 'manual' },
	{ text: 'Раз в час', value: 'hourly' },
	{ text: 'Раз в сутки', value: 'daily' },
	{ text: 'Раз в неделю', value: 'weekly' },
];

const api = useApi();
const counters = ref<{ text: string; value: number }[] | null>(null);
const sending = ref(false);

const fmt = (d: string | number) => new Date(d).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
const plural = (n: number) =>
	n % 10 === 1 && n % 100 !== 11 ? 'заказ' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'заказа' : 'заказов';

const canSend = computed(() => !!props.conn.counter_id && props.conn.pending !== null);

// крон проверяет расписание раз в 5 минут, поэтому время примерное
const nextRun = computed(() => {
	const hours = SCHEDULE_HOURS[props.conn.sync_schedule];
	if (!hours || !canSend.value) return null;
	const last = props.conn.last_sync_attempt_at ? new Date(props.conn.last_sync_attempt_at).getTime() : 0;
	const next = last + hours * 3600_000;
	return next <= Date.now() ? 'в ближайшие 5 минут' : `≈ ${fmt(next)}`;
});

async function loadCounters() {
	counters.value = null;
	if (!props.conn.connected) return;
	try {
		const { data } = await api.get('/metrika/connection/counters');
		counters.value = data.map((x: any) => ({ text: `${x.name} — ${x.site} (${x.id})`, value: x.id }));
	} catch (e) {
		counters.value = [];
		emit('flash', 'danger', `Не удалось загрузить счётчики: ${errText(e)}`);
	}
}

async function selectCounter(counterId: number) {
	try {
		await api.post('/metrika/connection/counter', { counter_id: counterId });
		props.conn.counter_id = counterId;
		emit('flash', 'success', 'Счётчик сохранён');
	} catch (e) {
		emit('flash', 'danger', errText(e));
	}
}

async function selectSchedule(value: Schedule) {
	try {
		await api.patch('/metrika/connection/settings', { sync_schedule: value });
		props.conn.sync_schedule = value;
	} catch (e) {
		emit('flash', 'danger', errText(e));
	}
}

async function sendNow() {
	sending.value = true;
	try {
		const { data } = await api.post('/metrika/sync-now');
		if (data.skipped) emit('flash', 'danger', data.reason ?? 'Нечего отправлять');
		else if (!data.sent && !data.skippedNoId) emit('flash', 'success', 'Новых заказов нет');
		else
			emit('flash', 'success',
				`Отправлено заказов: ${data.sent}` + (data.skippedNoId ? `, без ClientID/телефона/email пропущено: ${data.skippedNoId}` : ''));
	} catch (e) {
		emit('flash', 'danger', errText(e));
	} finally {
		sending.value = false;
		emit('changed');
	}
}

// после подключения или смены аккаунта список счётчиков другой
watch(() => [props.conn.connected, props.conn.yandex_login], loadCounters, { immediate: true });
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
.row {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
}
.field {
	display: grid;
	gap: 8px;
}
.label {
	font-weight: 600;
}
.status {
	color: var(--theme--foreground-subdued);
	display: flex;
	align-items: center;
	gap: 6px;
}
.ok {
	--v-icon-color: var(--theme--success);
}
.bad {
	color: var(--theme--danger);
	--v-icon-color: var(--theme--danger);
}
</style>
