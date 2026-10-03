import { API, CONNECTIONS, getConnection, getToken, metrika, type Ctx } from './metrika-client';
import { checkCollection, defaultStatusMap, METRIKA_STATUSES } from './orders-schema';

// Упрощённая загрузка заказов: https://yandex.ru/dev/metrika/ru/data-import/simple-orders-prep
// Статусы Метрики: IN_PROGRESS → цель «CRM: Заказ создан», PAID → «Заказ создан» + «Заказ оплачен»,
// CANCELLED и SPAM целей не дают. Сопоставление статусов CRM задаётся на странице модуля (status_map).

/** DD.MM.YYYY HH:MM в часовом поясе счётчика */
function fmtDate(d: string, timeZone: string) {
	const p = Object.fromEntries(
		new Intl.DateTimeFormat('ru-RU', {
			timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
		}).formatToParts(new Date(d)).map((x) => [x.type, x.value]),
	);
	return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}

/** Только цифры, российские 8XXXXXXXXXX → 7XXXXXXXXXX */
function normPhone(v: unknown) {
	const d = String(v ?? '').replace(/\D/g, '');
	return d.length === 11 && d.startsWith('8') ? `7${d.slice(1)}` : d;
}

const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const hasIdentifier = (o: any) => !!(o.ym_client_id || o.email || normPhone(o.phone));

function toCsv(items: any[], pk: string, timeZone: string, currency: string, statusMap: Record<string, string>) {
	const header = 'id,create_date_time,client_ids,emails,phones,order_status,revenue,cost,currency';
	const rows = items.map((o) => {
		const status = statusMap[o.status];
		return [
			o[pk],
			fmtDate(o.date_created ?? o.date_updated ?? new Date().toISOString(), timeZone),
			o.ym_client_id,
			o.email?.trim().toLowerCase(),
			normPhone(o.phone),
			METRIKA_STATUSES.includes(status as any) ? status : 'IN_PROGRESS',
			o.revenue ?? '',
			o.cost ?? '',
			o.currency || currency,
		].map(esc).join(',');
	});
	return [header, ...rows].join('\n');
}

async function upload(token: string, counterId: number, csv: string) {
	const form = new FormData();
	form.append('file', new Blob([csv], { type: 'text/csv' }), 'orders.csv');
	const url = `${API}/cdp/api/v1/counter/${counterId}/data/simple_orders?merge_mode=SAVE&delimiter_type=COMMA`;
	const res = await fetch(url, { method: 'POST', headers: { Authorization: `OAuth ${token}` }, body: form });
	if (!res.ok) throw new Error(`Metrika ${res.status}: ${await res.text()}`);
	const { uploading } = (await res.json()) as any;
	if (uploading?.api_validation_status === 'FAILED') throw new Error(`Metrika: файл не прошёл проверку (uploading ${uploading.uploading_id})`);
	return uploading;
}

/** Расписание отправки: интервал между попытками в часах, manual — только кнопкой */
export const SCHEDULES = { manual: 0, hourly: 1, daily: 24, weekly: 24 * 7 } as const;
export type Schedule = keyof typeof SCHEDULES;
export const DEFAULT_SCHEDULE: Schedule = 'hourly';

const BATCH = 1000;
const MAX_BATCHES = 50; // до 50 000 заказов за запуск, остальное уйдёт в следующий

let running = false;

/** Заказы в очереди на отправку (metrika_synced_at пустой) */
export async function pendingCount(ctx: Ctx, coll: string) {
	const schema = await ctx.getSchema();
	if (!checkCollection(schema, coll).ok) return null;
	const [row] = await new ctx.services.ItemsService(coll, { schema }).readByQuery({
		aggregate: { count: ['*'] },
		filter: { metrika_synced_at: { _null: true } },
	});
	return Number(row?.count ?? 0);
}

