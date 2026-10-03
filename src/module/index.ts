import { defineModule } from '@directus/extensions-sdk';
import YandexMetricaPage from './YandexMetricaPage.vue';

export default defineModule({
	id: 'yandex-metrica', // → /admin/yandex-metrica
	name: 'Яндекс Метрика',
	icon: 'analytics',
	routes: [{ path: '', component: YandexMetricaPage }],
});
