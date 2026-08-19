# PrintHub 3.3 — Telegram Bot + Telegram Web App

Система удалённой печати этикеток на Xprinter XP-365B. Основной быстрый сценарий **не изменён**: PDF можно отправить боту в личные сообщения через «Поделиться» из приложения маркетплейса. Дополнительно появился Telegram Web App для двух администраторов.

## Что появилось в 3.2

- Telegram Web App полностью закрыт до авторизации: до успешной проверки Telegram `initData` пользователь не видит интерфейс приложения вообще.
- Доступ разрешён только двум Telegram user ID из `TELEGRAM_ALLOWED_USER_IDS`.
- Добавлен просмотр состояния офисного агента: online/offline, last seen, USB/IP режим, очереди и последний транспорт печати.
- Авторизация Web App выполняется по подписанному Telegram `initData`; `ADMIN_API_KEY` вводить не нужно.
- Ручная загрузка PDF из Web App с профилями `Авто`, `58×40`, `75×120`.
- Автоопределение размера первой страницы PDF и передача соответствующего профиля агенту/CUPS.
- Раздел «Доступно для печати» с документами Ozon, Wildberries и Яндекс Маркета.
- Заказы в интерфейсе не отображаются: API-ответы нормализуются только в печатные документы.
- Список обновляется каждые 30 секунд. После смены статуса заказа/отгрузки документ исчезает при следующей синхронизации.
- Существующий офисный агент, CUPS и PPD сохранены.

## 1. Сервер

```bash
cp .env.example .env
nano .env
```

Обязательно заполнить:

```env
PUBLIC_URL=https://print.example.ru
WEBAPP_URL=https://print.example.ru/webapp/
AGENT_TOKEN=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_USER_IDS=111111111,222222222
```

`TELEGRAM_ALLOWED_USER_IDS` должен содержать ID двух администраторов через запятую.

Запуск:

```bash
docker compose build
docker compose up -d
docker logs -f printhub-server
```

Проверка:

```bash
curl https://print.example.ru/health
```

## 2. Nginx

Проксируйте весь домен на `127.0.0.1:8080`; WebSocket `/ws/agent` должен пропускать Upgrade/Connection. Web App обязательно должен открываться по HTTPS.

Пример есть в `docs/nginx.conf`.

## 3. Telegram

После запуска отправьте боту `/start`. Появится кнопка **«Открыть панель печати»**.

PDF в личных сообщениях продолжают работать как раньше:

1. Открыть этикетку в приложении Ozon/WB/Яндекс.
2. «Поделиться» → Telegram → бот.
3. Отправить.
4. Бот определит размер и отправит задание агенту.
5. Если размер определить нельзя, бот предложит `58×40` или `75×120` вручную.

## 4. Web App

В блоке «Ручная печать»:

- `Авто` — размер определяется по первой странице PDF;
- `58×40` — принудительный профиль;
- `75×120` — принудительный профиль.

Профиль передаётся агенту как `preset/profile`, а агент выбирает соответствующий `PageSize` PPD.

## 5. Marketplace API

### Ozon

```env
OZON_ENABLED=true
OZON_CLIENT_ID=...
OZON_API_KEY=...
```

Сервис получает актуальные FBS-отправления и показывает только документы, для которых предполагается печать этикетки. Сам файл загружается с Ozon только при нажатии «Печать».

### Wildberries

```env
WB_ENABLED=true
WB_API_TOKEN=...
```

Сервис использует FBS API и выводит только доступные стикеры сборочных заданий. Карточки заказов и товары Web App не получает в представление.

### Яндекс Маркет

```env
YANDEX_ENABLED=true
YANDEX_API_KEY=...
YANDEX_CAMPAIGN_IDS=123456,654321
```

Для нескольких магазинов campaignId указываются через запятую.

## 6. Почему документы пропадают автоматически

PrintHub не ведёт собственный список «необработанных заказов». При синхронизации каждый marketplace adapter заново получает только актуальные сущности в статусах, где ярлык ещё релевантен. Когда отправление отгружено/обработано и API перестаёт возвращать его в соответствующем статусе, печатный документ исчезает из Web App.

Кэш по умолчанию — 20 секунд:

```env
MARKETPLACE_CACHE_MS=20000
```

Кнопка обновления в Web App принудительно сбрасывает кэш.