/** Вызывается кроном: отправляет, если по расписанию пора */
export async function runScheduled(ctx: Ctx) {
	const c = await getConnection(ctx);
	const hours = SCHEDULES[(c?.sync_schedule as Schedule) ?? DEFAULT_SCHEDULE] ?? SCHEDULES[DEFAULT_SCHEDULE];
	if (!c || !hours) return;
	// отсчёт от последней попытки: пропущенное окно (сервер был выключен) не теряется,
	// а при ошибке повтор будет через интервал, а не каждые 5 минут
	const last = c.last_sync_attempt_at ? new Date(c.last_sync_attempt_at).getTime() : 0;
	if (Date.now() - last < hours * 3600_000 - 60_000) return;
	await runSync(ctx);
}

/** Отправляет несинхронизированные заказы выбранной коллекции в счётчик подключённого аккаунта */
export async function runSync(ctx: Ctx) {
	if (running) return { skipped: true, sent: 0, reason: 'Отправка уже идёт' };
	running = true;
	try {
		const schema = await ctx.getSchema();
		if (!schema.collections[CONNECTIONS]) return { skipped: true, sent: 0 };

		const c = await getConnection(ctx);
		if (!c?.access_token) return { skipped: true, sent: 0, reason: 'Яндекс не подключён' };
		if (!c.counter_id) return { skipped: true, sent: 0, reason: 'Не выбран счётчик' };
		if (!c.orders_collection) return { skipped: true, sent: 0, reason: 'Не выбрана коллекция заказов' };

		const conns = new ctx.services.ItemsService(CONNECTIONS, { schema });
		const coll = c.orders_collection;
		await conns.updateOne(c.id, { last_sync_attempt_at: new Date().toISOString() });

		const check = checkCollection(schema, coll);
		if (!check.ok) {
			const reason = `Коллекция ${coll}: ${check.problems.join('; ')}`;
			await conns.updateOne(c.id, { last_sync_error: reason });
			return { skipped: true, sent: 0, reason };
		}

		const pk = schema.collections[coll].primary;
		const orders = new ctx.services.ItemsService(coll, { schema });
		const currency = ctx.env.METRIKA_CURRENCY ?? 'RUB';
		const statusMap = c.status_map ?? defaultStatusMap();
		let token: string | null = null;
		let timeZone: string = c.counter_timezone;
		let sent = 0;
		let skippedNoId = 0;

		try {
			for (let i = 0; i < MAX_BATCHES; i++) {
				const pending = await orders.readByQuery({ filter: { metrika_synced_at: { _null: true } }, sort: [pk], limit: BATCH });
				if (!pending.length) break;

				// без ClientID, email и телефона Метрике не с чем сопоставить заказ: такие не отправляем
				const items = pending.filter(hasIdentifier);
				if (items.length) {
					token ??= await getToken(ctx, c.id);
					if (!timeZone) {
						const { counter } = await metrika(token, `/management/v1/counter/${c.counter_id}`);
						timeZone = counter.time_zone_name ?? 'Europe/Moscow';
						await conns.updateOne(c.id, { counter_timezone: timeZone });
					}
					await upload(token, c.counter_id, toCsv(items, pk, timeZone, currency, statusMap));
				}

				await orders.updateMany(pending.map((o: any) => o[pk]), { metrika_synced_at: new Date().toISOString() }, { emitEvents: false });
				sent += items.length;
				skippedNoId += pending.length - items.length;
				if (pending.length < BATCH) break;
			}
			await conns.updateOne(c.id, { last_sync_at: new Date().toISOString(), last_sync_error: null });
		} catch (e: any) {
			// неотправленные заказы не помечаем: следующий запуск отправит снова (merge_mode=SAVE заменяет заказ по id)
			await conns.updateOne(c.id, { last_sync_error: e.message });
			ctx.logger.error(`Metrika sync: ${e.message}`);
			throw e;
		}

		ctx.logger.info(`Metrika: ${coll}: sent ${sent} orders (${skippedNoId} without identifiers)`);
		return { skipped: false, sent, skippedNoId };
	} finally {
		running = false;
	}
}
