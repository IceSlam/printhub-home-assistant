## 2.2.24

- Восстановлен исходный CUPS Raster pipeline XP-365B вместо `PDF -> pdftoppm -mono -> PBM -> TSPL`.
- Оригинальный `XP-365B.ppd` снова использует `cupsManualCopies: False` и `application/vnd.cups-raster`.
- Добавлен native CUPS Raster -> TSPL фильтр, собираемый из C-исходника под архитектуру Home Assistant.
- Профиль 58×40 снова растеризуется CUPS по исходной физической ширине PPD ~56 мм, при этом в интерфейсе/TSPL носитель остаётся 58×40 мм.
- Несколько копий отправляются одной аппаратной командой `PRINT N,1`, поэтому печать идёт непрерывно без пауз между экземплярами.
- AirPrint больше не делает software copies и передаёт количество копий основной очереди.
- Встроенный Agent повышен до 1.5.5.

# Changelog

## 2.2.23

- Исправлена оставшаяся после 2.2.22 регрессия качества: возвращены параметры исходного XP-365B PPD и последней заведомо исправной версии (`PrintSpeed=12`, `Darkness=15`). В 2.2.21 они были одновременно изменены на 5/10; отмена 56-мм bitmap resize в 2.2.22 не возвращала эти параметры, поэтому отдельные 203-DPI точки по краям толстых штрихов оставались заметными как «зубцы».
- Удалено принудительное ограничение `PrintSpeed <= 5` из `run.sh`, CUPS-фильтра и direct-TSPL пути Agent. Значения снова передаются так же, как до 2.2.21.
- Добавлена одноразовая миграция сохранённой пары 10/5 на прежний профиль 15/12 без перезаписи пользовательских настроек Supervisor; после любого ручного изменения override автоматически отключается.
- Безопасность тиражей и ошибок бумаги из 2.2.21/2.2.22 сохранена: software copies не умножаются повторно, зависший job отменяется, очередь использует `stop-printer`.
- Встроенный Agent повышен до 1.5.4.

## 2.2.22

- Удалено экспериментальное сжатие 58-мм печатной области до 56 мм, добавленное в 2.2.21. Оно выполнялось уже после монохромной растеризации PDF (464→448 точек), из-за чего тонкие штрихи и вертикальные границы штрихкодов получали выраженный aliasing/«зубцы».
- Печать 58×40 снова идёт в нативных 464×320 точках при 203 DPI и `BITMAP 0,0` без пост-растрового масштабирования.
- Direct-TSPL raster path Agent приведён к той же геометрии. Исправления N×N копий и безопасной остановки CUPS сохранены.
- Agent повышен до 1.5.3.

## 2.2.21

- Исправлено критическое умножение количества копий в CUPS-фильтре: при `cupsManualCopies=True` `pdftopdf` уже создаёт программные копии, поэтому `printhub-tspl` больше не повторяет их вторично через `PRINT N`. Сценарий 3 копии → 9 устранён.
- При тайм-ауте ожидания CUPS PrintHub теперь отменяет всё ещё активное задание через `cancel`, поэтому задание, уже помеченное ошибкой, не сможет неожиданно продолжить печать после замены бумаги/восстановления принтера.
- Политика очереди изменена с `retry-current-job` на безопасную `stop-printer`, чтобы ошибка USB/backend не запускала немедленную повторную передачу всего задания с начала.
- Для профилей с логической стороной 58 мм восстановлена внутренняя печатная область 56 мм с центрированием: CUPS/AirPrint/UI продолжают показывать `58×40`, но растр `58×40` печатается как 56×40 внутри этикетки с примерно 1 мм полями слева и справа.
- Скорость XP-365B в label mode ограничена фактическими 5 ips / 127 мм/с согласно спецификации модели; прежнее значение `SPEED 12` больше не отправляется принтеру. Новые установки используют `darkness=10`, `print_speed=5`.
- Agent повышен до 1.5.2.

## 2.2.20