## 7. Агент и CUPS

Для агента на OrangePi:

```bash
docker compose -f docker-compose.agent.yml build
docker compose -f docker-compose.agent.yml up -d
docker logs -f printhub-agent
```

В compose по умолчанию пробрасывается сокет CUPS хоста:

```yaml
volumes:
  - /run/cups/cups.sock:/run/cups/cups.sock
```

Проверьте очередь:

```bash
lpstat -p XP365B -v
lpoptions -p XP365B -l | grep -A20 PageSize
```

В `agent/XP-365B.ppd` включены профили `58×40`, `40×58`, `75×120`, `120×75`.

## 8. Безопасность

- Marketplace API keys находятся только на сервере и никогда не передаются в Web App.
- Web App проверяет криптографическую подпись Telegram `initData` на каждом API-запросе.
- После проверки дополнительно проверяется Telegram user ID.
- `AGENT_TOKEN` нужен только серверу и офисному агенту.
- Не публикуйте порт 8080 напрямую в интернет; используйте Nginx/HTTPS.

## 9. Важное по API маркетплейсов

API маркетплейсов меняются. Adapter-код вынесен отдельно в `server/src/marketplaces/`, поэтому изменение конкретного endpoint/status не затрагивает Telegram, Web App, очередь и агент. Ошибка одного маркетплейса не блокирует документы остальных — она выводится отдельным сообщением в панели.


## 10. USB как основной принтер + IP как резерв

Физически XP-365B подключён к OrangePi по USB. Агент не должен открывать `/dev/usb/lp0` напрямую: используется CUPS хоста и установленный PPD.

Основная CUPS-очередь, например:

```bash
lpstat -v XP365B
```

должна указывать на USB backend.

В `docker-compose.agent.yml`:

```yaml
environment:
  PRINTER_CONNECTION_MODE: "auto"
  CUPS_PRINTER_USB: "XP365B"
  CUPS_PRINTER_IP: "XP365B_IP"
  CUPS_SERVER: "/run/cups/cups.sock"
  PRINTER_HOST: "192.168.77.89"
  PRINTER_PORT: "9100"
volumes:
  - /run/cups/cups.sock:/run/cups/cups.sock
```

Режимы:
- `auto` — сначала `XP365B` по USB, при ошибке пробует `XP365B_IP`;
- `usb` — только USB/CUPS;
- `ip` — только IP/CUPS.

Чтобы IP-резерв сохранял то же качество PDF, создайте отдельную CUPS-очередь с тем же PPD и сетевым URI:

```bash
sudo lpadmin -p XP365B_IP -E -v socket://192.168.77.89:9100 -P /etc/cups/ppd/XP365B.ppd
sudo cupsenable XP365B_IP
sudo cupsaccept XP365B_IP
```

Проверка:

```bash
lpstat -v XP365B
lpstat -v XP365B_IP
```

## 11. Полная защита Telegram Web App

Статический URL `/webapp/` сам по себе не даёт доступ к панели. При загрузке показывается только экран проверки доступа.

Порядок:
1. Web App получает `Telegram.WebApp.initData`.
2. Вызывает `/api/webapp/me` с заголовком `x-telegram-init-data`.
3. Сервер проверяет подпись `initData` токеном бота и возраст `auth_date`.
4. Сервер проверяет Telegram user ID по `TELEGRAM_ALLOWED_USER_IDS`.
5. Только после успешного ответа клиент снимает auth-gate и показывает весь интерфейс.

Все WebApp API (`/me`, загрузка PDF, marketplace-документы, печать и статус агента) также защищены серверным `webAppAuth`.

## 12. Статус агента в Web App

Панель показывает:
- подключён/отключён;
- время последнего heartbeat;
- `auto / usb / ip`;
- USB CUPS queue;
- IP CUPS queue / адрес;
- какой транспорт использовался при последней успешной печати.

Агент отправляет heartbeat/status примерно каждые `WS_PING_MS` миллисекунд.


## Vue 3 Web App и Telegram-уведомления (3.3.0)

Frontend находится в `server/webapp` и собирается Vite во время Docker build. Все основные блоки реализованы Vue SFC-компонентами.

Обновление данных:
- список marketplace-документов — каждые 20 секунд реактивно;
- статус агента — каждые 5 секунд;
- ручное обновление не перезагружает страницу.

