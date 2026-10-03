export type Schedule = 'manual' | 'hourly' | 'daily' | 'weekly';

export const SCHEDULE_HOURS: Record<Schedule, number> = { manual: 0, hourly: 1, daily: 24, weekly: 168 };

export type Conn = {
	connected: boolean;
	yandex_login: string | null;
	counter_id: number | null;
	counter_name: string | null;
	orders_collection: string | null;
	status_map: Record<string, string> | null;
	sync_schedule: Schedule;
	last_sync_attempt_at: string | null;
	last_sync_at: string | null;
	last_sync_error: string | null;
	/** заказов в очереди; null — коллекция не выбрана или не прошла проверку */
	pending: number | null;
};

export const errText = (e: any): string =>
	e.response?.data?.error ?? e.response?.data?.errors?.[0]?.message ?? e.message;