- Внутренний sidebar переведён на чистую SPA-навигацию без изменения URL/hash. Это предотвращает пересоздание ingress-страницы Home Assistant и повторный splash при переходах между разделами PrintHub.
- Splash-screen остаётся частью начальной загрузки документа, поэтому показывается при новом открытии HA App из sidebar Home Assistant.

## 2.2.19
- Splash-screen отвязан от загрузки CUPS/API: он закрывается по собственному стартовому таймеру и больше не может оставаться поверх обычного loader при зависшем или недоступном CUPS.
- Splash-screen снова показывается при каждой новой загрузке ingress-документа PrintHub (то есть при каждом повторном открытии HA App из sidebar Home Assistant); sessionStorage/cookie-ограничение из 2.2.18 удалено.
- Внутренняя навигация HA App (`Обзор`, `Принтеры`, `Задания` и т. д.) больше не управляет splash-screen и использует только обычный page loader.
- CUPS-проверки для Overview ограничены 5 секундами; длительные discovery-таймауты сохранены на специализированной странице `Устройства`.
- При переходе между пунктами внутреннего sidebar предыдущий незавершённый page-request отменяется через `AbortController`, поэтому медленный ответ CUPS от старой страницы больше не может перерисовать текущий раздел.
- Удалён фоновый warm-up CUPS API, который повторно вызывал `overview/printers/jobs/classes` при `Cache-Control: no-store` и создавал лишнюю нагрузку на CUPS без реального кэширования.

## 2.2.18
- Первичный фирменный splash-screen HA WebUI теперь показывается только один раз за браузерную сессию, а не при каждом повторном открытии PrintHub из sidebar Home Assistant.
- При возврате в HA App после переключения на другой раздел Home Assistant используется обычный page loader без повторного полноэкранного splash-screen.
- Состояние показа сохраняется в `sessionStorage` с резервным session-cookie; стартовая разметка splash по умолчанию скрыта, поэтому при повторном ingress-load исключён краткий flash splash-screen до запуска JavaScript.

## 2.2.17
- Исправлена отправка заданий с iOS/AirPrint после CUPS security hardening 2026: `Send-Document`/`Close-Job` вынесены из owner-authenticated policy, чтобы удалённый `requesting-user-name` не обязан был существовать как локальный UNIX-пользователь.
- Остальные операции управления заданиями и CUPS administration сохраняют `@OWNER/@SYSTEM`; сетевой доступ по-прежнему ограничивается `<Location />`.
- Добавлена автоматическая миграция persistent `cupsd.conf` от предыдущих версий PrintHub, поэтому исправление применяется и к уже установленным App без удаления `/data`.

## 2.2.16
- В карточке принтера бейдж «По умолчанию» теперь выровнен по вертикальному центру относительно названия принтера через отдельный flex-контейнер заголовка.

## 2.2.15
- Исправлена desktop-навигация HA WebUI: burger/drawer теперь включается только по ширине viewport до 760 px; эвристика `hover:none/pointer:coarse`, ошибочно срабатывавшая в desktop WebView, удалена.
- Для desktop добавлен жёсткий reset drawer-состояния и sidebar расширен до 300 px.

## 2.2.14
- Исправлена сборка HA App при HTTPS-only доступе к Debian repositories: CA bundle теперь bootstrap-ится из полного официального `node:20-bookworm` build-stage до первого `apt-get update`.
- TLS-проверка не отключается; после установки `ca-certificates` системный trust store обновляется через `update-ca-certificates`.

## 2.2.13
- Первичный loader HA WebUI заменён на фирменный Splash-screen из Telegram WebApp: тот же логотип, радиальный фон, заголовок, подпись и spinner; минимальное отображение — около 1.5 секунды.
- Внутренние loaders при переходах между разделами сохранены без изменений.
- Синхронизированы cache-buster URL WebUI assets и отображаемая версия sidebar.