Настройки агента находятся в аккордеоне `Агент и принтер` внизу Web App.

Сервер отдельно от Web App проверяет новые документы маркетплейсов с периодом:

```env
MARKETPLACE_NOTIFY_MS=30000
```

По умолчанию при самом первом запуске существующие документы считаются базовой выборкой и уведомления о них не отправляются:

```env
MARKETPLACE_NOTIFY_INITIAL=false
```

Если установить `true`, после первого запуска уведомления будут отправлены и для уже доступных документов.

При появлении нового файла оба ID из `TELEGRAM_ALLOWED_USER_IDS` получают личное сообщение с кнопками:
- `🖨 Печать` — получает PDF из API маркетплейса и сразу создаёт задание агенту;
- `Открыть панель` — открывает Mini App.

Важно: пользователь должен хотя бы один раз открыть чат с ботом / нажать Start, иначе Telegram не разрешит боту начать личный диалог самостоятельно.

Для обновления версии:

```bash
docker compose down
docker compose build --no-cache
docker compose up -d --force-recreate
docker logs -f printhub-server
```

В логе должно быть `printhub-server@3.3.0`.


## WebSocket 3.3.1

Версия 3.3.1 изменяет подключение агента:

- `AGENT_TOKEN` проверяется до WebSocket handshake;
- агент передаёт token одновременно query-параметром и `Authorization: Bearer`;
- неверный token теперь даёт `HTTP 401`, а не `connected -> disconnected`;
- сервер выполняет WebSocket ping каждые 20 секунд;
- агент выводит close code/reason и HTTP-код отклонённого handshake.

После обновления:

```bash
# сервер
docker compose down
docker compose build --no-cache
docker compose up -d --force-recreate

# агент
cp .env.agent.example .env.agent
nano .env.agent
docker compose -f docker-compose.agent.yml down
docker compose -f docker-compose.agent.yml build --no-cache
docker compose -f docker-compose.agent.yml up -d --force-recreate
```

Нормальный лог агента:

```text
connecting wss://...
connected
hello from server iceslamprint-xp365b
```

После этого соединение остаётся открытым.

Если авторизация не проходит:

```text
websocket handshake rejected { statusCode: 401, statusMessage: 'Unauthorized' }
```

Если соединение закрывает proxy/backend после handshake:

```text
websocket closed { code: ..., reason: ... }
```


## 13. Локальная библиотека PDF и история печати (3.4.0)

Web App хранит выбранные пользователем PDF в постоянном Docker volume `./data`.

При ручной загрузке доступны:
- профиль `Авто / 58×40 / 75×120`;
- количество копий от 1 до 99;
- чекбокс `Сохранить в локальные`.

Чекбокс по умолчанию выключен. Без него файл используется только для текущего задания печати.

При включённом чекбоксе отдельная копия сохраняется в:

```text
data/library/
```

Метаданные библиотеки:

```text
data/library.json
```

Сохранённые PDF отображаются в Web App в разделе `Локально загруженные`. Файл можно переименовать и повторно отправить на печать с нужным количеством копий.

История печати находится в нижнем аккордеоне `История печати` и показывает последние 50 заданий:
- источник;
- профиль этикетки;
- количество копий;
- текущий статус;
- время;
- текст ошибки при неуспешной печати.

История обновляется реактивно примерно каждые 7 секунд и хранится в существующем `data/jobs.json`.


## 14. Исправление длинных имён PDF (3.4.1)

Длинные имена файлов в ручной загрузке больше не могут расширять WebApp за пределы экрана.
Имя выбранного PDF ограничено шириной зоны загрузки, переносится внутри контейнера максимум
на две строки и затем визуально обрезается. Аналогичное ограничение добавлено для названий
marketplace-документов, локальных PDF и истории печати.


## 15. Ozon FBS: cutoff filter (3.4.2)

Для `/v4/posting/fbs/unfulfilled/list` сервер теперь всегда передаёт:

```json
{
  "sort_dir": "ASC",
  "filter": {
    "cutoff_from": "...",
    "cutoff_to": "...",
    "status": "awaiting_deliver"
  }
}
```

Диапазон по умолчанию — 30 дней назад и 30 дней вперёд. Его можно изменить:

