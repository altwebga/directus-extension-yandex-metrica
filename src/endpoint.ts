import { defineEndpoint } from '@directus/extensions-sdk';
import {
	REDIRECT_URI, exchangeToken, getConnection, getToken, metrika, oauthCredentials, revokeToken, saveConnection, yandexLogin,
} from './metrika-client';
import {
	METRIKA_STATUSES, checkCollection, createOrdersCollection, defaultStatusMap, fixCollection, isUserCollection, listCollections,
	statusValues,
} from './orders-schema';
import { DEFAULT_SCHEDULE, SCHEDULES, pendingCount, runSync } from './sync';

// Одно подключение к Яндексу на экземпляр Directus: все маршруты работают с единственной записью
export default defineEndpoint({
	id: 'metrika',
	handler: (router, ctx) => {
		const { getSchema, env } = ctx;

		const adminOnly = (req: any, res: any, next: any) =>
			req.accountability?.admin ? next() : res.status(403).json({ error: 'Только для администратора' });

		const fail = (res: any, e: any) => res.status(400).json({ error: e.message });

		/** Токен подключённого аккаунта или ошибка, если Яндекс не подключён */
		const requireToken = async () => {
			const c = await getConnection(ctx);
			if (!c?.access_token) throw new Error('Яндекс не подключён');
			return getToken(ctx, c.id);
		};

		// ссылка на авторизацию в Яндексе; код Яндекс покажет на странице verification_code
		router.get('/auth-url', adminOnly, (_req, res) => {
			try {
				const url = new URL('https://oauth.yandex.ru/authorize');
				url.search = new URLSearchParams({
					response_type: 'code',
					client_id: oauthCredentials(env).client_id,
					redirect_uri: REDIRECT_URI,
					force_confirm: 'yes', // даёт выбрать другой Яндекс-аккаунт
				}).toString();
				res.json({ url: url.toString() });
			} catch (e) {
				fail(res, e);
			}
		});

		// пользователь вставил код со страницы Яндекса
		router.post('/connect', adminOnly, async (req: any, res) => {
			try {
				const code = String(req.body?.code ?? '').trim();
				// Яндекс выдаёт код разного формата (цифры или буквы с цифрами), проверяем только символы
				if (!/^[a-z0-9]{4,64}$/i.test(code)) return res.status(400).json({ error: 'Неверный формат кода подтверждения' });

				const tokens = await exchangeToken(env, { grant_type: 'authorization_code', code });

				const login = await yandexLogin(tokens.access_token);

				// другой аккаунт: счётчики прежнего ему недоступны, выбор счётчика сбрасываем
				const prev = await getConnection(ctx);
				const otherAccount = prev?.yandex_login !== login;
				await saveConnection(ctx, {
					...tokens,
					yandex_login: login,
					connected_by: req.accountability.user,
					last_sync_error: null,
					...(otherAccount ? { counter_id: null, counter_name: null, counter_timezone: null } : {}),
				});

				res.json({ ok: true, login });
			} catch (e) {
				fail(res, e);
			}
		});

		// состояние подключения и настройки, без токенов
		router.get('/connection', adminOnly, async (_req, res) => {
			try {
				const c = await getConnection(ctx);
				res.json({
					connected: !!c?.access_token,
					yandex_login: c?.yandex_login ?? null,
					counter_id: c?.counter_id ?? null,
					counter_name: c?.counter_name ?? null,
					orders_collection: c?.orders_collection ?? null,
					status_map: c?.status_map ?? null,
					sync_schedule: c?.sync_schedule ?? DEFAULT_SCHEDULE,
					expires_at: c?.expires_at ?? null,
					last_sync_attempt_at: c?.last_sync_attempt_at ?? null,
					last_sync_at: c?.last_sync_at ?? null,
					last_sync_error: c?.last_sync_error ?? null,
					pending: c?.orders_collection ? await pendingCount(ctx, c.orders_collection) : null,
				});
			} catch (e) {
				fail(res, e);
			}
		});

		// счётчики аккаунта, на которые есть права записи
		router.get('/connection/counters', adminOnly, async (_req, res) => {
			try {
				const { counters } = await metrika(await requireToken(), '/management/v1/counters?per_page=1000');
				res.json(
					counters
						.filter((c: any) => ['own', 'edit'].includes(c.permission))
						.map((c: any) => ({ id: c.id, name: c.name, site: c.site2?.site ?? c.site })),
				);
			} catch (e) {
				fail(res, e);
			}
		});

		// выбор счётчика с повторной проверкой прав
		router.post('/connection/counter', adminOnly, async (req: any, res) => {
			try {
				const counterId = Number(req.body?.counter_id);
				if (!Number.isSafeInteger(counterId) || counterId <= 0) return res.status(400).json({ error: 'Неверный номер счётчика' });
				const { counter } = await metrika(await requireToken(), `/management/v1/counter/${counterId}`);
				if (!['own', 'edit'].includes(counter.permission))
					return res.status(403).json({ error: 'Нет прав на запись в этот счётчик' });
				await saveConnection(ctx, {
					counter_id: counter.id,
					counter_name: `${counter.name} — ${counter.site2?.site ?? counter.site}`,
					counter_timezone: counter.time_zone_name ?? null,
				});
				res.json({ ok: true });
			} catch (e) {
				fail(res, e);
			}
		});

		// отключение: отзываем токен в Яндексе, настройки коллекции и статусов сохраняем
		router.delete('/connection', adminOnly, async (_req, res) => {
			try {
				const c = await getConnection(ctx);
				if (c?.access_token) await revokeToken(env, c.access_token);
				if (c) {
					await saveConnection(ctx, {
						access_token: null, refresh_token: null, expires_at: null, yandex_login: null,
						counter_id: null, counter_name: null, counter_timezone: null, last_sync_error: null,
					});
				}
				res.json({ ok: true });
			} catch (e) {
				fail(res, e);
			}
		});

		// коллекция заказов и сопоставление статусов
		router.patch('/connection/settings', adminOnly, async (req: any, res) => {
			try {
				const patch: Record<string, any> = {};
				const { orders_collection, status_map, sync_schedule } = req.body ?? {};

				if (sync_schedule !== undefined) {
					// hasOwn, а не in: иначе пройдут 'toString', 'constructor' и т. п.
					if (typeof sync_schedule !== 'string' || !Object.hasOwn(SCHEDULES, sync_schedule))
						return res.status(400).json({ error: `Неизвестное расписание: ${sync_schedule}` });
					patch.sync_schedule = sync_schedule;
				}

				if (orders_collection !== undefined) {
					if (orders_collection !== null && !isUserCollection(await getSchema(), orders_collection))
						return res.status(400).json({ error: `Коллекция ${orders_collection} не найдена` });
					patch.orders_collection = orders_collection;
				}
				if (status_map !== undefined) {
					if (status_map !== null && (typeof status_map !== 'object' || Array.isArray(status_map)))
						return res.status(400).json({ error: 'status_map должен быть объектом' });
					const bad = Object.values(status_map ?? {}).find((v) => !METRIKA_STATUSES.includes(v as any));
					if (bad !== undefined) return res.status(400).json({ error: `Неизвестный статус Метрики: ${bad}` });
					patch.status_map = status_map;
				}
				await saveConnection(ctx, patch);
				res.json({ ok: true });
			} catch (e) {
				fail(res, e);
			}
		});

		// коллекции, из которых можно выгружать заказы
		router.get('/collections', adminOnly, async (_req, res) => {
			try {
				const schema = await getSchema();
				res.json(listCollections(schema).map((c) => ({ ...c, ok: checkCollection(schema, c.collection).ok })));
			} catch (e) {
				fail(res, e);
			}
		});

		// проверка полей и значения статусов с предложенным сопоставлением
		const checkResponse = async (name: string) => {
			const schema = await getSchema();
			const check = checkCollection(schema, name);
			const statuses = check.exists ? await statusValues(ctx, schema, name) : [];
			return { ...check, statuses };
		};

		router.get('/collections/:name/check', adminOnly, async (req, res) => {
			try {
				res.json(await checkResponse(req.params.name));
			} catch (e) {
				fail(res, e);
			}
		});

		// добавить недостающие поля в существующую коллекцию
		router.post('/collections/:name/fix', adminOnly, async (req, res) => {
			try {
				const added = await fixCollection(ctx, req.params.name);
				res.json({ added, ...(await checkResponse(req.params.name)) });
			} catch (e) {
				fail(res, e);
			}
		});

		// создать новую коллекцию заказов и сразу выбрать её для выгрузки
		router.post('/collections', adminOnly, async (req: any, res) => {
			try {
				const name = String(req.body?.name ?? '').trim();
				await createOrdersCollection(ctx, name);
				await saveConnection(ctx, { orders_collection: name, status_map: defaultStatusMap() });
				res.json({ collection: name, ...(await checkResponse(name)) });
			} catch (e) {
				fail(res, e);
			}
		});

		// ручной запуск синхронизации, не дожидаясь крона
		router.post('/sync-now', adminOnly, async (_req, res) => {
			try {
				res.json(await runSync(ctx));
			} catch (e) {
				fail(res, e);
			}
		});
	},
});