## 2.2.12
- Устранено двойное отображение AirPrint-принтера в iOS/macOS: удалена параллельная публикация через `bonjour-service`; единственным источником Bonjour/DNS-SD теперь является CUPS `_ipp._tcp,_universal`.
- Dashboard AirPrint больше не подставляет статический `XP365B_AirPrint`: отображаются фактическое название и фактическое системное имя очереди из CUPS.
- AirPrint PPD исправлены: профили 58×40, 58×60 и 40×58 теперь публикуют именно логические размеры 58 мм, а не прежние 56 мм.
- Внутренняя TSPL/print-коррекция остаётся независимой от публичного IPP media size.

## 2.2.11
- Исправлена локальная сборка Home Assistant App в сетях, где исходящий HTTP/80 заблокирован: все Debian APT repositories принудительно переведены на HTTPS/443.
- Для APT добавлены повторные попытки, IPv4-only режим и увеличенные сетевые тайм-ауты, чтобы кратковременные проблемы зеркала не ломали установку App.
- Перед `apt-get update` очищаются старые индексы, поэтому после сетевого сбоя APT не продолжает сборку с неполным/устаревшим cache.

## 2.2.10
- Исправлено обнаружение AirPrint на iPhone/iPad/macOS: отдельная AirPrint-очередь теперь явно публикуется через mDNS/Bonjour как `_ipp._tcp` с subtype `_universal`, а CUPS persistent config автоматически обновляется до `BrowseDNSSDSubTypes _cups,_print,_universal`.
- Добавлена независимая Bonjour-публикация через `bonjour-service`, поэтому обнаружение AirPrint больше не зависит только от системного DNS-SD responder.
- В Overview добавлена диагностика статуса Bonjour-публикации AirPrint.
- На desktop кнопка burger скрыта; sidebar остаётся постоянным и расширен до 284 px. Drawer/burger используется только на мобильных/сенсорных устройствах.

## 2.2.9
- Полностью переработан WebUI после AppSelect rewrite: добавлены общий стартовый loader, отдельный центрированный loader на страницах и фоновый warm-up основных API-запросов.
- На мобильных и десктопных экранах обновлена шапка: заголовок текущей страницы теперь всегда виден, увеличены внутренние отступы, а иконки меню/обновления стали аккуратнее.
- Чекбоксы в модалках принтеров и классов заменены на единый switch-style layout в одну строку.
- Упрощены страницы «Справка» и «Agent»: убраны верхние системные hero-блоки, оставлены только полезные разделы и заголовки.
- Добавлена фирменная иконка PrintHub (web app / favicon / add-on icon / logo), а ссылка на Classic CUPS в sidebar превращена в полноценную кнопку на всю ширину.
- Улучшено сохранение настроек сервера CUPS: интерфейс умеет переживать краткий разрыв соединения после применения конфигурации и автоматически переподключаться.


## 2.2.8
- AppSelect полностью переписан без Vue/SFC и без fallback `<select>`.
- Новый AppSelect — автономный JavaScript listbox/combobox с собственным trigger/menu, hidden input для FormData, клавиатурной навигацией, typeahead, click-outside и мобильным positioning.
- Удалена build-зависимость WebUI от Vite/Vue: AppSelect поставляется как обычные `web/app-select.js` + `web/app-select.css`, поэтому Supervisor/Docker build больше не может потерять SFC bundle.
- Все динамические dropdown автоматически монтируются через MutationObserver.
- `move job` и формы читают значение из единого AppSelect API / hidden input.

## 2.2.7
- AppSelect теперь загружается отдельным обязательным module-script и сам отслеживает динамически добавленные dropdown через MutationObserver.
- Аварийный native `<select>` больше не появляется сразу: fallback включается только если SFC bundle действительно не инициализировался за 1.8 секунды.
- Исправлено сохранение настроек CUPS Server: WebUI больше не вызывает `cupsctl` и не зависит от его TCP/auth поведения.
- Серверные настройки атомарно записываются в `cupsd.conf`, проверяются `cupsd -t` и применяются через SIGHUP. При ошибке выполняется автоматический откат предыдущего конфига.
- Устранены ошибки `cupsctl: Unable to connect to server: Bad file descriptor` и `cupsctl: Connection reset by peer` при сохранении.

