# Yandex Metrica for Directus

![Yandex Metrica for Directus](https://raw.githubusercontent.com/altwebga/directus-extension-yandex-metrica/main/docs/screenshots/overview.png)

[Русский](#русский) · [English](#english)

---

## Русский

Выгружает заказы CRM из коллекции Directus в Яндекс Метрику ([упрощённая загрузка заказов](https://yandex.ru/dev/metrika/ru/data-import/simple-orders-prep)), чтобы Метрика связывала заказы с визитами и считала цели «Заказ создан» и «Заказ оплачен».

### Возможности

- Подключение аккаунта Яндекса через OAuth прямо в админке Directus, выбор счётчика (только со своими правами или правами на редактирование).
- Выбор существующей коллекции заказов с проверкой полей или создание новой одной кнопкой.
- Сопоставление статусов CRM со статусами Метрики (`IN_PROGRESS`, `PAID`, `CANCELLED`, `SPAM`) с автоматической подсказкой.
- Отправка по расписанию (раз в час / сутки / неделю) или вручную. Изменённые заказы отправляются повторно.
- Даты передаются в часовом поясе счётчика, телефоны нормализуются (`8XXXXXXXXXX` → `7XXXXXXXXXX`).

### Требования

- Directus 12.
- Node.js 20+.
- Приложение в [Яндекс OAuth](https://oauth.yandex.ru/client/new).

### Установка

Расширение — bundle с API-частью (endpoint и hook), которая работает с базой данных и сервисами Directus, поэтому в песочнице (sandbox) оно не запускается.

**Из Marketplace.** По умолчанию (`MARKETPLACE_TRUST=sandbox`) Directus скрывает в Marketplace расширения, которые не работают в песочнице, поэтому без этой настройки Yandex Metrica не найдётся в поиске. Добавьте в `.env` и перезапустите Directus:

```env
MARKETPLACE_TRUST=all
```

Затем: *Настройки → Marketplace → Yandex Metrica → Install*.

> [!NOTE]
> `MARKETPLACE_TRUST=all` разрешает установку из Marketplace любых расширений без песочницы. Если не хотите оставлять эту настройку включённой, установите расширение через npm или вручную.

**Через npm** (Docker-образ или своя сборка):

```bash
npm install directus-extension-yandex-metrica
```

**Вручную.** Скопируйте `package.json` и папку `dist/` в `EXTENSIONS_PATH/directus-extension-yandex-metrica/` и перезапустите Directus.

### Настройка приложения Яндекс OAuth

1. Создайте приложение на [oauth.yandex.ru](https://oauth.yandex.ru/client/new), платформа — «Веб-сервисы».
2. Redirect URI: `https://oauth.yandex.ru/verification_code`.
3. Права доступа:
   - Яндекс Метрика — чтение (`metrika:read`) и запись (`metrika:write`);
   - Яндекс ID — доступ к логину (`login:info`).
4. Добавьте ClientID и Client secret в `.env` Directus:

```env
YANDEX_CLIENT_ID=...
YANDEX_CLIENT_SECRET=...
# необязательно: валюта, если у заказа нет поля currency (по умолчанию RUB)
METRIKA_CURRENCY=RUB
```

### Использование

1. Включите модуль: *Настройки → Настройки проекта → Модули → Яндекс Метрика*. Модуль виден только администраторам.
2. Откройте «Яндекс Метрика», нажмите «Подключить Яндекс», разрешите доступ и вставьте код подтверждения.
3. Выберите счётчик.
4. Выберите коллекцию заказов или создайте новую. Недостающие поля можно добавить кнопкой.
5. Проверьте сопоставление статусов и выберите расписание отправки.

> [!WARNING]
> Для корректной работы рекомендуется создать **новую** коллекцию заказов кнопкой в модуле: все поля будут сгенерированы автоматически с нужными типами, интерфейсами и статусами. В существующей коллекции поля с неподходящими типами не исправляются автоматически, а любое изменение записи (в том числе массовое или из других расширений) ставит заказ в очередь на повторную отправку.

При первом запуске расширение создаёт скрытую служебную коллекцию `metrika_connections` (одно подключение на экземпляр Directus).

### Поля коллекции заказов

Если создаёте коллекцию вручную, используйте эти ключи полей (имена должны совпадать точно) и типы. Модуль проверяет тип по колонке «Допустимые типы», а кнопка «Добавить недостающие поля» создаёт поле с типом из колонки «Тип при создании».

| Поле | Название | Уровень | Тип при создании | Допустимые типы | Настройки |
|---|---|---|---|---|---|
| `status` | Статус | обязательное | `string` | `string`, `text` | интерфейс Dropdown, значение по умолчанию `new` |
| `date_created` | Дата заказа | обязательное | `timestamp` | `timestamp`, `dateTime` | Date Created (заполняется автоматически) |
| `metrika_synced_at` | Отправлен в Метрику | обязательное, служебное | `timestamp` | `timestamp`, `dateTime` | пустое по умолчанию, скрытое, только чтение |
| `ym_client_id` | ClientID Метрики | идентификатор | `string` | `string`, `text` | |
| `phone` | Телефон | идентификатор | `string` | `string`, `text` | |
| `email` | Email | идентификатор | `string` | `string`, `text` | |
| `revenue` | Выручка | рекомендуется | `decimal` (12, 2) | `decimal`, `float`, `integer`, `bigInteger` | |
| `cost` | Себестоимость | рекомендуется | `decimal` (12, 2) | `decimal`, `float`, `integer`, `bigInteger` | |
| `currency` | Валюта | рекомендуется | `string` (3 символа) | `string`, `text` | код ISO 4217, по умолчанию `RUB` |

- Нужно хотя бы одно поле-идентификатор (`ym_client_id`, `phone` или `email`): по нему Метрика связывает заказ с визитом.
- Первичный ключ коллекции — любой (в новой коллекции это `id`, `integer` с автоинкрементом). Он передаётся в Метрику как ID заказа.
- Значения `status` сопоставляются со статусами Метрики на странице модуля. Стандартные значения: `new`, `in_work`, `paid`, `canceled`, `spam`.

- Пустой `metrika_synced_at` означает, что заказ ждёт отправки. Любое изменение заказа очищает это поле, и заказ уходит повторно (Метрика заменяет заказ по `id`).
- Заказы без ClientID, телефона и email отправить нельзя: Метрике не с чем их сопоставить. Такие заказы помечаются обработанными и пропускаются.
- За один запуск отправляется до 50 000 заказов пачками по 1000. Остальные уйдут в следующий запуск.

### Безопасность

- Все маршруты `/metrika/*` доступны только администраторам.
- Токены Яндекса хранятся в коллекции `metrika_connections` в скрытых полях. Не выдавайте не-администраторским ролям права на эту коллекцию.
- При отключении токен отзывается в Яндексе.

### Разработка

```bash
npm install
npm run dev        # сборка с отслеживанием изменений
npm run typecheck
npm run build
npm run validate
```

| Файл | Назначение |
|---|---|
| `src/module/` | страница «Яндекс Метрика» (`/admin/yandex-metrica`) |
| `src/endpoint.ts` | API `/metrika/*`: OAuth, счётчики, коллекции, ручная отправка |
| `src/hook.ts` | служебная коллекция, сброс `metrika_synced_at` при изменении, крон |
| `src/sync.ts` | формирование CSV и загрузка заказов в Метрику |
| `src/orders-schema.ts` | поля коллекции заказов, проверка, создание, статусы |
| `src/metrika-client.ts` | OAuth-токены и запросы к API Яндекса |

### Лицензия

[MIT](LICENSE)

---

## English

Uploads CRM orders from a Directus collection to Yandex Metrica ([simple orders upload](https://yandex.ru/dev/metrika/en/data-import/simple-orders-prep)), so Metrica can match orders with visits and track the "Order created" and "Order paid" goals.

### Features

- Connect a Yandex account via OAuth right in the Directus admin app; pick a counter (only counters you own or can edit are listed).
- Pick an existing orders collection with field validation, or create a new one in one click.
- Map CRM statuses to Metrica statuses (`IN_PROGRESS`, `PAID`, `CANCELLED`, `SPAM`) with automatic suggestions.
- Scheduled upload (hourly / daily / weekly) or manual. Changed orders are re-sent.
- Dates are sent in the counter's time zone; phone numbers are normalized (`8XXXXXXXXXX` → `7XXXXXXXXXX`).

### Requirements

- Directus 12.
- Node.js 20+.
- An app registered in [Yandex OAuth](https://oauth.yandex.com/client/new).

### Installation

This is a bundle with an API part (endpoint and hook) that uses the Directus database and services, so it cannot run in the sandbox.

**From the Marketplace.** By default (`MARKETPLACE_TRUST=sandbox`) Directus hides non-sandboxed extensions from the Marketplace, so Yandex Metrica will not show up in search until you add this to `.env` and restart Directus:

```env
MARKETPLACE_TRUST=all
```

Then go to *Settings → Marketplace → Yandex Metrica → Install*.

> [!NOTE]
> `MARKETPLACE_TRUST=all` allows installing any non-sandboxed extension from the Marketplace. If you'd rather not keep it enabled, install via npm or manually instead.

**With npm** (custom Docker image or build):

```bash
npm install directus-extension-yandex-metrica
```

**Manually.** Copy `package.json` and `dist/` into `EXTENSIONS_PATH/directus-extension-yandex-metrica/` and restart Directus.

### Yandex OAuth app setup

1. Create an app at [oauth.yandex.com](https://oauth.yandex.com/client/new), platform "Web services".
2. Redirect URI: `https://oauth.yandex.ru/verification_code`.
3. Permissions:
   - Yandex Metrica — read (`metrika:read`) and write (`metrika:write`);
   - Yandex ID — access to login (`login:info`).
4. Add the ClientID and Client secret to the Directus `.env`:

```env
YANDEX_CLIENT_ID=...
YANDEX_CLIENT_SECRET=...
# optional: currency used when an order has no currency field (defaults to RUB)
METRIKA_CURRENCY=RUB
```

### Usage

1. Enable the module in *Settings → Project Settings → Modules → Яндекс Метрика*. Only administrators can see it.
2. Open the module, click "Подключить Яндекс" (Connect Yandex), grant access and paste the confirmation code.
3. Select a counter.
4. Select an orders collection or create a new one. Missing fields can be added with one click.
5. Review the status mapping and choose an upload schedule.

> [!WARNING]
> For reliable operation, create a **new** orders collection with the button in the module: all fields are generated automatically with the correct types, interfaces and statuses. In an existing collection, fields with incompatible types are not fixed automatically, and any change to a record (including bulk edits or edits by other extensions) queues the order for re-upload.

On first start the extension creates a hidden system collection `metrika_connections` (one connection per Directus instance).

### Orders collection fields

If you create the collection by hand, use these field keys (names must match exactly) and types. The module validates against "Accepted types"; the "add missing fields" button creates fields with the type from "Type on creation".

| Field | Label | Level | Type on creation | Accepted types | Settings |
|---|---|---|---|---|---|
| `status` | Status | required | `string` | `string`, `text` | Dropdown interface, default `new` |
| `date_created` | Order date | required | `timestamp` | `timestamp`, `dateTime` | Date Created (filled automatically) |
| `metrika_synced_at` | Sent to Metrica | required, internal | `timestamp` | `timestamp`, `dateTime` | empty by default, hidden, read-only |
| `ym_client_id` | Metrica ClientID | identifier | `string` | `string`, `text` | |
| `phone` | Phone | identifier | `string` | `string`, `text` | |
| `email` | Email | identifier | `string` | `string`, `text` | |
| `revenue` | Revenue | recommended | `decimal` (12, 2) | `decimal`, `float`, `integer`, `bigInteger` | |
| `cost` | Cost | recommended | `decimal` (12, 2) | `decimal`, `float`, `integer`, `bigInteger` | |
| `currency` | Currency | recommended | `string` (3 chars) | `string`, `text` | ISO 4217 code, default `RUB` |

- At least one identifier field (`ym_client_id`, `phone` or `email`) is required: Metrica uses it to match the order with a visit.
- Any primary key works (a new collection gets `id`, auto-increment `integer`). It is sent to Metrica as the order ID.
- `status` values are mapped to Metrica statuses on the module page. Default values: `new`, `in_work`, `paid`, `canceled`, `spam`.

- An empty `metrika_synced_at` means the order is waiting to be sent. Any change to an order clears it, so the order is re-sent (Metrica replaces orders by `id`).
- Orders without a ClientID, phone or email cannot be matched by Metrica. They are marked as processed and skipped.
- Each run uploads up to 50,000 orders in batches of 1,000. The rest go out on the next run.

### Security

- All `/metrika/*` routes are admin-only.
- Yandex tokens are stored in hidden fields of the `metrika_connections` collection. Do not grant non-admin roles access to it.
- Disconnecting revokes the token at Yandex.

### Development

```bash
npm install
npm run dev        # watch mode
npm run typecheck
npm run build
npm run validate
```

### License

[MIT](LICENSE)
