# Parrot Crypto Tracker

[![CI](https://github.com/grigoreo-fox/parrot-crypto-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/grigoreo-fox/parrot-crypto-tracker/actions/workflows/ci.yml)
[![Coverage](https://grigoreo-fox.github.io/parrot-crypto-tracker/coverage.svg)](https://github.com/grigoreo-fox/parrot-crypto-tracker/actions/workflows/ci.yml)

REST API для отслеживания криптовалют и сохранения истории цен через CoinMarketCap.

## Запуск через Docker Compose

Нужны Docker с Compose и API Key CoinMarketCap.

1. Скопируйте `.env.example` в `.env` и заполните `CMC_PRO_API_KEY` и `API_BEARER_TOKEN`. Токен собственного API должен содержать не менее 32 символов без пробелов. Его можно сгенерировать командой `openssl rand -hex 32`. Не публикуйте `.env`.
2. Запустите сервис:

   ```sh
   docker compose up -d --build
   ```

3. Проверьте доступность: `curl http://localhost:3000/health`. Логи: `docker compose logs -f app`.
4. Остановите сервис: `docker compose down`.

Внешний порт по умолчанию — 3000; его можно изменить через `HOST_PORT` в `.env` или окружении. Compose публикует порт на всех интерфейсах хоста: ограничьте доступ на уровне сети, если это необходимо. Внутри контейнера приложение слушает порт 3000, а SQLite хранится в `/data/data.sqlite` на именованном volume `sqlite-data`. Параметры `PORT` и `DATABASE_PATH` из локального `.env` на контейнер не влияют.

`docker compose down` сохраняет volume и данные; **`docker compose down -v` удаляет их**. Пустой каталог синхронизируется в фоне после запуска; если каталог уже сохранён, перезапуск не запускает синхронизацию, а ждёт следующего срока от `catalog_updated_at`. До появления валюты в каталоге её добавление может вернуть 404. Для работы с защищёнными маршрутами передавайте `Authorization: Bearer <API_BEARER_TOKEN>`.

Интервалы задаются в минутах: `PRICE_SYNC_INTERVAL_MINUTES` (по умолчанию 5) и `CATALOG_SYNC_INTERVAL_MINUTES` (по умолчанию 1440). Доступны также `QUOTE_CURRENCY` и `LOG_LEVEL`; примеры — в `.env.example`.

При проверке до добавления инструментов OpenAPI на Linux amd64 с локальным Node.js 22 / Debian Bookworm размер build-стадии составил 699 МБ, итогового образа — 261 МБ (`docker image inspect`, размеры в десятичных МБ). Это сравнение стадий текущей сборки, а не замер против отдельного оптимизированного одностадийного Dockerfile; размеры зависят от базового образа и платформы.

## Разработка и тесты

Для разработки и проверки OpenAPI нужны Node.js не ниже 18.19 и npm не ниже 9.5 (требования инструментов и их зависимостей); полная совместимость runtime с Node.js 18 пока не проверена. Установите зависимости из lockfile:

```sh
npm ci
npm run validate:openapi
npm test
npm run test:coverage
npm run build
npm start
```

Для локального запуска заполните `.env`; можно вручную обновить каталог командой `npm run sync:catalog`. Совместимость полного набора зависимостей с Node.js 18 ещё требует отдельной проверки.

`npm run test:coverage` выводит покрытие серверной части в терминал и создаёт HTML-отчёт `coverage/lcov-report/index.html`; браузерные скрипты интерфейса и Swagger UI из покрытия исключены. GitHub Actions запускает проверку типов, OpenAPI и тесты с покрытием при каждом push и pull request; отчёт доступен в артефакте `coverage-report` соответствующего запуска.

## Конфигурация

Переменные окружения имеют приоритет над `.env`; ключи CMC и нашего API различаются.

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `CMC_PRO_API_KEY` | нет | Обязательный ключ CoinMarketCap, без пробелов. Не передаётся клиентам. |
| `API_BEARER_TOKEN` | нет | Обязательный секрет собственного API, не менее 32 символов без пробелов. |
| `PORT` | `3000` | Порт локального приложения, 1–65535; в Compose порт контейнера всегда 3000. |
| `HOST_PORT` | `3000` | Внешний порт только для Compose. |
| `DATABASE_PATH` | `./data.sqlite` | Путь к SQLite при локальном запуске; в Compose используется volume `/data`. |
| `QUOTE_CURRENCY` | `USD` | Символ валюты котировки, буквы и цифры. |
| `PRICE_SYNC_INTERVAL_MINUTES` | `5` | Интервал фоновой синхронизации цен, целое число 1–35791. |
| `CATALOG_SYNC_INTERVAL_MINUTES` | `1440` | Интервал синхронизации каталога, целое число 1–35791. |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug` или `trace`. |

## Использование API

Полный контракт реализованных маршрутов, параметры и ответы: [`openapi.json`](./openapi.json), OpenAPI 3.0.3. Интерактивная Swagger UI доступна на публичном `/docs`, а спецификация — на `/docs/openapi.json`; сторонний CDN не используется. Не вводите Bearer token в Swagger UI по незащищённому соединению. `npm run validate:openapi` проверяет спецификацию через Redocly с правилами `redocly.yaml`; контрактные тесты в `npm test` проверяют выбранные ответы Supertest по этой спецификации. `/health` публичный, остальные маршруты требуют Bearer token.

Пример локального сценария (подставьте собственный токен в переменную `TOKEN`):

```sh
curl http://localhost:3000/health
curl -H "Authorization: Bearer $TOKEN" 'http://localhost:3000/v1/cryptocurrency/map?q=bitcoin&limit=10'
curl -X POST http://localhost:3000/v1/cryptocurrency/tracked \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"id":1}'
curl -H "Authorization: Bearer $TOKEN" 'http://localhost:3000/v1/cryptocurrency/tracked?start=1&limit=10'
curl -H "Authorization: Bearer $TOKEN" 'http://localhost:3000/v1/cryptocurrency/prices/latest?id=1'
curl -H "Authorization: Bearer $TOKEN" 'http://localhost:3000/v1/cryptocurrency/prices/historical?id=1&count=10'
```

Сначала дождитесь наполнения локального каталога. Если валюты ещё нет, добавление вернёт `404`; если она уже отслеживается — `409`. Сразу после добавления цена может отсутствовать: `latest` вернёт `price: null` до успешной фоновой синхронизации. История возвращает только наблюдения, собранные сервисом, а не историю из CMC. Следующую страницу запрашивают с `cursor` из `meta.next_cursor` и теми же валютами и временными границами. `null` означает конец; между запросами данные и `total` могут меняться.

## Ограничения и устройство

- Если CMC недоступен, сохранённые цены остаются доступны; ошибки синхронизации логируются, следующая попытка — по расписанию. Каталог сохраняется постранично и не очищает отсутствующие в ответе записи.
- Цена хранится как SQLite `REAL` и возвращается числом с плавающей точкой: точные финансовые вычисления не гарантируются ([ADR 0001](./ADR/0001-price-representation.md)).
- Инструменты проверки OpenAPI — дополнительные dev-зависимости. По `npm audit` у цепочки Redocly есть уязвимость `@faker-js/faker` в dev-зависимостях; валидируйте доверенные файлы, не используйте этот набор для обработки недоверенных спецификаций. `npm audit --omit=dev` уязвимостей не обнаружил на момент проверки.
- `better-sqlite3` — дополнительный синхронный драйвер вне явного списка библиотек задания; обоснование и необходимость согласования — в [ADR 0002](./ADR/0002-sqlite-driver.md). Другие дополнительные зависимости описаны в `PRD.md`.
- Поиск в каталоге доступен через `GET /v1/cryptocurrency/map`: необязательный `q` ищет буквальную подстроку в имени, символе и slug без учёта регистра ASCII. Без `q` возвращается весь каталог с пагинацией.
- Интерфейс `/` позволяет вручную ввести токен, искать валюты, управлять отслеживанием и просматривать историю; токен хранится в памяти страницы до перезагрузки. Иконки загружаются браузером напрямую с `s2.coinmarketcap.com` и могут отсутствовать. Используйте HTTPS или localhost: Bearer token нельзя безопасно передавать по обычному HTTP через недоверенную сеть. График показывает до 500 последних загруженных точек в валюте котировки последней записи.

Архитектура и ограничения — в [`ARCHITECTURE.md`](./ARCHITECTURE.md), требования и проектные решения — в [`PRD.md`](./PRD.md), решения — в [`ADR/`](./ADR/). PRD включает и запланированные маршруты; реализованный контракт — в `openapi.json`.
