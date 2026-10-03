const OAUTH = 'https://oauth.yandex.ru';
export const API = 'https://api-metrika.yandex.net';
// Redirect URI, указанный в приложении Яндекс OAuth: Яндекс показывает код на своей странице
export const REDIRECT_URI = 'https://oauth.yandex.ru/verification_code';
export const CONNECTIONS = 'metrika_connections';

export type Ctx = {
	services: any;
	getSchema: () => Promise<any>;
	env: Record<string, any>;
	database: any;
	logger: any;
};

export async function exchangeToken(env: Ctx['env'], params: Record<string, string>) {
	const r = await fetch(`${OAUTH}/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			...params,
			client_id: env.YANDEX_CLIENT_ID,
			client_secret: env.YANDEX_CLIENT_SECRET,
		}),
	});
	const j: any = await r.json();
	if (!r.ok) throw new Error(j.error_description ?? j.error ?? 'OAuth error');
	return {
		access_token: j.access_token as string,
		refresh_token: j.refresh_token as string,
		expires_at: new Date(Date.now() + j.expires_in * 1000).toISOString(),
	};
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

	const weekAhead = Date.now() + 7 * 24 * 3600 * 1000;
	if (new Date(c.expires_at).getTime() > weekAhead) return c.access_token as string;

	const t = await exchangeToken(env, { grant_type: 'refresh_token', refresh_token: c.refresh_token });
	await conns.updateOne(connectionId, t);
	return t.access_token;
}

export async function metrika(token: string, path: string, init: RequestInit = {}) {
	const r = await fetch(`${API}${path}`, {
		...init,
		headers: { ...(init.headers ?? {}), Authorization: `OAuth ${token}` },
	});
	if (!r.ok) throw new Error(`Metrika ${r.status}: ${await r.text()}`);
	return r.json() as Promise<any>;
}