```env
OZON_FBS_CUTOFF_PAST_DAYS=30
OZON_FBS_CUTOFF_FUTURE_DAYS=30
```

Старый автоматический fallback на `/v3/posting/fbs/unfulfilled/list` удалён.
PrintHub работает с актуальным `/v4/posting/fbs/unfulfilled/list`, поэтому ошибка v4
больше не скрывается повторным запросом в v3.


## 16. Ozon FBS pagination (3.4.3)

Ozon `/v4/posting/fbs/unfulfilled/list` принимает `limit` только от 1 до 100.
PrintHub теперь использует:

```json
{
  "limit": 100,
  "offset": 0
}
```

и автоматически запрашивает последующие страницы:

```text
offset=0
offset=100
offset=200
...
```

до тех пор, пока Ozon не вернёт меньше 100 отправлений.

Это позволяет корректно отображать более 100 доступных FBS-этикеток.

Для страховочного ограничения количества страниц:

```env
OZON_FBS_MAX_PAGES=50
```

По умолчанию это максимум 5000 отправлений за один цикл синхронизации.


## 17. Упрощённый PPD (3.4.4)

В CUPS оставлены только размеры этикеток, используемые PrintHub:

```text
58 x 40 mm   -> w5.8h4
40 x 58 mm   -> w4h5.8
75 x 120 mm  -> w7.5h12
120 x 75 mm  -> w12h7.5
```

Все стандартные и дюймовые размеры бумаги удалены из списков `PageSize` и `PageRegion`.

Для профиля `58 x 40 mm` физическая область печати по-прежнему 56 x 40 мм,
для `40 x 58 mm` — 40 x 56 мм, как было настроено ранее.


## 18. AirPrint-safe PPD (3.4.5)

В старом PPD оставалась секция `CustomPageSize`, поэтому CUPS мог рекламировать через IPP
поддержку произвольных размеров. В 3.4.5 она удалена полностью.

Файлы:

```text
agent/XP-365B.ppd                  универсальный PrintHub: 4 marketplace-профиля
agent/XP-365B-58x40-AirPrint.ppd   только одна бумага 58×40
agent/XP-365B-75x120-AirPrint.ppd  только одна бумага 75×120
agent/XP-365B-40x58-AirPrint.ppd   только одна бумага 40×58
agent/XP-365B-120x75-AirPrint.ppd  только одна бумага 120×75
```

Для AirPrint рекомендуется публиковать две отдельные очереди:
`XP365B_58x40` и `XP365B_75x120`, каждая со своим single-size PPD.
Тогда AirPrint-клиент получает от каждой очереди только один поддерживаемый media size.


## 19. Локальные файлы в аккордеоне (3.4.6)

Порядок блоков в Telegram Mini App теперь:

```text
Ручная печать
Доступно для печати — Ozon / WB / Яндекс
Локально загруженные — аккордеон
История печати — аккордеон
Агент и принтер — аккордеон
```

Аккордеон `Локально загруженные` в закрытом состоянии показывает количество
сохранённых PDF. После раскрытия доступны переименование, выбор количества копий
и повторная печать.


## 20. Отключение zoom при вводе на iOS (3.4.7)

Telegram Mini App больше не должен автоматически увеличивать страницу при фокусе
на текстовом или числовом поле.

Используются два механизма:

```html
<meta
  name="viewport"
  content="width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover"
>
```

и минимальный `font-size: 16px` для `input`, `select` и `textarea`.

На iOS WebKit автоматически увеличивает страницу при фокусе на поле с размером
шрифта меньше 16 px, поэтому это правило применяется и к компактным полям
количества копий и переименования файла.


## 21. CUPS auto fallback (3.4.8 / agent 1.2.2)

`PRINTER_CONNECTION_MODE=auto` теперь работает следующим образом:

```text
1. Проверить CUPS_PRINTER_USB через lpstat
2. Если очередь существует -> попробовать USB/CUPS
3. Если очередь отсутствует -> записать причину и пропустить
4. Проверить CUPS_PRINTER_IP через lpstat
5. Если IP-очередь отсутствует -> НЕ вызывать lp -d для неё
6. При ошибке USB попробовать только реально существующий fallback
7. Если печать не удалась, вернуть объединённую диагностику
```

Например, при:

```env
PRINTER_CONNECTION_MODE=auto
CUPS_PRINTER_USB=XP365B
CUPS_PRINTER_IP=XP365B_IP
```