## 2.2.6
- AppSelect полностью переработан в настоящий Vue SFC dropdown/listbox без нативного `<select>` в штатном режиме.
- Добавлены keyboard navigation, click-outside, Teleport-меню, hidden form input и автоматическое позиционирование dropdown.
- Загрузка AppSelect больше не зависит от порядка module script: основной WebUI динамически загружает SFC bundle и автоматически заменяет fallback.
- Исправлен `cupsctl: Unable to connect to server: Bad file descriptor`: CUPS clients/admin commands используют `127.0.0.1:631`, а `cupsctl` получает явный `-h 127.0.0.1:631`.
- Исправлена внутренняя версия All-in-One runtime до 2.2.6.

# Changelog

## 2.2.15
- Исправлена desktop-навигация HA WebUI: burger/drawer теперь включается только по ширине viewport до 760 px; эвристика `hover:none/pointer:coarse`, ошибочно срабатывавшая в desktop WebView, удалена.
- Для desktop добавлен жёсткий reset drawer-состояния и sidebar расширен до 300 px.

## 2.2.8
- AppSelect полностью переписан без Vue/SFC и без fallback `<select>`.
- Новый AppSelect — автономный JavaScript listbox/combobox с собственным trigger/menu, hidden input для FormData, клавиатурной навигацией, typeahead, click-outside и мобильным positioning.
- Удалена build-зависимость WebUI от Vite/Vue: AppSelect поставляется как обычные `web/app-select.js` + `web/app-select.css`, поэтому Supervisor/Docker build больше не может потерять SFC bundle.
- Все динамические dropdown автоматически монтируются через MutationObserver.
- `move job` и формы читают значение из единого AppSelect API / hidden input.

## 2.2.5
- Исправлен пустой WebUI: основной `app.js` больше не зависит от блокирующего static import SFC bundle.
- `AppSelect` загружается отдельным модулем; при его временной недоступности работает встроенный fallback, не блокирующий весь интерфейс.
- Исправлен двойной обработчик кнопки `☰`, из-за которого sidebar мог открываться и сразу закрываться.
- Иконки меню и обновления теперь встроены прямо в `index.html`, поэтому видны ещё до инициализации JavaScript.
- На мобильном внутренний дублирующий заголовок раздела скрыт; остаётся компактная toolbar-панель с меню и обновлением.

## 2.2.4
- Заменены псевдоиконки/emoji WebUI на единый набор Font Awesome Free Solid SVG.
- Sidebar, верхние кнопки, modal close, действия принтера и служебные кнопки теперь используют единый Font Awesome-набор.
- Исправлен AppSelect в разделе «Задания»: фильтр больше не обращается к отсутствующему native select до монтирования Vue SFC.
- Исправлен выбор очереди в действии «Переместить задание» через состояние AppSelect host.
- `app.js` теперь импортирует собранный AppSelect bundle как зависимость, поэтому Vue-компонент гарантированно готов до первого render.
- Внутренний CUPS manager переведён на `/run/cups/cups.sock`; существующий persistent `cupsd.conf` автоматически получает Unix-socket listener при обновлении.
- Исправлена ошибка `cupsctl: Unable to connect to server: Bad file descriptor` в настройках сервера.

## 2.2.3
- Нижняя мобильная навигация удалена полностью. Все разделы находятся только в левом sidebar.
- На мобильном и планшете sidebar работает исключительно как off-canvas drawer по кнопке `☰`.
- Удалены конфликтующие responsive-правила, которые раньше могли превращать nav в нижнюю/горизонтальную панель.
- Усилен обработчик открытия sidebar: добавлен прямой click-handler на кнопку меню и сохранён delegated fallback.
- После выбора раздела sidebar автоматически закрывается.
- Сохранены SFC AppSelect, SVG-иконки кнопок и полные переводы настроек HA.

