const OAUTH = 'https://oauth.yandex.ru';
export const API = 'https://api-metrika.yandex.net';
// Redirect URI, указанный в приложении Яндекс OAuth: Яндекс показывает код на своей странице
export const REDIRECT_URI = 'https://oauth.yandex.ru/verification_code';
export const CONNECTIONS = 'metrika_connections';
// зависший запрос к Яндексу не должен навсегда блокировать синхронизацию
export const TIMEOUT = 60_000;

export type Ctx = {
	services: any;
	getSchema: () => Promise<any>;
	env: Record<string, any>;
	database: any;
	logger: any;
};

/** Данные OAuth-приложения из .env или ошибка, если они не заданы */
export function oauthCredentials(env: Ctx['env']) {
	const { YANDEX_CLIENT_ID: id, YANDEX_CLIENT_SECRET: secret } = env;
	if (!id || !secret) throw new Error('Не заданы YANDEX_CLIENT_ID и YANDEX_CLIENT_SECRET');
	return { client_id: String(id), client_secret: String(secret) };
}

export async function exchangeToken(env: Ctx['env'], params: Record<string, string>) {
	const r = await fetch(`${OAUTH}/token`, {
		method: 'POST',
		signal: AbortSignal.timeout(TIMEOUT),
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ ...params, ...oauthCredentials(env) }),
	});
	const j: any = await r.json().catch(() => ({}));
	if (!r.ok || !j.access_token) throw new Error(j.error_description ?? j.error ?? `OAuth error ${r.status}`);
	// Яндекс выдаёт токен на год; если срок не пришёл, считаем так же
	const ttl = Number(j.expires_in) > 0 ? Number(j.expires_in) : 365 * 24 * 3600;
	return {
		access_token: j.access_token as string,
		// при обновлении новый refresh_token может не прийти — тогда остаётся прежний
		...(j.refresh_token ? { refresh_token: j.refresh_token as string } : {}),
		expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
	};
}

/** Отзывает токен в Яндексе; ошибки не мешают отключению */
export async function revokeToken(env: Ctx['env'], accessToken: string) {
	try {
		await fetch(`${OAUTH}/revoke_token`, {
			method: 'POST',
			signal: AbortSignal.timeout(TIMEOUT),
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ access_token: accessToken, ...oauthCredentials(env) }),
		});
	} catch {}
}

/** Логин аккаунта Яндекса или пустая строка */
export async function yandexLogin(accessToken: string) {
	try {
		const r = await fetch('https://login.yandex.ru/info?format=json', {
			signal: AbortSignal.timeout(TIMEOUT),
			headers: { Authorization: `OAuth ${accessToken}` },
		});
		const info: any = await r.json();
		return typeof info?.login === 'string' ? info.login : '';
	} catch {
		return '';
	}
}

const connections = async ({ services, getSchema }: Ctx) =>
	new services.ItemsService(CONNECTIONS, { schema: await getSchema() }); // админ-контекст

/** Единственная запись подключения (одна на экземпляр Directus) или null */
export async function getConnection(ctx: Ctx) {
	const [c] = await (await connections(ctx)).readByQuery({ sort: ['id'], limit: 1 });
	return c ?? null;
}

/** Обновляет запись подключения, создаёт её при первом сохранении */
export async function saveConnection(ctx: Ctx, patch: Record<string, any>) {
	const svc = await connections(ctx);
	const c = await getConnection(ctx);
	if (c) {
		await svc.updateOne(c.id, patch);
		return c.id;
	}
	return svc.createOne(patch);
}

/** Возвращает живой access_token, при необходимости обновляет его через refresh_token */
export async function getToken({ services, getSchema, env }: Ctx, connectionId: string | number) {
	const schema = await getSchema();
	const conns = new services.ItemsService(CONNECTIONS, { schema }); // админ-контекст
	const c = await conns.readOne(connectionId);
	if (!c?.access_token) throw new Error('Яндекс не подключён');

	const weekAhead = Date.now() + 7 * 24 * 3600 * 1000;
	if (new Date(c.expires_at).getTime() > weekAhead) return c.access_token as string;
	if (!c.refresh_token) throw new Error('Срок токена истекает, переподключите Яндекс');

	const t = await exchangeToken(env, { grant_type: 'refresh_token', refresh_token: c.refresh_token });
	await conns.updateOne(connectionId, t);
	return t.access_token;
}

export async function metrika(token: string, path: string, init: RequestInit = {}) {
	const r = await fetch(`${API}${path}`, {
		signal: AbortSignal.timeout(TIMEOUT),
		...init,
		headers: { ...(init.headers ?? {}), Authorization: `OAuth ${token}` },
	});
	if (!r.ok) throw new Error(`Metrika ${r.status}: ${await r.text()}`);
	return r.json() as Promise<any>;
}