и отсутствии `XP365B_IP` агент больше не выполняет:

```text
lp -d XP365B_IP ...
```

Если `XP365B` существует и принимает задание, печать завершается через USB.

Новый лог:

```text
CUPS queue available { printer: 'XP365B', transport: 'USB / CUPS' }
CUPS queue unavailable; skipping { printer: 'XP365B_IP', ... }
printing PDF via CUPS { printer: 'XP365B', ... }
CUPS print accepted { printer: 'XP365B', ... }
```

Если USB-очередь существует, но `lp` завершается ошибкой, сообщение задания содержит
ошибку USB и состояние резервной очереди, а не только последнюю ошибку `XP365B_IP`.


## 22. Галерея локальных PDF (3.5.0)

Аккордеон `Локально загруженные` получил два режима:

```text
Галерея — по умолчанию
Список
```

Для каждого сохранённого PDF сервер формирует WebP-превью первой страницы.
Новые файлы получают thumbnail сразу после сохранения. Для файлов, созданных
в предыдущих версиях, превью генерируется лениво при первом открытии галереи.

Превью хранятся отдельно от оригинальных PDF:

```text
data/
├── library/
│   └── <id>.pdf
├── previews/
│   └── <id>/
│       ├── thumb-page-1.webp
│       ├── full-page-1.webp
│       └── full-page-2.webp
└── library.json
```

Оригинальный PDF не преобразуется и продолжает использоваться для печати.

Серверный Docker-образ теперь содержит `poppler-utils`. Рендер выполняется через
`pdftoppm`, а итоговое изображение оптимизируется `sharp` в WebP.

API:

```text
GET /api/webapp/local-files/:id/preview?page=1&size=thumb
GET /api/webapp/local-files/:id/preview?page=1&size=full
```

Оба endpoint защищены Telegram WebApp initData так же, как остальные API.

При нажатии на миниатюру открывается просмотр:
- крупное изображение страницы;
- переход между страницами многостраничного PDF;
- номер текущей страницы;
- количество копий;
- отправка оригинального PDF на печать прямо из окна просмотра.


## 23. Ручная печать как отдельный раздел (3.5.1)

Главный экран Mini App больше не показывает весь блок ручной печати сразу.
Вместо этого отображается компактная карточка-кнопка **«Открыть ручную печать»**.

При нажатии открывается отдельное модальное окно/раздел, внутри которого находятся:
- форма ручной печати PDF;
- выбор профиля печати;
- количество копий;
- опция сохранения в локальную библиотеку;
- блок `Локально загруженные`.

`Локально загруженные` больше не выводится на основном экране и теперь расположен
внутри раздела ручной печати.

Кнопки выбора размера переработаны в карточки:
- `Авто` — определить по PDF;
- `58×40` — этикетка отправления;
- `75×120` — поставка / склад.


## 24. CUPS/Orange Pi resilience (3.5.2, agent 1.3.0)

Исправлена причина, при которой host CUPS работает, а внутри контейнера:

```text
scheduler is not running
```

Старый compose монтировал один файл:

```text
/run/cups/cups.sock:/run/cups/cups.sock
```

После рестарта CUPS socket пересоздаётся. Контейнер мог продолжать держать старый bind-mounted inode.
Теперь монтируется весь runtime-каталог:

```text
/run/cups:/run/cups
```

Поэтому новый `cups.sock` автоматически становится видимым контейнеру.

Агент 1.3.0 дополнительно:
- проверяет `lpstat -r` до печати;
- ждёт восстановления scheduler до 20 секунд;
- повторяет `lp` при transient CUPS errors;
- различает недоступный scheduler и отсутствующую очередь;
- отслеживает accepted CUPS job до выхода из pending queue;
- отправляет CUPS health в Mini App;
- периодически проверяет CUPS даже без заданий.

Для Orange Pi добавлен:

```bash
sudo ./host/setup-orange-pi.sh
```

Он включает persistent journal, CUPS self-healing timer, USB power rule и systemd hardware watchdog (если `/dev/watchdog*` доступен).


## 25. Agent environment fallback (3.5.3 / agent 1.3.1)

Исправлен запуск агента при неполном `.env.agent`.

Для текущего инсталляционного проекта встроены безопасные значения:

