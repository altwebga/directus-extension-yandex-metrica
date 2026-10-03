import { CONNECTIONS, type Ctx } from './metrika-client';

const hidden = { hidden: true, readonly: true };

const FIELDS: any[] = [
	{ field: 'yandex_login', type: 'string', meta: { readonly: true } },
	{ field: 'access_token', type: 'text', meta: hidden },
	{ field: 'refresh_token', type: 'text', meta: hidden },
	{ field: 'expires_at', type: 'timestamp', meta: { readonly: true } },
	{ field: 'counter_id', type: 'integer', meta: {} },
	{ field: 'counter_name', type: 'string', meta: {} },
	{ field: 'counter_timezone', type: 'string', meta: { readonly: true, note: 'Часовой пояс счётчика, в нём передаются даты заказов' } },
	{ field: 'orders_collection', type: 'string', meta: { note: 'Коллекция заказов, из которой идёт выгрузка' } },
	{ field: 'status_map', type: 'json', meta: { interface: 'input-code', options: { language: 'json' }, note: 'Статус в CRM → статус Метрики' } },
	{
		field: 'sync_schedule', type: 'string', schema: { default_value: 'hourly' },
		meta: { note: 'Расписание отправки: manual, hourly, daily, weekly' },
	},
	{ field: 'last_sync_attempt_at', type: 'timestamp', meta: { readonly: true } },
	{ field: 'last_sync_at', type: 'timestamp', meta: { readonly: true } },
	{ field: 'last_sync_error', type: 'text', meta: { readonly: true } },
	{ field: 'connected_by', type: 'uuid', meta: { readonly: true, special: ['m2o'], interface: 'select-dropdown-m2o' } },
	{ field: 'date_created', type: 'timestamp', meta: { readonly: true, special: ['date-created'] } },
];

/** Создаёт коллекцию metrika_connections или досоздаёт недостающие поля */
export async function ensureSchema({ services, getSchema, database, logger }: Ctx) {
	const schema = await getSchema();
	const existing = schema.collections[CONNECTIONS];

	// коллекция уже есть: досоздаём поля, добавленные в новых версиях расширения
	if (existing) {
		if (!existing.singleton) {
			await new services.CollectionsService({ schema, knex: database }).updateOne(CONNECTIONS, { meta: { singleton: true } });
		}
		const fields = new services.FieldsService({ schema, knex: database });
		for (const f of FIELDS.filter((f) => !(f.field in existing.fields))) {
			await fields.createField(CONNECTIONS, f);
			logger.info(`Yandex Metrica: added field ${CONNECTIONS}.${f.field}`);
		}
		return;
	}

	const collections = new services.CollectionsService({ schema, knex: database });
	await collections.createOne({
		collection: CONNECTIONS,
		meta: { icon: 'analytics', hidden: true, singleton: true, note: 'Подключение Яндекс Метрики (одно на экземпляр)' },
		schema: {},
		fields: [
			{ field: 'id', type: 'integer', meta: hidden, schema: { is_primary_key: true, has_auto_increment: true } },
			...FIELDS,
		],
	});

	const relations = new services.RelationsService({ schema: await getSchema(), knex: database });
	await relations.createOne({
		collection: CONNECTIONS,
		field: 'connected_by',
		related_collection: 'directus_users',
		schema: { on_delete: 'SET NULL' },
	});

	logger.info(`Yandex Metrica: created collection ${CONNECTIONS}`);
}
