import { defineHook } from '@directus/extensions-sdk';
import { ensureSchema } from './schema';
import { runScheduled } from './sync';

export default defineHook(({ schedule, filter }, ctx) => {
	ensureSchema(ctx).catch((e) => ctx.logger.error(`Yandex Metrica schema: ${e.message}`));

	// в любой коллекции с полем metrika_synced_at изменение записи ставит её в очередь на повторную отправку
	filter('items.update', (payload: any, meta: any, { schema }: any) => {
		const fields = schema?.collections[meta.collection]?.fields ?? {};
		if (!('metrika_synced_at' in fields)) return payload;
		if (Object.keys(payload).every((k) => k === 'metrika_synced_at')) return payload;
		return { ...payload, metrika_synced_at: null };
	});

	// раз в 5 минут проверяем, пора ли отправлять по выбранному расписанию (sync_schedule)
	schedule('*/5 * * * *', async () => {
		try {
			await runScheduled(ctx);
		} catch (e: any) {
			ctx.logger.error(`Metrika sync: ${e.message}`);
		}
	});
});