```text
SERVER_URL=https://print.iceslam.ru
WS_URL=wss://print.iceslam.ru/ws/agent
AGENT_ID=iceslamprint-xp365b
CUPS_SERVER=/run/cups/cups.sock
```

`SERVER_URL` и `WS_URL` также умеют вычисляться друг из друга:

- если есть только `WS_URL`, HTTP base URL строится из него;
- если есть только `SERVER_URL`, WebSocket URL строится автоматически;
- если нет обоих, используются значения PrintHub выше.

Единственная обязательная секретная переменная агента:

```env
AGENT_TOKEN=...
```

Она должна совпадать с `AGENT_TOKEN` серверной части.

`docker-compose.agent.yml` теперь явно передаёт несекретные значения по умолчанию,
поэтому старый `.env.agent`, содержащий только token/параметры принтера, также работает.

Проверка после запуска:

```bash
docker exec printhub-agent env | grep -E 'SERVER_URL|WS_URL|AGENT_ID|CUPS_SERVER'
docker logs --tail 50 printhub-agent
```

В логе агент сначала выводит разрешённую конфигурацию без раскрытия `AGENT_TOKEN`.


## 26. Mobile UI + agent print isolation (3.5.4 / agent 1.3.2)

### Ручная печать

В мобильном sheet:
- область выбора PDF уменьшена по высоте;
- `Авто`, `58×40`, `75×120` всегда расположены в один ряд;
- карточки профилей сделаны компактнее.

### История

API по-прежнему возвращает последние 50 заданий. В раскрытом блоке визуально
помещается примерно 4 карточки, остальные доступны внутренним вертикальным скроллом.
Длинный текст ошибки ограничен двумя строками, чтобы одна ошибка не занимала весь экран.

### Агент

Печатные задания теперь выполняются собственной последовательной очередью:
одновременно работает только одно задание. Это предотвращает параллельный запуск
нескольких `lp`, `lpstat`, `pdfinfo` и обработчиков PDF на Orange Pi.

WebSocket heartbeat отделён от печатного worker:
- JSON status каждые 10 секунд;
- нативный WebSocket ping каждые 10 секунд;
- reconnect при отсутствии pong 45 секунд;
- reconnect защищён от параллельных таймеров;
- terminal result (`job:done` / `job:failed`) буферизуется при кратковременном
  разрыве и отправляется после переподключения;
- активное задание не теряется при переподключении WebSocket;
- периодическая CUPS health-проверка не запускается параллельно с активной печатью.

Mini App также получает `busy`, `activeJobId` и размер внутренней очереди агента.


## 27. Home Assistant Agent App (3.6.0)

Добавлен второй способ запуска агента — отдельный Home Assistant App:

```text
homeassistant_apps/
├── repository.yaml
└── printhub_agent/
    ├── config.yaml
    ├── Dockerfile
    ├── package.json
    ├── DOCS.md
    ├── README.md
    ├── CHANGELOG.md
    ├── translations/
    │   ├── ru.yaml
    │   └── en.yaml
    └── src/
        ├── homeassistant-entrypoint.js
        └── agent.js
```

Standalone Docker Agent остаётся в проекте и продолжает работать независимо.

Home Assistant вариант не подключается к USB напрямую:

```text
PrintHub Agent App -> CUPS/IPP :631 -> установленный CUPS App -> USB printer
```

По умолчанию:

```yaml
cups_server: 127.0.0.1:631
cups_printer: XP365B
```

Shared Agent обновлён до 1.4.0 и получил режим:

```text
PRINTER_CONNECTION_MODE=cups
```

для внешнего CUPS scheduler независимо от того, является физический принтер USB
или сетевым.

## 28. UI motion (3.6.1)

Добавлены переходы между экраном авторизации и приложением, анимации основных секций,
аккордеонов, обеих модалок и toast-уведомлений. При `prefers-reduced-motion: reduce`
анимации автоматически практически отключаются.


## 29. PrintHub 3.7.0 — Motion, notifications and Home Assistant integration

### Mini App

Notifications are now global and are rendered above all modals. A print action produces
an immediate "sending" notification, then a success/error notification. Polling history
also surfaces terminal `done`/`failed` job states.

Manual print and PDF preview use separate GPU-friendly transitions. Modal state is not
cleared until the leave animation has completed, which removes the previous closing jump.

