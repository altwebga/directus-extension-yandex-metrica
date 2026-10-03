# directus-extension-yandex-metrica

Bundle-расширение для Directus 12: модуль «Яндекс Метрика», endpoint `/metrika/*`, hook синхронизации заказов.

## Разработка

```powershell
# терминал 1: сборка с пересборкой при сохранении
cd extensions/directus-extension-yandex-metrica
npm run dev

# терминал 2: Directus (из корня проекта)
bun run start
```

С `EXTENSIONS_AUTO_RELOAD=true` Directus сам подхватывает изменения из `dist/`.
После правок интерфейса обновите страницу в браузере (Ctrl+F5).

## Состав

| Файл | Что делает |
|---|---|
| `src/module/` | пункт меню «Яндекс Метрика» → `/admin/yandex-metrica` |
| `src/endpoint.ts` | `/metrika/auth-url`, `/connect`, `/connection`, `/collections`, `/sync-now` |
| `src/hook.ts` | создаёт коллекцию `metrika_connections`, крон синхронизации |
| `src/sync.ts` | выгрузка заказов в CRM API Метрики |
| `src/orders-schema.ts` | обязательные поля коллекции заказов, проверка, создание, статусы |
| `src/module/ConnectionCard.vue` | карточка подключения: аккаунт, счётчик, статус синхронизации |
| `src/module/CollectionCard.vue` | карточка коллекции: выбор и создание, проверка полей, статусы |
| `src/metrika-client.ts` | OAuth-токены и запросы к API |

Новую часть bundle добавлять командой `npm run add`.

## Переменные `.env`

| Переменная | По умолчанию |
|---|---|
| `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET` | обязательны |
| `METRIKA_SYNC_CRON` | `*/15 * * * *` |
| `METRIKA_CURRENCY` | `RUB`, если у заказа нет поля currency |

Коллекция заказов и сопоставление статусов выбираются на странице модуля. Обязательные поля: `status`, `date_created`, `metrika_synced_at` и хотя бы одно из `ym_client_id`, `phone`, `email`; рекомендуемые: `revenue`, `cost`, `currency`. Недостающие поля модуль добавляет кнопкой, новую коллекцию создаёт со всеми полями.

## Деплой

`npm run build`, затем скопировать на сервер папку с `package.json` и `dist/` (без `node_modules` и `src`) в `EXTENSIONS_PATH`.
