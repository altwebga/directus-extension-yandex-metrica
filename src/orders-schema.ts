import { CONNECTIONS, type Ctx } from './metrika-client';

export const METRIKA_STATUSES = ['IN_PROGRESS', 'PAID', 'CANCELLED', 'SPAM'] as const;

/**
 * required    — без поля синхронизация невозможна
 * identifier  — нужно хотя бы одно: по нему Метрика связывает заказ с визитом
 * recommended — без поля работает, но в Метрику не уйдёт выручка/себестоимость/валюта
 * extra       — только для новой коллекции, не проверяется
 */
type Level = 'required' | 'identifier' | 'recommended' | 'extra';

type Spec = { field: string; label: string; level: Level; type: string; accept: string[]; meta?: any; schema?: any };

const STRING = ['string', 'text'];
const NUMBER = ['decimal', 'float', 'integer', 'bigInteger'];
const DATE = ['timestamp', 'dateTime'];

export const DEFAULT_STATUSES = [
	{ text: 'Новый', value: 'new', metrika: 'IN_PROGRESS', color: '#2196F3' },
	{ text: 'В работе', value: 'in_work', metrika: 'IN_PROGRESS', color: '#FF9800' },
	{ text: 'Оплачен', value: 'paid', metrika: 'PAID', color: '#4CAF50' },
	{ text: 'Отменён', value: 'canceled', metrika: 'CANCELLED', color: '#9E9E9E' },
	{ text: 'Спам', value: 'spam', metrika: 'SPAM', color: '#F44336' },
];

const half = { width: 'half' };

export const ORDER_FIELDS: Spec[] = [
	{
		field: 'status', label: 'Статус', level: 'required', type: 'string', accept: STRING,
		schema: { default_value: 'new' },
		meta: {
			...half, interface: 'select-dropdown', display: 'labels',
			options: { choices: DEFAULT_STATUSES.map(({ text, value, color }) => ({ text, value, color })) },
			display_options: { choices: DEFAULT_STATUSES.map(({ text, value, color }) => ({ text, value, background: color, foreground: '#FFFFFF' })) },
		},
	},
	{
		field: 'date_created', label: 'Дата заказа', level: 'required', type: 'timestamp', accept: DATE,
		meta: { ...half, special: ['date-created'], interface: 'datetime', display: 'datetime', readonly: true },
	},
	{
		field: 'metrika_synced_at', label: 'Отправлен в Метрику', level: 'required', type: 'timestamp', accept: DATE,
		meta: { ...half, interface: 'datetime', readonly: true, hidden: true, note: 'Служебное поле интеграции с Метрикой' },
	},
	{ field: 'ym_client_id', label: 'ClientID Метрики', level: 'identifier', type: 'string', accept: STRING, meta: { ...half, interface: 'input', readonly: true } },
	{ field: 'phone', label: 'Телефон', level: 'identifier', type: 'string', accept: STRING, meta: { ...half, interface: 'input' } },
	{ field: 'email', label: 'Email', level: 'identifier', type: 'string', accept: STRING, meta: { ...half, interface: 'input' } },
	{ field: 'revenue', label: 'Выручка', level: 'recommended', type: 'decimal', accept: NUMBER, schema: { numeric_precision: 12, numeric_scale: 2 }, meta: { ...half, interface: 'input' } },
	{ field: 'cost', label: 'Себестоимость', level: 'recommended', type: 'decimal', accept: NUMBER, schema: { numeric_precision: 12, numeric_scale: 2 }, meta: { ...half, interface: 'input' } },
	{ field: 'currency', label: 'Валюта', level: 'recommended', type: 'string', accept: STRING, schema: { default_value: 'RUB', max_length: 3 }, meta: { ...half, interface: 'input' } },
	{ field: 'name', label: 'Имя клиента', level: 'extra', type: 'string', accept: STRING, meta: { ...half, interface: 'input' } },
	{ field: 'comment', label: 'Комментарий', level: 'extra', type: 'text', accept: STRING, meta: { interface: 'input-multiline' } },
	{ field: 'utm_source', label: 'utm_source', level: 'extra', type: 'string', accept: STRING, meta: { ...half, interface: 'input' } },
	{ field: 'utm_medium', label: 'utm_medium', level: 'extra', type: 'string', accept: STRING, meta: { ...half, interface: 'input' } },
	{ field: 'utm_campaign', label: 'utm_campaign', level: 'extra', type: 'string', accept: STRING, meta: { ...half, interface: 'input' } },
	{ field: 'referrer', label: 'Referrer', level: 'extra', type: 'string', accept: STRING, meta: { ...half, interface: 'input' } },
	{
		field: 'date_updated', label: 'Изменён', level: 'extra', type: 'timestamp', accept: DATE,
		meta: { ...half, special: ['date-updated'], interface: 'datetime', display: 'datetime', readonly: true },
	},
];

const toFieldDef = ({ field, type, meta, schema }: Spec) => ({ field, type, meta: meta ?? {}, schema: schema ?? {} });