### Home Assistant

The bundled PrintHub Agent App 1.1.0 exposes:

```text
http://127.0.0.1:35994/status
```

The new integration is located at:

```text
homeassistant_integration/custom_components/printhub
```

Copy that directory to:

```text
/config/custom_components/printhub
```

Restart Home Assistant and add **PrintHub** from Devices & services.

The integration uses a UI Config Flow and polls the Agent status API. It can optionally
use PrintHub Server `/health` and `/api/jobs` (when `ADMIN_API_KEY` is configured).


## 30. Telegram bot parity and copy steppers (3.9.0)

The Telegram bot now provides a full inline menu:

```text
🖨 Быстрая печать PDF     📥 Загрузить PDF
📚 Локальные PDF          🏪 Маркетплейсы
🕘 История                🟢 Агент и принтер
🌐 Открыть WebApp
```

`📥 Загрузить PDF` saves the next PDF to the local PrintHub library without creating
a print job.

Local files can be previewed, renamed and printed from the bot. Copy counts are
controlled with `− / N / +` inline buttons. Marketplace files and manual bot printing
also support copy selection.

The WebApp uses the reusable `CopyStepper.vue` control in manual printing, local
library cards/list rows and PDF preview. It also has a separate save-only action.


## 31. Local search and favorites (3.10.0)

The local PDF library now supports instant name/profile search and persistent favorites. Favorites are stored in `library.json`, sorted first, and available from both the WebApp and Telegram bot.

## Критическое исправление печати копий и восстановления после ошибки (3.16.31)

Для XP-365B CUPS PPD использует `cupsManualCopies: True`. Поэтому `pdftopdf` уже
разворачивает заданное количество копий в страницы. Финальный `printhub-tspl` обязан
печатать каждую полученную страницу ровно один раз (`PRINT 1,1`). Повторное использование
CUPS `copies` в TSPL приводит к N×N копиям (например, 3 → 9).

Если CUPS job не завершился до `cups_job_timeout_seconds`, PrintHub отменяет его через
`cancel`, прежде чем вернуть ошибку. Это исключает ситуацию, когда WebApp уже показывает
ошибку, а старое задание после замены рулона внезапно продолжает печататься.

Профиль в UI и IPP по-прежнему называется `58×40`, но внутренний растр для него имеет
ширину 56 мм и центрируется внутри 58-мм носителя. Это даёт примерно по 1 мм бокового поля
и не обрезает штрихкод у края. Параметры нагрева/скорости берутся из профиля XP-365B без скрытого ограничения PrintHub.

## Исправление качества штрихкодов после 3.16.31 (3.16.33)

Эксперимент с внутренней печатной шириной 56 мм из 3.16.31 отменён. PDF 58×40 при
203 DPI Poppler изначально растеризует ровно в 464×320 точек. Последующее сжатие уже
монохромного PBM до 448 точек по ширине меняло дискретную геометрию штрихов и давало
зубчатые вертикальные границы.

PrintHub снова передаёт 58×40 как нативный растр 464×320 без пост-растрового ресайза.
Если в будущем понадобится безопасная зона по краям, её нужно формировать до 1-битной
растеризации (на уровне PDF/layout), а не сжимать готовый barcode bitmap.

Критические исправления 3.16.31 для количества копий и отмены зависших CUPS jobs при
этом сохранены.

## Возврат исходного CUPS Raster тракта XP-365B (3.16.34)

Диагностика показала, что проблема качества оставалась даже после отмены пост-растрового resize, потому что HA App всё ещё не использовал исходный тракт PPD. Основная очередь была переведена на `application/vnd.cups-pdf -> printhub-tspl`, где PDF независимо растеризовался через `pdftoppm -mono`. Теперь восстановлена схема оригинального PPD: `PDF -> CUPS/Ghostscript Raster -> rastertosnailtspl-xprinter -> TSPL`. Для `w5.8h4` сам PPD задаёт физическую ширину 158.74 pt (около 56 мм), хотя пользовательский профиль называется 58×40; CUPS растеризует в эту область до бинарной упаковки, поэтому штрихкод не масштабируется уже после растрирования. `cupsManualCopies=False` оставляет размножение копий аппаратной команде принтера, что убирает паузу между одинаковыми этикетками.
