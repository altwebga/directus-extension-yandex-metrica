import { defineModule } from '@directus/extensions-sdk';
import YandexMetricaPage from './YandexMetricaPage.vue';

export default defineModule({
	id: 'yandex-metrica', // → /admin/yandex-metrica
	name: 'Яндекс Метрика',
	icon: 'analytics',
	routes: [{ path: '', component: YandexMetricaPage }],
	// все маршруты /metrika/* только для администратора — остальным пункт меню не показываем
	preRegisterCheck: (user) => user.admin_access === true,
});