/** Коллекции, которые можно выбрать: пользовательские, с таблицей в БД */
export function listCollections(schema: any) {
	return Object.values<any>(schema.collections)
		.filter((c) => !c.collection.startsWith('directus_') && c.collection !== CONNECTIONS)
		.map((c) => ({ collection: c.collection, primary: c.primary }))
		.sort((a, b) => a.collection.localeCompare(b.collection));
}

export type FieldCheck = { field: string; label: string; level: Level; status: 'ok' | 'missing' | 'wrong_type'; type?: string; expected: string };

/** Проверяет, что в коллекции есть поля, нужные для выгрузки */
export function checkCollection(schema: any, name: string) {
	const coll = schema.collections[name];
	if (!coll) return { exists: false, ok: false, fields: [] as FieldCheck[], problems: ['Коллекция не найдена'] };

	const fields: FieldCheck[] = ORDER_FIELDS.filter((s) => s.level !== 'extra').map((s) => {
		const f = coll.fields[s.field];
		const status = !f ? 'missing' : s.accept.includes(f.type) ? 'ok' : 'wrong_type';
		return { field: s.field, label: s.label, level: s.level, status, type: f?.type, expected: s.accept.join(' / ') };
	});

	const problems: string[] = [];
	for (const f of fields) {
		if (f.status === 'wrong_type') problems.push(`Поле ${f.field} имеет тип ${f.type}, нужен ${f.expected}`);
		else if (f.status === 'missing' && f.level === 'required') problems.push(`Нет обязательного поля ${f.field}`);
	}
	if (!fields.some((f) => f.level === 'identifier' && f.status === 'ok'))
		problems.push('Нужно хотя бы одно из полей: ym_client_id, phone, email');

	return { exists: true, ok: problems.length === 0, fields, problems };
}

/** Значения статусов: варианты из настроек поля + встречающиеся в данных */
export async function statusValues({ database }: Ctx, schema: any, name: string) {
	const f = schema.collections[name]?.fields.status;
	if (!f) return [];
	const choices: { text: string; value: string }[] = (await database('directus_fields')
		.select('options').where({ collection: name, field: 'status' }).first()
		.then((r: any) => {
			const o = typeof r?.options === 'string' ? JSON.parse(r.options) : r?.options;
			return o?.choices ?? [];
		})) ?? [];
	const used: string[] = await database(name).distinct('status').whereNotNull('status').limit(100).pluck('status');

	const map = new Map<string, string>();
	for (const c of choices) map.set(String(c.value), c.text ?? String(c.value));
	for (const v of used) if (!map.has(String(v))) map.set(String(v), String(v));
	return [...map].map(([value, text]) => ({ value, text, suggested: suggestStatus(value) }));
}

/** Угадывает статус Метрики по названию */
export function suggestStatus(value: string) {
	const v = value.toLowerCase();
	const known = DEFAULT_STATUSES.find((s) => s.value === v);
	if (known) return known.metrika;
	if (/paid|оплач|done|complete|success|выполн/.test(v)) return 'PAID';
	if (/spam|спам|junk|fake/.test(v)) return 'SPAM';
	if (/cancel|отмен|reject|отказ|archiv|lost|fail/.test(v)) return 'CANCELLED';
	return 'IN_PROGRESS';
}

/** Добавляет в коллекцию недостающие поля (кроме extra). Поля с неверным типом не трогает */
export async function fixCollection({ services, getSchema, database }: Ctx, name: string) {
	const schema = await getSchema();
	const coll = schema.collections[name];
	if (!coll) throw new Error('Коллекция не найдена');
	const svc = new services.FieldsService({ schema, knex: database });
	const added: string[] = [];
	for (const s of ORDER_FIELDS.filter((s) => s.level !== 'extra' && !coll.fields[s.field])) {
		await svc.createField(name, toFieldDef(s));
		added.push(s.field);
	}
	return added;
}

/** Создаёт новую коллекцию заказов со всеми полями */
export async function createOrdersCollection({ services, getSchema, database }: Ctx, name: string) {
	if (!/^[a-z][a-z0-9_]{1,62}$/.test(name)) throw new Error('Имя: латиница в нижнем регистре, цифры и _, начинается с буквы');
	if (name.startsWith('directus_')) throw new Error('Префикс directus_ зарезервирован');
	const schema = await getSchema();
	if (schema.collections[name]) throw new Error(`Коллекция ${name} уже существует`);

	const svc = new services.CollectionsService({ schema, knex: database });
	await svc.createOne({
		collection: name,
		meta: {
			icon: 'shopping_cart',
			note: 'Заказы CRM, выгружаются в Яндекс Метрику',
			display_template: '#{{id}} {{name}} {{phone}}',
		},
		schema: {},
		fields: [
			{ field: 'id', type: 'integer', meta: { hidden: false, readonly: true, interface: 'input', width: 'half' }, schema: { is_primary_key: true, has_auto_increment: true } },
			...ORDER_FIELDS.map(toFieldDef),
		],
	});
}

export const defaultStatusMap = () => Object.fromEntries(DEFAULT_STATUSES.map((s) => [s.value, s.metrika]));