## 2.2.2
- Исправлена фактическая причина отображения старого WebUI после обновления: статические CSS/JS больше не кешируются на час, для всех WebUI assets включён `no-store`, а URL ресурсов имеют version cache-buster.
- Мобильная навигация жёстко переведена в левый drawer/sidebar; нижнего navbar в мобильном CSS больше нет.
- Усилен обработчик кнопки меню и навигации через event delegation, добавлены ARIA-состояния открытия sidebar.
- Сохранён Vue SFC `AppSelect` для всех dropdown-полей и SVG-иконки для всех текстовых кнопок.
- Проверено полное покрытие schema переводами Home Assistant App; добавлен `ru-RU.yaml` как совместимый вариант русской локали.
- В боковом меню отображается версия WebUI, чтобы можно было сразу проверить, что Home Assistant открыл свежую сборку.

## 2.2.1
- Mobile bottom navigation полностью удалена; на телефоне используется выезжающий левый sidebar по кнопке `☰`.
- Исправлена логика открытия sidebar и затемнения фона.
- Убраны дубли заголовков `Принтеры / Задания / Классы / Устройства / Логи`: верхний заголовок страницы остаётся единственным.
- Сохранены все изменения 2.2.0: Vue SFC AppSelect, иконки всех кнопок и полные переводы настроек Home Assistant.

## 2.2.0
- Добавлен переиспользуемый Vue SFC-компонент `AppSelect.vue` для всех выпадающих списков modern WebUI.
- SFC-компоненты WebUI теперь собираются Vite отдельным build-stage при сборке Home Assistant App.
- Все dropdown-поля заданий, CUPS options, режима доступа и переноса задания переведены с нативной разметки на общий AppSelect.
- Ко всем текстовым кнопкам modern WebUI добавлены семантические SVG-иконки; навигационные и icon-only кнопки сохраняют свои собственные значки.
- Полностью заполнены `ru.yaml` и `en.yaml` для каждого поля Home Assistant App schema, поэтому Supervisor больше не должен показывать системные имена параметров вместо локализованных заголовков.
- Добавлены понятные описания всех параметров CUPS, Agent, AirPrint, WebSocket и локального API.

## 2.1.3
- Дополнительно исправлен мобильный нижний navigation bar modern WebUI: увеличен breakpoint мобильной версии, увеличены размеры кнопок/иконок/подписей, уменьшены нижние пустые отступы и панель плотнее прижата к низу экрана.

## 2.1.2
- Исправлен мобильный modern WebUI: увеличены иконки и подписи нижней навигации, нижняя панель теперь примыкает к низу экрана без лишнего пустого пространства.
- Нижняя навигация стала адаптивной и горизонтально прокручиваемой, поэтому все разделы WebUI доступны и на телефоне.
- Добавлено автоматическое обновление статусов и обзорных данных без ручного refresh.
- Статусы заданий, элементы управления и большинство параметров/настроек принтеров локализованы на русский язык.
- Тексты настроек сервера CUPS переведены на более понятные русские формулировки.

## 2.1.1
- Исправлен синтаксис `webui` в Home Assistant App config: `http://[HOST]:[PORT:8099]`.
- Исправление устраняет `StoreGitError`/ошибку валидации Supervisor при чтении локального App.
- Ingress остаётся на внутреннем порту 8099.

## 2.1.0
- Added local `/overview` API for the dedicated Home Assistant integration.
- `/overview` exposes CUPS server state, printers, main queue, AirPrint queue, USB presence, active CUPS jobs, classes and current PrintHub App settings.
- Added loopback-only `/control/printer-action` for safe HA actions (`test`, `purge`).
- Status/overview API now catches CUPS errors instead of risking an unhandled async request failure.
- Added `appVersion` to local health/status responses.
- Existing `/status` contract remains backward compatible.

## 2.0.0
- Merged PrintHub Agent and PrintHub CUPS into one Home Assistant App.
- Added Home Assistant Ingress modern WebUI on port 8099.
- Added modern administration for printers, options, jobs, classes, devices, drivers/PPD, server settings, logs and Agent diagnostics.
- Kept the original CUPS WebUI on port 631 as compatibility fallback.
- Added persistent `/data/cups/config` ServerRoot and persistent CUPS logs.
- Agent talks to the in-container CUPS scheduler on `127.0.0.1:631`.
- AirPrint and XP-365B TSPL filters are included in the same image.
