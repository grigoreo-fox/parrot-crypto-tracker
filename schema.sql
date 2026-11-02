-- SQLite: каталог CoinMarketCap, отслеживание и история собранных цен.
-- При удалении из отслеживания история цен сохраняется; формат API уточняется.
-- PRAGMA foreign_keys действует для каждого соединения и должен включаться
-- приложением при открытии каждого соединения с базой.
PRAGMA foreign_keys = ON;

-- Локальный каталог для поиска по названию, тикеру и slug.
-- Отсутствие записи в очередном ответе CMC само по себе не означает удаление:
-- каталог может загружаться постранично или запрос может завершиться ошибкой.
CREATE TABLE cryptocurrencies (
    id                 INTEGER PRIMARY KEY CHECK (id > 0),
    name               TEXT NOT NULL CHECK (length(trim(name)) > 0),
    symbol             TEXT NOT NULL CHECK (length(trim(symbol)) > 0),
    slug               TEXT NOT NULL CHECK (length(trim(slug)) > 0),
    catalog_updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- CMC ID — единственный идентификатор валюты; отдельного внутреннего ID нет.
-- На одну валюту может приходиться только одна запись отслеживания.
-- is_active позволяет приостановить отслеживание, не теряя историю.
-- updated_at и last_synced_at приложение обновляет явно: первый при изменении
-- записи отслеживания, второй после успешного сохранения цены.
CREATE TABLE tracked_currencies (
    cryptocurrency_id INTEGER PRIMARY KEY REFERENCES cryptocurrencies(id) ON DELETE RESTRICT,
    is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_synced_at TEXT
);

-- Каждая строка — полученное нами наблюдение, не загруженная из CMC история.
-- Цена хранится как десятичная строка, чтобы SQLite REAL не округлял её при
-- сохранении. Приложение обязано проверять формат и неотрицательность цены;
-- числовые сравнения и агрегации по TEXT требуют отдельного решения.
-- quote_currency фиксируется при получении цены, а не вычисляется из текущего ENV.
CREATE TABLE prices (
    id                INTEGER PRIMARY KEY,
    cryptocurrency_id INTEGER NOT NULL REFERENCES cryptocurrencies(id) ON DELETE RESTRICT,
    price             TEXT NOT NULL CHECK (length(trim(price)) > 0),
    quote_currency    TEXT NOT NULL CHECK (
        length(trim(quote_currency)) > 0 AND quote_currency = upper(trim(quote_currency))
    ),
    fetched_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    source_updated_at TEXT
);

-- Выбор последней цены в конкретной валюте котировки и просмотр истории.
CREATE INDEX idx_prices_currency_quote_fetched
    ON prices (cryptocurrency_id, quote_currency, fetched_at DESC, id DESC);
CREATE INDEX idx_prices_currency_fetched
    ON prices (cryptocurrency_id, fetched_at DESC, id DESC);

-- Индексы помогают точному и префиксному поиску без учёта регистра ASCII.
-- Подстрочный поиск через LIKE '%...%' обычно использует сканирование таблицы.
CREATE INDEX idx_cryptocurrencies_name_nocase ON cryptocurrencies (name COLLATE NOCASE);
CREATE INDEX idx_cryptocurrencies_symbol_nocase ON cryptocurrencies (symbol COLLATE NOCASE);
CREATE INDEX idx_cryptocurrencies_slug_nocase ON cryptocurrencies (slug COLLATE NOCASE);
