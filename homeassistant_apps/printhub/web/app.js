const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const NAV = [
  ['overview', 'overview', 'Обзор', 'Состояние PrintHub, CUPS и очередей'],
  ['printers', 'printers', 'Принтеры', 'Очереди, драйверы, доступ и параметры'],
  ['jobs', 'jobs', 'Задания', 'Активные и завершённые задания печати'],
  ['classes', 'classes', 'Классы', 'Пулы и группы принтеров'],
  ['devices', 'devices', 'Устройства', 'Поиск устройств и добавление очередей'],
  ['server', 'server', 'Сервер', 'Настройки CUPS, общий доступ и журналирование'],
  ['agent', 'agent', 'Агент', 'PrintHub Agent, WebSocket и диагностика'],
  ['logs', 'logs', 'Логи', 'Журналы CUPS'],
  ['help', 'help', 'Справка', 'Функции WebUI и классический CUPS'],
];

const OPTION_LABELS = {
  PageSize: 'Формат этикетки',
  PageRegion: 'Область печати',
  MediaType: 'Тип носителя',
  MediaMethod: 'Способ подачи',
  Resolution: 'Разрешение печати',
  PrintSpeed: 'Скорость печати',
  Darkness: 'Плотность печати',
  GapOrMark: 'Датчик зазора/метки',
  GapHeight: 'Высота зазора',
  GapsHeight: 'Высота зазора',
  PaperType: 'Тип бумаги',
  HalftoneType: 'Полутона',
  ColorModel: 'Цветовой режим',
  InputSlot: 'Источник / лоток',
  OutputMode: 'Режим вывода',
  Quality: 'Качество',
  Copies: 'Копии',
  OrientationRequested: 'Ориентация',
  printer_is_shared: 'Общий доступ',
  'printer-is-shared': 'Общий доступ',
};

const OPTION_VALUE_LABELS = {
  PageSize: {
    'w5.8h4': '58×40 мм',
    'w4h5.8': '40×58 мм',
    'w5.8h6': '58×60 мм',
    'w7.5h12': '75×120 мм',
    'w12h7.5': '120×75 мм',
  },
  MediaType: {
    Direct: 'Прямая термопечать',
  },
  MediaMethod: {
    Direct: 'Прямая подача',
  },
  PaperType: {
    LabelGaps: 'Этикетка с зазором',
    LabelMark: 'Этикетка с меткой',
    Continuous: 'Непрерывная лента',
  },
  HalftoneType: {
    None: 'Без полутонов',
  },
  ColorModel: {
    Gray: 'Оттенки серого',
    RGB: 'RGB',
    CMYK: 'CMYK',
    KGray: 'Чёрно-белый',
  },
  OrientationRequested: {
    '3': 'Портрет',
    '4': 'Альбом',
    '5': 'Обратный альбом',
    '6': 'Обратный портрет',
  },
  OutputMode: {
    Normal: 'Обычный',
  },
};

let view = location.hash?.replace('#', '') || 'overview';
if (!NAV.some(item => item[0] === view)) view = 'overview';
let cache = { printers: [], classes: [] };
let jobsFilter = 'active';
let refreshTimer = null;
const AUTO_REFRESH_MS = 10000;
let initialBootDone = false;
let initialSplashTimer = null;
let activeRenderController = null;
const INITIAL_SPLASH_DURATION_MS = 1200;

function mountAppSelects(root = document) {
  window.PrintHubAppSelect?.mountAll?.(root);
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function appSelectHtml({ id = '', name = '', value = '', label = '', options = [] } = {}) {
  const attrs = [
    'data-app-select',
    id ? `id="${esc(id)}-host"` : '',
    `data-id="${esc(id)}"`,
    `data-name="${esc(name)}"`,
    `data-value="${esc(value)}"`,
    `data-label="${esc(label)}"`,
    `data-options="${esc(JSON.stringify(options))}"`,
  ];
  return `<div class="app-select-host" ${attrs.filter(Boolean).join(' ')}></div>`;
}

const FA_ICONS = {"overview":{"width":512,"height":512,"path":"M0 256a256 256 0 1 1 512 0A256 256 0 1 1 0 256zM288 96a32 32 0 1 0 -64 0 32 32 0 1 0 64 0zM256 416c35.3 0 64-28.7 64-64c0-17.4-6.9-33.1-18.1-44.6L366 161.7c5.3-12.1-.2-26.3-12.3-31.6s-26.3 .2-31.6 12.3L257.9 288c-.6 0-1.3 0-1.9 0c-35.3 0-64 28.7-64 64s28.7 64 64 64zM176 144a32 32 0 1 0 -64 0 32 32 0 1 0 64 0zM96 288a32 32 0 1 0 0-64 32 32 0 1 0 0 64zm352-32a32 32 0 1 0 -64 0 32 32 0 1 0 64 0z"},"printers":{"width":512,"height":512,"path":"M128 0C92.7 0 64 28.7 64 64l0 96 64 0 0-96 226.7 0L384 93.3l0 66.7 64 0 0-66.7c0-17-6.7-33.3-18.7-45.3L400 18.7C388 6.7 371.7 0 354.7 0L128 0zM384 352l0 32 0 64-256 0 0-64 0-16 0-16 256 0zm64 32l32 0c17.7 0 32-14.3 32-32l0-96c0-35.3-28.7-64-64-64L64 192c-35.3 0-64 28.7-64 64l0 96c0 17.7 14.3 32 32 32l32 0 0 64c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-64zM432 248a24 24 0 1 1 0 48 24 24 0 1 1 0-48z"},"jobs":{"width":512,"height":512,"path":"M152.1 38.2c9.9 8.9 10.7 24 1.8 33.9l-72 80c-4.4 4.9-10.6 7.8-17.2 7.9s-12.9-2.4-17.6-7L7 113C-2.3 103.6-2.3 88.4 7 79s24.6-9.4 33.9 0l22.1 22.1 55.1-61.2c8.9-9.9 24-10.7 33.9-1.8zm0 160c9.9 8.9 10.7 24 1.8 33.9l-72 80c-4.4 4.9-10.6 7.8-17.2 7.9s-12.9-2.4-17.6-7L7 273c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l22.1 22.1 55.1-61.2c8.9-9.9 24-10.7 33.9-1.8zM224 96c0-17.7 14.3-32 32-32l224 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-224 0c-17.7 0-32-14.3-32-32zm0 160c0-17.7 14.3-32 32-32l224 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-224 0c-17.7 0-32-14.3-32-32zM160 416c0-17.7 14.3-32 32-32l288 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-288 0c-17.7 0-32-14.3-32-32zM48 368a48 48 0 1 1 0 96 48 48 0 1 1 0-96z"},"classes":{"width":576,"height":512,"path":"M264.5 5.2c14.9-6.9 32.1-6.9 47 0l218.6 101c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 149.8C37.4 145.8 32 137.3 32 128s5.4-17.9 13.9-21.8L264.5 5.2zM476.9 209.6l53.2 24.6c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 277.8C37.4 273.8 32 265.3 32 256s5.4-17.9 13.9-21.8l53.2-24.6 152 70.2c23.4 10.8 50.4 10.8 73.8 0l152-70.2zm-152 198.2l152-70.2 53.2 24.6c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 405.8C37.4 401.8 32 393.3 32 384s5.4-17.9 13.9-21.8l53.2-24.6 152 70.2c23.4 10.8 50.4 10.8 73.8 0z"},"devices":{"width":384,"height":512,"path":"M96 0C78.3 0 64 14.3 64 32l0 96 64 0 0-96c0-17.7-14.3-32-32-32zM288 0c-17.7 0-32 14.3-32 32l0 96 64 0 0-96c0-17.7-14.3-32-32-32zM32 160c-17.7 0-32 14.3-32 32s14.3 32 32 32l0 32c0 77.4 55 142 128 156.8l0 67.2c0 17.7 14.3 32 32 32s32-14.3 32-32l0-67.2C297 398 352 333.4 352 256l0-32c17.7 0 32-14.3 32-32s-14.3-32-32-32L32 160z"},"server":{"width":512,"height":512,"path":"M64 32C28.7 32 0 60.7 0 96l0 64c0 35.3 28.7 64 64 64l384 0c35.3 0 64-28.7 64-64l0-64c0-35.3-28.7-64-64-64L64 32zm280 72a24 24 0 1 1 0 48 24 24 0 1 1 0-48zm48 24a24 24 0 1 1 48 0 24 24 0 1 1 -48 0zM64 288c-35.3 0-64 28.7-64 64l0 64c0 35.3 28.7 64 64 64l384 0c35.3 0 64-28.7 64-64l0-64c0-35.3-28.7-64-64-64L64 288zm280 72a24 24 0 1 1 0 48 24 24 0 1 1 0-48zm56 24a24 24 0 1 1 48 0 24 24 0 1 1 -48 0z"},"agent":{"width":640,"height":512,"path":"M579.8 267.7c56.5-56.5 56.5-148 0-204.5c-50-50-128.8-56.5-186.3-15.4l-1.6 1.1c-14.4 10.3-17.7 30.3-7.4 44.6s30.3 17.7 44.6 7.4l1.6-1.1c32.1-22.9 76-19.3 103.8 8.6c31.5 31.5 31.5 82.5 0 114L422.3 334.8c-31.5 31.5-82.5 31.5-114 0c-27.9-27.9-31.5-71.8-8.6-103.8l1.1-1.6c10.3-14.4 6.9-34.4-7.4-44.6s-34.4-6.9-44.6 7.4l-1.1 1.6C206.5 251.2 213 330 263 380c56.5 56.5 148 56.5 204.5 0L579.8 267.7zM60.2 244.3c-56.5 56.5-56.5 148 0 204.5c50 50 128.8 56.5 186.3 15.4l1.6-1.1c14.4-10.3 17.7-30.3 7.4-44.6s-30.3-17.7-44.6-7.4l-1.6 1.1c-32.1 22.9-76 19.3-103.8-8.6C74 372 74 321 105.5 289.5L217.7 177.2c31.5-31.5 82.5-31.5 114 0c27.9 27.9 31.5 71.8 8.6 103.9l-1.1 1.6c-10.3 14.4-6.9 34.4 7.4 44.6s34.4 6.9 44.6-7.4l1.1-1.6C433.5 260.8 427 182 377 132c-56.5-56.5-148-56.5-204.5 0L60.2 244.3z"},"logs":{"width":384,"height":512,"path":"M64 0C28.7 0 0 28.7 0 64L0 448c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-288-128 0c-17.7 0-32-14.3-32-32L224 0 64 0zM256 0l0 128 128 0L256 0zM112 256l160 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-160 0c-8.8 0-16-7.2-16-16s7.2-16 16-16zm0 64l160 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-160 0c-8.8 0-16-7.2-16-16s7.2-16 16-16zm0 64l160 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-160 0c-8.8 0-16-7.2-16-16s7.2-16 16-16z"},"help":{"width":512,"height":512,"path":"M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM169.8 165.3c7.9-22.3 29.1-37.3 52.8-37.3l58.3 0c34.9 0 63.1 28.3 63.1 63.1c0 22.6-12.1 43.5-31.7 54.8L280 264.4c-.2 13-10.9 23.6-24 23.6c-13.3 0-24-10.7-24-24l0-13.5c0-8.6 4.6-16.5 12.1-20.8l44.3-25.4c4.7-2.7 7.6-7.7 7.6-13.1c0-8.4-6.8-15.1-15.1-15.1l-58.3 0c-3.4 0-6.4 2.1-7.5 5.3l-.4 1.2c-4.4 12.5-18.2 19-30.6 14.6s-19-18.2-14.6-30.6l.4-1.2zM224 352a32 32 0 1 1 64 0 32 32 0 1 1 -64 0z"},"menu":{"width":448,"height":512,"path":"M0 96C0 78.3 14.3 64 32 64l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 128C14.3 128 0 113.7 0 96zM0 256c0-17.7 14.3-32 32-32l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 288c-17.7 0-32-14.3-32-32zM448 416c0 17.7-14.3 32-32 32L32 448c-17.7 0-32-14.3-32-32s14.3-32 32-32l384 0c17.7 0 32 14.3 32 32z"},"refresh":{"width":512,"height":512,"path":"M142.9 142.9c-17.5 17.5-30.1 38-37.8 59.8c-5.9 16.7-24.2 25.4-40.8 19.5s-25.4-24.2-19.5-40.8C55.6 150.7 73.2 122 97.6 97.6c87.2-87.2 228.3-87.5 315.8-1L455 55c6.9-6.9 17.2-8.9 26.2-5.2s14.8 12.5 14.8 22.2l0 128c0 13.3-10.7 24-24 24l-8.4 0c0 0 0 0 0 0L344 224c-9.7 0-18.5-5.8-22.2-14.8s-1.7-19.3 5.2-26.2l41.1-41.1c-62.6-61.5-163.1-61.2-225.3 1zM16 312c0-13.3 10.7-24 24-24l7.6 0 .7 0L168 288c9.7 0 18.5 5.8 22.2 14.8s1.7 19.3-5.2 26.2l-41.1 41.1c62.6 61.5 163.1 61.2 225.3-1c17.5-17.5 30.1-38 37.8-59.8c5.9-16.7 24.2-25.4 40.8-19.5s25.4 24.2 19.5 40.8c-10.8 30.6-28.4 59.3-52.9 83.8c-87.2 87.2-228.3 87.5-315.8 1L57 457c-6.9 6.9-17.2 8.9-26.2 5.2S16 449.7 16 440l0-119.6 0-.7 0-7.6z"},"external":{"width":512,"height":512,"path":"M320 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l82.7 0L201.4 265.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L448 109.3l0 82.7c0 17.7 14.3 32 32 32s32-14.3 32-32l0-160c0-17.7-14.3-32-32-32L320 0zM80 32C35.8 32 0 67.8 0 112L0 432c0 44.2 35.8 80 80 80l320 0c44.2 0 80-35.8 80-80l0-112c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 112c0 8.8-7.2 16-16 16L80 448c-8.8 0-16-7.2-16-16l0-320c0-8.8 7.2-16 16-16l112 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L80 32z"},"add":{"width":448,"height":512,"path":"M256 80c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 144L48 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l144 0 0 144c0 17.7 14.3 32 32 32s32-14.3 32-32l0-144 144 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-144 0 0-144z"},"edit":{"width":512,"height":512,"path":"M362.7 19.3L314.3 67.7 444.3 197.7l48.4-48.4c25-25 25-65.5 0-90.5L453.3 19.3c-25-25-65.5-25-90.5 0zm-71 71L58.6 323.5c-10.4 10.4-18 23.3-22.2 37.4L1 481.2C-1.5 489.7 .8 498.8 7 505s15.3 8.5 23.7 6.1l120.3-35.4c14.1-4.2 27-11.8 37.4-22.2L421.7 220.3 291.7 90.3z"},"settings":{"width":512,"height":512,"path":"M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z"},"play":{"width":384,"height":512,"path":"M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80L0 432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L361 297c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z"},"stop":{"width":384,"height":512,"path":"M0 128C0 92.7 28.7 64 64 64H320c35.3 0 64 28.7 64 64V384c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V128z"},"pause":{"width":320,"height":512,"path":"M48 64C21.5 64 0 85.5 0 112L0 400c0 26.5 21.5 48 48 48l32 0c26.5 0 48-21.5 48-48l0-288c0-26.5-21.5-48-48-48L48 64zm192 0c-26.5 0-48 21.5-48 48l0 288c0 26.5 21.5 48 48 48l32 0c26.5 0 48-21.5 48-48l0-288c0-26.5-21.5-48-48-48l-32 0z"},"printer":{"width":512,"height":512,"path":"M128 0C92.7 0 64 28.7 64 64l0 96 64 0 0-96 226.7 0L384 93.3l0 66.7 64 0 0-66.7c0-17-6.7-33.3-18.7-45.3L400 18.7C388 6.7 371.7 0 354.7 0L128 0zM384 352l0 32 0 64-256 0 0-64 0-16 0-16 256 0zm64 32l32 0c17.7 0 32-14.3 32-32l0-96c0-35.3-28.7-64-64-64L64 192c-35.3 0-64 28.7-64 64l0 96c0 17.7 14.3 32 32 32l32 0 0 64c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-64zM432 248a24 24 0 1 1 0 48 24 24 0 1 1 0-48z"},"trash":{"width":448,"height":512,"path":"M135.2 17.7C140.6 6.8 151.7 0 163.8 0L284.2 0c12.1 0 23.2 6.8 28.6 17.7L320 32l96 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 96C14.3 96 0 81.7 0 64S14.3 32 32 32l96 0 7.2-14.3zM32 128l384 0 0 320c0 35.3-28.7 64-64 64L96 512c-35.3 0-64-28.7-64-64l0-320zm96 64c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16zm96 0c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16s16-7.2 16-16l0-224c0-8.8-7.2-16-16-16z"},"save":{"width":448,"height":512,"path":"M64 32C28.7 32 0 60.7 0 96L0 416c0 35.3 28.7 64 64 64l320 0c35.3 0 64-28.7 64-64l0-242.7c0-17-6.7-33.3-18.7-45.3L352 50.7C340 38.7 323.7 32 306.7 32L64 32zm0 96c0-17.7 14.3-32 32-32l192 0c17.7 0 32 14.3 32 32l0 64c0 17.7-14.3 32-32 32L96 224c-17.7 0-32-14.3-32-32l0-64zM224 288a64 64 0 1 1 0 128 64 64 0 1 1 0-128z"},"close":{"width":384,"height":512,"path":"M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z"},"cancel":{"width":384,"height":512,"path":"M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z"},"move":{"width":512,"height":512,"path":"M32 96l320 0 0-64c0-12.9 7.8-24.6 19.8-29.6s25.7-2.2 34.9 6.9l96 96c6 6 9.4 14.1 9.4 22.6s-3.4 16.6-9.4 22.6l-96 96c-9.2 9.2-22.9 11.9-34.9 6.9s-19.8-16.6-19.8-29.6l0-64L32 160c-17.7 0-32-14.3-32-32s14.3-32 32-32zM480 352c17.7 0 32 14.3 32 32s-14.3 32-32 32l-320 0 0 64c0 12.9-7.8 24.6-19.8 29.6s-25.7 2.2-34.9-6.9l-96-96c-6-6-9.4-14.1-9.4-22.6s3.4-16.6 9.4-22.6l96-96c9.2-9.2 22.9-11.9 34.9-6.9s19.8 16.6 19.8 29.6l0 64 320 0z"},"upload":{"width":512,"height":512,"path":"M288 109.3L288 352c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-242.7-73.4 73.4c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3l128-128c12.5-12.5 32.8-12.5 45.3 0l128 128c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L288 109.3zM64 352l128 0c0 35.3 28.7 64 64 64s64-28.7 64-64l128 0c35.3 0 64 28.7 64 64l0 32c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64l0-32c0-35.3 28.7-64 64-64zM432 456a24 24 0 1 0 0-48 24 24 0 1 0 0 48z"},"list":{"width":512,"height":512,"path":"M64 144a48 48 0 1 0 0-96 48 48 0 1 0 0 96zM192 64c-17.7 0-32 14.3-32 32s14.3 32 32 32l288 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L192 64zm0 160c-17.7 0-32 14.3-32 32s14.3 32 32 32l288 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-288 0zm0 160c-17.7 0-32 14.3-32 32s14.3 32 32 32l288 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-288 0zM64 464a48 48 0 1 0 0-96 48 48 0 1 0 0 96zm48-208a48 48 0 1 0 -96 0 48 48 0 1 0 96 0z"},"check":{"width":448,"height":512,"path":"M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"},"generic":{"width":512,"height":512,"path":"M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512z"},"test":{"width":512,"height":512,"path":"M342.6 9.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l9.4 9.4L28.1 342.6C10.1 360.6 0 385 0 410.5L0 416c0 53 43 96 96 96l5.5 0c25.5 0 49.9-10.1 67.9-28.1L448 205.3l9.4 9.4c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-32-32-96-96-32-32zM205.3 256L352 109.3 402.7 160l-96 96-101.5 0z"},"purge":{"width":576,"height":512,"path":"M566.6 54.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-192 192-34.7-34.7c-4.2-4.2-10-6.6-16-6.6c-12.5 0-22.6 10.1-22.6 22.6l0 29.1L364.3 320l29.1 0c12.5 0 22.6-10.1 22.6-22.6c0-6-2.4-11.8-6.6-16l-34.7-34.7 192-192zM341.1 353.4L222.6 234.9c-42.7-3.7-85.2 11.7-115.8 42.3l-8 8C76.5 307.5 64 337.7 64 369.2c0 6.8 7.1 11.2 13.2 8.2l51.1-25.5c5-2.5 9.5 4.1 5.4 7.9L7.3 473.4C2.7 477.6 0 483.6 0 489.9C0 502.1 9.9 512 22.1 512l173.3 0c38.8 0 75.9-15.4 103.4-42.8c30.6-30.6 45.9-73.1 42.3-115.8z"},"default":{"width":512,"height":512,"path":"M448 256A192 192 0 1 0 64 256a192 192 0 1 0 384 0zM0 256a256 256 0 1 1 512 0A256 256 0 1 1 0 256zm256 80a80 80 0 1 0 0-160 80 80 0 1 0 0 160zm0-224a144 144 0 1 1 0 288 144 144 0 1 1 0-288zM224 256a32 32 0 1 1 64 0 32 32 0 1 1 -64 0z"},"chevronDown":{"width":512,"height":512,"path":"M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"}};

function faIcon(name, className = 'button-icon') {
  const icon = FA_ICONS[name] || FA_ICONS.generic;
  return `<svg class="${className}" viewBox="0 0 ${icon.width} ${icon.height}" aria-hidden="true"><path fill="currentColor" d="${icon.path}"></path></svg>`;
}

function iconForButton(button) {
  const explicit = button.dataset.fa;
  if (explicit) return explicit;
  const text = String(button.textContent || '').trim().toLowerCase();
  if (/добавить|создать/.test(text)) return 'add';
  if (/изменить|переимен/.test(text)) return 'edit';
  if (/парамет|настрой/.test(text)) return 'settings';
  if (/запустить|продолжить|принимать/.test(text)) return 'play';
  if (/остановить|отклонять/.test(text)) return 'stop';
  if (/пауза/.test(text)) return 'pause';
  if (/обновить|повторить/.test(text)) return 'refresh';
  if (/тестовая/.test(text)) return 'test';
  if (/печат/.test(text)) return 'printer';
  if (/очистить/.test(text)) return 'purge';
  if (/удалить/.test(text)) return 'trash';
  if (/сохранить|применить/.test(text)) return 'save';
  if (/отмена|отменить/.test(text)) return 'cancel';
  if (/переместить/.test(text)) return 'move';
  if (/загрузить/.test(text)) return 'upload';
  if (/все задания|список/.test(text)) return 'list';
  if (/по умолчанию/.test(text)) return 'default';
  if (/сделать|использовать/.test(text)) return 'check';
  if (/classic|открыть/.test(text)) return 'external';
  return 'generic';
}

function decorateButtons(root = document) {
  root.querySelectorAll?.('button').forEach(button => {
    if (button.dataset.iconDecorated === '1') return;
    if (button.closest('.nav') || button.closest('.app-select') || button.closest('.app-select-menu') || button.classList.contains('app-select-trigger') || button.classList.contains('app-select-option')) return;
    button.dataset.iconDecorated = '1';
    const icon = iconForButton(button);
    button.insertAdjacentHTML('afterbegin', faIcon(icon));
    button.classList.add('with-icon');
  });
}

function bytes(n) {
  n = Number(n || 0);
  if (n < 1024) return `${n} Б`;
  if (n < 1048576) return `${Math.round(n / 1024)} КБ`;
  return `${(n / 1048576).toFixed(1)} МБ`;
}

function pill(ok, yes = 'Онлайн', no = 'Офлайн') {
  return `<span class="pill ${ok ? 'ok' : 'bad'}">${ok ? yes : no}</span>`;
}

function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toast-root').append(el);
  setTimeout(() => el.remove(), 3800);
}

async function api(path, opts = {}) {
  const isFormData = opts.body instanceof FormData;
  const headers = { 'x-printhub-request': '1', ...(opts.headers || {}) };
  if (!isFormData && !headers['content-type']) headers['content-type'] = 'application/json';
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
  return data;
}

function loading(message = 'Загрузка данных…', caption = 'Подождите немного, интерфейс получает актуальное состояние PrintHub.') {
  $('#content').innerHTML = `<div class="page-loader"><div class="page-loader-card"><div class="spinner" aria-hidden="true"></div><strong>${esc(message)}</strong><p>${esc(caption)}</p></div></div>`;
}

function setBootVisible(visible, text = 'Подготовка интерфейса и загрузка данных…') {
  const boot = $('#app-boot');
  if (!boot) return;
  const textNode = $('#app-boot-text');
  if (textNode) textNode.textContent = text;
  boot.classList.toggle('is-hidden', !visible);
  document.body.classList.toggle('app-booting', visible);
  if (!visible) document.documentElement.classList.remove('initial-splash-pending');
}

function startInitialSplash() {
  if (initialBootDone || initialSplashTimer) return;
  setBootVisible(true);
  initialSplashTimer = window.setTimeout(() => {
    initialSplashTimer = null;
    initialBootDone = true;
    setBootVisible(false);
  }, INITIAL_SPLASH_DURATION_MS);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setButtonBusy(button, busy, text = 'Сохраняем…') {
  if (!button) return;
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? text : button.dataset.defaultLabel;
}

async function reconnectServerSettings() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await wait(450 + attempt * 120);
    try {
      const { server } = await api('./api/server');
      return server;
    } catch {}
  }
  throw new Error('Интерфейс не смог переподключиться после применения настроек CUPS');
}

function sectionHead(title, sub = '', actions = '') {
  return `<div class="section-head"><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div><div class="actions">${actions}</div></div>`;
}

function pageTools(actions = '') {
  return actions ? `<div class="page-tools"><div class="actions">${actions}</div></div>` : '';
}

function classicUrl() {
  return `http://${location.hostname}:631/`;
}

function stateTextToRu(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return '—';
  const lower = raw.toLowerCase();
  if (lower.includes('disabled')) return 'Отключен';
  if (lower.includes('idle')) return 'Готов';
  if (lower.includes('printing')) return 'Печатает';
  if (lower.includes('stopped')) return 'Остановлен';
  if (lower.includes('offline')) return 'Не в сети';
  return raw
    .replace(/^scheduler is running$/i, 'Планировщик работает')
    .replace(/^scheduler is not running$/i, 'Планировщик не запущен')
    .replace(/idle/gi, 'Готов')
    .replace(/printing/gi, 'Печатает')
    .replace(/disabled/gi, 'Отключен')
    .replace(/stopped/gi, 'Остановлен')
    .replace(/offline/gi, 'Не в сети');
}

function jobStatusRu(job) {
  return job.completed ? 'Завершено' : 'В очереди';
}

function schedulerTextRu(text = '') {
  return stateTextToRu(text || '');
}

function optionLabelRu(option) {
  return OPTION_LABELS[option.key] || OPTION_LABELS[option.label] || option.label || option.key;
}

function optionValueRu(key, value) {
  const dict = OPTION_VALUE_LABELS[key] || {};
  if (dict[value]) return dict[value];
  if (/^(true|false)$/i.test(String(value))) return String(value).toLowerCase() === 'true' ? 'Да' : 'Нет';
  return value;
}

function detail(label, value) {
  return `<div class="detail"><span>${esc(label)}</span><strong>${esc(value ?? '—')}</strong></div>`;
}

function renderNav() {
  $('#nav').innerHTML = NAV.map(([id, icon, label]) => `
    <button data-view="${id}" class="${view === id ? 'active' : ''}">
      <span class="nav-icon">${faIcon(icon, 'nav-fa-icon')}</span>
      <span class="nav-label">${label}</span>
    </button>
  `).join('');
}

function openSidebar() {
  document.body.classList.add('sidebar-open');
  const scrim = $('#sidebar-scrim');
  const toggle = $('#sidebar-toggle');
  if (scrim) scrim.hidden = false;
  if (toggle) toggle.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  document.body.classList.remove('sidebar-open');
  const scrim = $('#sidebar-scrim');
  const toggle = $('#sidebar-toggle');
  if (scrim) scrim.hidden = true;
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

function toggleSidebar() {
  if (document.body.classList.contains('sidebar-open')) closeSidebar();
  else openSidebar();
}

function syncPageHeading() {
  const item = NAV.find(x => x[0] === view) || NAV[0];
  $('#page-title').textContent = item[2];
  $('#page-subtitle').textContent = item[3];
  document.title = `PrintHub · ${item[2]}`;
}

function navigate(next) {
  view = next;
  location.hash = next;
  renderNav();
  syncPageHeading();
  closeSidebar();
  render();
}

$('#classic-cups').onclick = () => window.open(classicUrl(), '_blank');
$('#refresh').onclick = () => render(true);
$('#sidebar-scrim').onclick = () => closeSidebar();

document.addEventListener('click', event => {
  const toggle = event.target.closest?.('#sidebar-toggle');
  if (toggle) {
    event.preventDefault();
    toggleSidebar();
    return;
  }

  const navButton = event.target.closest?.('#nav [data-view]');
  if (navButton) {
    event.preventDefault();
    navigate(navButton.dataset.view);
  }
});
window.addEventListener('hashchange', () => {
  const next = location.hash?.replace('#', '') || 'overview';
  if (NAV.some(item => item[0] === next) && next !== view) navigate(next);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render(true);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeSidebar();
});

function canAutoRefresh() {
  if (document.hidden) return false;
  if ($('#modal-root')?.children?.length) return false;
  const active = document.activeElement;
  if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return false;
  return !['help'].includes(view);
}

function setupAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (canAutoRefresh()) render(false, true);
  }, AUTO_REFRESH_MS);
}

async function render(force = false, silent = false) {
  activeRenderController?.abort();
  const controller = new AbortController();
  activeRenderController = controller;
  const signal = controller.signal;
  const targetView = view;

  if (!silent) loading();
  try {
    if (targetView === 'overview') await renderOverview(signal);
    if (targetView === 'printers') await renderPrinters(signal);
    if (targetView === 'jobs') await renderJobs(signal);
    if (targetView === 'classes') await renderClasses(signal);
    if (targetView === 'devices') await renderDevices(signal);
    if (targetView === 'server') await renderServer(signal);
    if (targetView === 'agent') await renderAgent(signal);
    if (targetView === 'logs') await renderLogs(signal);
    if (targetView === 'help') renderHelp();
    if (signal.aborted || targetView !== view || controller !== activeRenderController) return;
    mountAppSelects($('#content'));
    decorateButtons($('#content'));
  } catch (e) {
    if (e?.name === 'AbortError' || signal.aborted || controller !== activeRenderController) return;
    $('#content').innerHTML = `<div class="empty">Ошибка: ${esc(e.message)}</div>`;
    if (!silent) toast(e.message, 'bad');
  }
}
function updateHeader(agent, cups) {
  const currentAgentOnline = $('#agent-pill')?.classList.contains('ok');
  const currentCupsOnline = $('#side-status')?.classList.contains('ok');

  const agentOnline = agent == null ? currentAgentOnline : Boolean(agent?.serverConnected);
  $('#agent-pill').className = `pill ${agentOnline ? 'ok' : 'bad'}`;
  $('#agent-pill').textContent = agentOnline ? 'Агент онлайн' : 'Агент офлайн';

  const cupsOnline = cups == null ? currentCupsOnline : Boolean(cups?.schedulerRunning);
  $('#side-status').className = `pill ${cupsOnline ? 'ok' : 'bad'}`;
  $('#side-status').textContent = cupsOnline ? 'CUPS работает' : 'CUPS недоступен';
}

async function renderOverview(signal) {
  const { cups, printers, activeJobs, classes, agent, airprint, version } = await api('./api/overview', { signal });
  cache.printers = printers;
  cache.classes = classes;
  updateHeader(agent, cups);
  const main = printers.find(p => p.name === 'XP365B') || printers[0];
  $('#content').innerHTML = `
    <div class="grid kpis">
      <div class="card"><div class="kpi-label">CUPS</div><div class="kpi-value"><span class="dot ${cups.schedulerRunning ? 'ok' : 'bad'}"></span>${cups.schedulerRunning ? 'Работает' : 'Ошибка'}</div><div class="kpi-note">${esc(cups.defaultDestination || 'Нет принтера по умолчанию')}</div></div>
      <div class="card"><div class="kpi-label">PrintHub Agent</div><div class="kpi-value"><span class="dot ${agent.serverConnected ? 'ok' : 'bad'}"></span>${agent.serverConnected ? 'Онлайн' : 'Офлайн'}</div><div class="kpi-note">${esc(agent.agentId || '—')}</div></div>
      <div class="card"><div class="kpi-label">Активные задания</div><div class="kpi-value">${activeJobs.length}</div><div class="kpi-note">Ожидают или печатаются</div></div>
      <div class="card"><div class="kpi-label">Очереди / классы</div><div class="kpi-value">${printers.length} / ${classes.length}</div><div class="kpi-note">PrintHub App ${esc(version)}</div></div>
    </div>
    <section class="section split">
      <div class="card">
        <div class="section-head"><div><h2>Основной принтер</h2><p>Состояние основной очереди</p></div>${main ? pill(main.enabled && main.accepting, 'Готов', 'Остановлен') : ''}</div>
        ${main ? `<div class="detail-list">${detail('Очередь', main.name)}${detail('URI', main.uri || '—').replace('<strong>', '<strong class="mono">')}${detail('Описание', main.description || '—')}${detail('Состояние', stateTextToRu(main.stateText))}</div>` : '<div class="empty">Очередь не создана</div>'}
      </div>
      <div class="card">
        <div class="section-head"><div><h2>AirPrint</h2><p>Доступ с iPhone, iPad и macOS</p></div></div>
        <div class="detail-list">
          ${detail('Название', airprint?.displayName || '—')}
          ${detail('Системная очередь CUPS', airprint?.queue || '—')}
          ${detail('Формат AirPrint', String(airprint?.size || '58x40').replace('x', '×') + ' мм')}
          ${detail('IPP', 'TCP 631')}
          ${detail('Bonjour / DNS‑SD', airprint?.bonjourPublished ? 'CUPS · _ipp._tcp / _universal · опубликовано' : 'CUPS · _ipp._tcp / _universal · ожидание')}
          <div class="detail"><span>Classic CUPS</span><strong><a class="inline-link" href="${classicUrl()}" target="_blank">${faIcon('external', 'inline-fa-icon')}<span>Открыть</span></a></strong></div>
        </div>
      </div>
    </section>
    <section class="section">${sectionHead('Активные задания', 'Последние задания CUPS', `<button class="btn" id="go-jobs">Все задания</button>`)}${jobsTable(activeJobs, true)}</section>`;
  $('#go-jobs').onclick = () => navigate('jobs');
}

function jobsTable(jobs, compact = false) {
  if (!jobs.length) return '<div class="empty">Нет заданий</div>';
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Статус</th>
            <th>Очередь</th>
            <th>Владелец</th>
            <th>Размер</th>
            <th>Дата</th>
            ${compact ? '' : '<th>Действия</th>'}
          </tr>
        </thead>
        <tbody>
          ${jobs.map(j => `
            <tr>
              <td class="mono">${esc(j.id)}</td>
              <td>${jobStatusRu(j)}</td>
              <td>${esc(j.destination)}</td>
              <td>${esc(j.owner)}</td>
              <td>${bytes(j.sizeBytes)}</td>
              <td>${esc(j.dateText)}</td>
              ${compact ? '' : `<td><div class="actions">${j.completed
                ? `<button class="btn" data-job="${esc(j.id)}" data-action="restart">Повторить</button>`
                : `<button class="btn" data-job="${esc(j.id)}" data-action="hold">Пауза</button><button class="btn" data-job="${esc(j.id)}" data-action="release">Продолжить</button><button class="btn" data-job="${esc(j.id)}" data-action="move">Переместить</button><button class="btn danger" data-job="${esc(j.id)}" data-action="cancel">Отменить</button>`}</div></td>`}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

async function renderPrinters(signal) {
  const { printers } = await api('./api/printers', { signal });
  cache.printers = printers;
  $('#content').innerHTML = `${pageTools(`<button class="btn primary" id="add-printer">Добавить принтер</button><button class="btn" id="classic-printers">Classic CUPS</button>`)}${printers.length ? `<div class="grid">${printers.map(printerCard).join('')}</div>` : '<div class="empty">Принтеры не настроены</div>'}`;
  $('#add-printer').onclick = () => printerModal();
  $('#classic-printers').onclick = () => window.open(`${classicUrl()}printers/`, '_blank');
  $$('[data-printer-action]').forEach(b => (b.onclick = () => doPrinterAction(b.dataset.name, b.dataset.printerAction)));
  $$('[data-printer-edit]').forEach(b => (b.onclick = () => editPrinter(b.dataset.printerEdit)));
  $$('[data-printer-options]').forEach(b => (b.onclick = () => optionsModal(b.dataset.printerOptions)));
  $$('[data-printer-delete]').forEach(b => (b.onclick = () => confirmDeletePrinter(b.dataset.printerDelete)));
}

function printerCard(p) {
  return `
    <div class="card">
      <div class="section-head">
        <div>
          <h2 class="printer-title"><span>${esc(p.name)}</span>${p.isDefault ? '<span class="pill ok">По умолчанию</span>' : ''}</h2>
          <p>${esc(p.description || p.location || p.uri || '')}</p>
        </div>
        ${pill(p.enabled && p.accepting, 'Готов', 'Остановлен')}
      </div>
      <div class="detail-list">
        ${detail('URI', p.uri || '—').replace('<strong>', '<strong class="mono">')}
        ${detail('Состояние очереди', stateTextToRu(p.stateText))}
        ${detail('Принимает задания', p.accepting === null ? '—' : p.accepting ? 'Да' : 'Нет')}
        ${detail('Расположение', p.location || '—')}
      </div>
      <div class="actions" style="margin-top:10px">
        <button class="btn" data-printer-options="${esc(p.name)}">Параметры</button>
        <button class="btn" data-printer-edit="${esc(p.name)}">Изменить</button>
        <button class="btn" data-name="${esc(p.name)}" data-printer-action="${p.enabled ? 'disable' : 'enable'}">${p.enabled ? 'Остановить' : 'Запустить'}</button>
        <button class="btn" data-name="${esc(p.name)}" data-printer-action="${p.accepting === false ? 'accept' : 'reject'}">${p.accepting === false ? 'Принимать задания' : 'Отклонять задания'}</button>
        <button class="btn" data-name="${esc(p.name)}" data-printer-action="test">Тестовая страница</button>
        <button class="btn" data-name="${esc(p.name)}" data-printer-action="purge">Очистить задания</button>
        ${p.isDefault ? '' : `<button class="btn" data-name="${esc(p.name)}" data-printer-action="default">Сделать по умолчанию</button>`}
        <button class="btn danger" data-printer-delete="${esc(p.name)}">Удалить</button>
      </div>
    </div>`;
}

async function doPrinterAction(name, action) {
  try {
    await api(`./api/printers/${encodeURIComponent(name)}/action`, { method: 'POST', body: JSON.stringify({ action }) });
    toast('Операция выполнена');
    if (view === 'printers') render(true);
  } catch (e) {
    toast(e.message, 'bad');
  }
}

async function editPrinter(name) {
  const { printer } = await api(`./api/printers/${encodeURIComponent(name)}`);
  printerModal(printer);
}

function toggleField(name, title, sub = '', checked = false, value = 'on') {
  return `<label class="toggle-field"><div><strong>${esc(title)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div><span class="switch"><input type="checkbox" name="${esc(name)}" value="${esc(value)}" ${checked ? 'checked' : ''}><span></span></span></label>`;
}

function printerModal(printer = null) {
  const isEdit = Boolean(printer?.name);
  openModal(
    isEdit ? 'Изменить принтер' : 'Добавить принтер',
    `<form id="printer-form" class="field-grid">
      <div class="field"><label>Имя очереди</label><input name="name" ${isEdit ? 'disabled' : ''} value="${esc(printer?.name || '')}"></div>
      <div class="field"><label>Описание</label><input name="description" value="${esc(printer?.description || '')}"></div>
      <div class="field full"><label>Device URI</label><input name="uri" value="${esc(printer?.uri || '')}"></div>
      <div class="field"><label>Расположение</label><input name="location" value="${esc(printer?.location || '')}"></div>
      <div class="field"><label>Драйвер / model</label><input name="model" value="${esc(printer?.model || (isEdit ? '' : 'everywhere'))}" placeholder="everywhere или drv:///..."></div>
      <div class="field full"><label>PPD path (необязательно, вместо model)</label><input name="ppdPath" value="${esc(printer?.ppdPath || '')}" placeholder="/data/cups/custom-models/file.ppd"></div>
      <div class="field full"><div class="toggle-list compact">${toggleField('shared', 'Общий доступ', 'Публиковать очередь для других устройств в сети.', printer?.shared)}${toggleField('default', 'По умолчанию', 'Назначить эту очередь очередью по умолчанию.', printer?.isDefault)}</div></div>
      <div class="field"><label>Разрешённые пользователи</label><input name="allowedUsers" placeholder="user1,user2"></div>
      <div class="field"><label>Режим доступа</label>${appSelectHtml({ name: 'allowedMode', value: 'allow', label: 'Режим доступа', options: [{ value: 'allow', label: 'Разрешить перечисленным' }, { value: 'deny', label: 'Запретить перечисленным' }] })}</div>
    </form>`,
    `<button class="btn" data-close>Отмена</button><button class="btn primary" id="save-printer">Сохранить</button>`
  );
  $('#save-printer').onclick = async () => {
    const f = new FormData($('#printer-form'));
    const payload = {
      name: isEdit ? printer.name : f.get('name'),
      description: f.get('description'),
      uri: f.get('uri'),
      location: f.get('location'),
      model: f.get('model'),
      ppdPath: f.get('ppdPath'),
      shared: f.get('shared') === 'on',
      default: f.get('default') === 'on',
      allowedUsers: String(f.get('allowedUsers') || '').split(',').map(x => x.trim()).filter(Boolean),
      allowedMode: f.get('allowedMode'),
    };
    try {
      await api(isEdit ? `./api/printers/${encodeURIComponent(printer.name)}` : './api/printers', { method: isEdit ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      closeModal();
      toast('Принтер сохранён');
      if (view === 'printers') render(true);
    } catch (e) {
      toast(e.message, 'bad');
    }
  };
}

async function optionsModal(name) {
  const { printer } = await api(`./api/printers/${encodeURIComponent(name)}`);
  const rows = printer.options.map(o => `
    <div class="field">
      <label>${esc(optionLabelRu(o))}</label>
      ${appSelectHtml({ name: o.key, value: o.choices.find(c => c.selected)?.value || o.choices[0]?.value || '', label: optionLabelRu(o), options: o.choices.map(c => ({ value: c.value, label: optionValueRu(o.key, c.value) })) })}
      <small class="muted">Параметр: ${esc(o.key)}</small>
    </div>
  `).join('');
  openModal(`Параметры · ${name}`, `<form id="options-form" class="field-grid">${rows || '<div class="empty">У принтера нет настраиваемых параметров</div>'}</form>`, `<button class="btn" data-close>Отмена</button><button class="btn primary" id="save-options">Применить</button>`);
  $('#save-options').onclick = async () => {
    const f = new FormData($('#options-form'));
    const options = Object.fromEntries(f.entries());
    try {
      await api(`./api/printers/${encodeURIComponent(name)}/options`, { method: 'POST', body: JSON.stringify({ options }) });
      closeModal();
      toast('Параметры сохранены');
    } catch (e) {
      toast(e.message, 'bad');
    }
  };
}

function confirmDeletePrinter(name) {
  openModal('Удалить принтер', `<p>Очередь <b>${esc(name)}</b> будет удалена вместе с ожидающими заданиями.</p>`, `<button class="btn" data-close>Отмена</button><button class="btn danger" id="delete-printer">Удалить</button>`);
  $('#delete-printer').onclick = async () => {
    try {
      await api(`./api/printers/${encodeURIComponent(name)}`, { method: 'DELETE' });
      closeModal();
      toast('Принтер удалён');
      if (view === 'printers') render(true);
    } catch (e) {
      toast(e.message, 'bad');
    }
  };
}

async function renderJobs(signal) {
  const draw = async () => {
    const { jobs } = await api(`./api/jobs?which=${jobsFilter}`, { signal });
    $('#content').innerHTML = `${pageTools(`${appSelectHtml({ id: 'job-filter', value: jobsFilter, label: 'Фильтр заданий', options: [{ value: 'active', label: 'Активные' }, { value: 'completed', label: 'Завершённые' }, { value: 'all', label: 'Все' }] })}`)}${jobsTable(jobs, false)}`;
    mountAppSelects($('#content'));
    const filterHost = $('#job-filter-host');
    if (!filterHost) throw new Error('Не удалось инициализировать фильтр заданий');
    filterHost.addEventListener('app-select-change', event => {
      jobsFilter = event.detail?.value || 'active';
      draw();
    }, { once: true });
    $$('[data-job]').forEach(b => (b.onclick = async () => {
      if (b.dataset.action === 'move') return moveJobModal(b.dataset.job, draw);
      try {
        await api(`./api/jobs/${encodeURIComponent(b.dataset.job)}/action`, { method: 'POST', body: JSON.stringify({ action: b.dataset.action }) });
        toast('Задание обновлено');
        draw();
      } catch (e) {
        toast(e.message, 'bad');
      }
    }));
  };
  await draw();
}

async function moveJobModal(job, after) {
  const [{ printers }, { classes }] = await Promise.all([api('./api/printers'), api('./api/classes')]);
  const destinations = [...printers.map(p => p.name), ...classes.map(c => c.name)];
  openModal(`Переместить ${job}`, `<div class="field"><label>Новая очередь / класс</label>${appSelectHtml({ id: 'move-destination', value: destinations[0] || '', label: 'Новая очередь или класс', options: destinations.map(x => ({ value: x, label: x })) })}</div>`, `<button class="btn" data-close>Отмена</button><button class="btn primary" id="move-job">Переместить</button>`);
  $('#move-job').onclick = async () => {
    try {
      await api(`./api/jobs/${encodeURIComponent(job)}/action`, { method: 'POST', body: JSON.stringify({ action: 'move', destination: window.PrintHubAppSelect?.getValue?.('move-destination') || destinations[0] || '' }) });
      closeModal();
      toast('Задание перемещено');
      after();
    } catch (e) {
      toast(e.message, 'bad');
    }
  };
}

async function renderClasses(signal) {
  const [{ classes }, { printers }] = await Promise.all([api('./api/classes', { signal }), api('./api/printers', { signal })]);
  cache.classes = classes;
  cache.printers = printers;
  $('#content').innerHTML = `${pageTools(`<button class="btn primary" id="add-class">Создать класс</button>`)}${classes.length ? `<div class="grid">${classes.map(c => `
    <div class="card">
      <div class="section-head"><div><h2>${esc(c.name)} ${c.isDefault ? '<span class="pill ok">По умолчанию</span>' : ''}</h2><p>${c.members.map(esc).join(' · ') || 'Нет участников'}</p></div></div>
      <div class="actions"><button class="btn" data-class-edit="${esc(c.name)}">Изменить</button><button class="btn danger" data-class-delete="${esc(c.name)}">Удалить</button></div>
    </div>`).join('')}</div>` : '<div class="empty">Классы не созданы</div>'}`;
  $('#add-class').onclick = () => classModal(null, printers);
  $$('[data-class-edit]').forEach(b => (b.onclick = () => classModal(classes.find(c => c.name === b.dataset.classEdit), printers)));
  $$('[data-class-delete]').forEach(b => (b.onclick = () => confirmDeleteClass(b.dataset.classDelete)));
}

function confirmDeleteClass(name) {
  openModal('Удалить класс', `<p>Класс <b>${esc(name)}</b> будет удалён. Принтеры останутся в системе.</p>`, `<button class="btn" data-close>Отмена</button><button class="btn danger" id="delete-class">Удалить</button>`);
  $('#delete-class').onclick = async () => {
    try {
      await api(`./api/classes/${encodeURIComponent(name)}`, { method: 'DELETE' });
      closeModal();
      toast('Класс удалён');
      if (view === 'classes') render(true);
    } catch (e) {
      toast(e.message, 'bad');
    }
  };
}

function classModal(item, printers) {
  openModal(
    item ? 'Изменить класс' : 'Создать класс',
    `<form id="class-form" class="field-grid">
      <div class="field full"><label>Имя класса</label><input name="name" ${item ? 'disabled' : ''} value="${esc(item?.name || '')}"></div>
      <div class="field full"><label>Участники</label><div class="toggle-list">${printers.map(p => toggleField('member', p.name, 'Включить принтер в состав класса.', item?.members?.includes(p.name), p.name)).join('')}</div></div>
      <div class="field full"><div class="toggle-list compact">${toggleField('default', 'Класс по умолчанию', 'Назначить этот класс выбором по умолчанию.', item?.isDefault)}</div></div>
    </form>`,
    `<button class="btn" data-close>Отмена</button><button class="btn primary" id="save-class">Сохранить</button>`
  );
  $('#save-class').onclick = async () => {
    const f = new FormData($('#class-form'));
    const payload = { name: item?.name || f.get('name'), members: f.getAll('member'), default: f.get('default') === 'on' };
    try {
      await api(item ? `./api/classes/${encodeURIComponent(item.name)}` : './api/classes', { method: item ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      closeModal();
      toast('Класс сохранён');
      if (view === 'classes') render(true);
    } catch (e) {
      toast(e.message, 'bad');
    }
  };
}
async function renderDevices(signal) {
  const [{ devices }, { drivers }] = await Promise.all([api('./api/devices', { signal }), api('./api/drivers?q=xprinter', { signal })]);
  const drawDrivers = items => {
    const target = $('#driver-rows');
    if (!target) return;
    target.innerHTML = items.map(d => `<tr><td class="mono">${esc(d.model)}</td><td>${esc(d.description)}</td><td><button class="btn" data-driver="${esc(d.model)}">Использовать</button></td></tr>`).join('') || '<tr><td colspan="3" class="muted">Ничего не найдено</td></tr>';
    $$('[data-driver]', target).forEach(b => (b.onclick = () => printerModal({ model: b.dataset.driver })));
  };

  $('#content').innerHTML = `${pageTools(`<button class="btn" id="upload-ppd">Загрузить PPD</button><button class="btn primary" id="manual-add">Добавить вручную</button>`)}
    <div class="table-wrap"><table><thead><tr><th>Тип</th><th>URI</th><th></th></tr></thead><tbody>${devices.map(d => `<tr><td>${esc(d.type)}</td><td class="mono">${esc(d.uri)}</td><td><button class="btn" data-device="${esc(d.uri)}">Добавить</button></td></tr>`).join('')}</tbody></table></div>
    <section class="section">${sectionHead('Драйверы / модели', 'Доступные CUPS модели')}<div class="toolbar" style="margin-bottom:8px"><input id="driver-search" placeholder="Поиск драйвера или модели" value="xprinter"></div><div class="table-wrap"><table><thead><tr><th>Model</th><th>Описание</th><th></th></tr></thead><tbody id="driver-rows"></tbody></table></div></section>`;

  $$('[data-device]').forEach(b => (b.onclick = () => printerModal({ uri: b.dataset.device, ppdPath: /xprinter/i.test(b.dataset.device) ? '/usr/share/cups/model/printhub/XP-365B.ppd' : '' })));
  $('#manual-add').onclick = () => printerModal();
  $('#upload-ppd').onclick = () => ppdModal();
  drawDrivers(drivers);
  let t;
  $('#driver-search').oninput = e => {
    clearTimeout(t);
    t = setTimeout(async () => {
      try {
        const { drivers } = await api(`./api/drivers?q=${encodeURIComponent(e.target.value)}`);
        drawDrivers(drivers);
      } catch (err) {
        toast(err.message, 'bad');
      }
    }, 250);
  };
}

function ppdModal() {
  openModal('Загрузить PPD', `<div class="field"><label>PPD-файл</label><input id="ppd-file" type="file" accept=".ppd"></div>`, `<button class="btn" data-close>Отмена</button><button class="btn primary" id="ppd-upload">Загрузить</button>`);
  $('#ppd-upload').onclick = async () => {
    const file = $('#ppd-file').files[0];
    if (!file) return toast('Выберите PPD', 'bad');
    const data = await file.arrayBuffer();
    const contentBase64 = btoa(String.fromCharCode(...new Uint8Array(data)));
    try {
      const result = await api('./api/drivers/upload', { method: 'POST', body: JSON.stringify({ filename: file.name, contentBase64 }) });
      closeModal();
      toast(`PPD сохранён: ${result.ppd.path}`);
    } catch (e) {
      toast(e.message, 'bad');
    }
  };
}

async function renderServer(signal) {
  const { server, status } = await api('./api/server', { signal });
  updateHeader(null, status);
  $('#content').innerHTML = `
    <div class="split">
      <div class="card">
        ${sectionHead('Настройки сервера')}
        <div id="server-switches">
          ${switchRow('sharePrinters', 'Общий доступ к принтерам', 'Публиковать принтеры в сети и давать к ним доступ другим устройствам', server.sharePrinters)}
          ${switchRow('remoteAdmin', 'Удалённое администрирование', 'Разрешить открывать и настраивать CUPS из локальной сети', server.remoteAdmin)}
          ${switchRow('remoteAny', 'Доступ из любых сетей', 'Ослабляет ограничения доступа. Включайте только если понимаете последствия', server.remoteAny)}
          ${switchRow('userCancelAny', 'Отмена чужих заданий', 'Разрешить пользователям отменять задания других пользователей', server.userCancelAny)}
          ${switchRow('debugLogging', 'Подробный журнал', 'Записывать расширенные отладочные логи CUPS', server.debugLogging)}
          ${switchRow('webInterface', 'Classic CUPS WebUI', 'Оригинальный интерфейс CUPS на порту 631', server.webInterface)}
        </div>
        <div class="actions" style="margin-top:14px"><button class="btn primary" id="save-server">Применить</button><button class="btn" id="open-classic-admin">Classic Admin</button></div>
      </div>
      <div class="card">
        ${sectionHead('Состояние сервера')}
        <div class="detail-list">
          ${detail('Планировщик', schedulerTextRu(status.schedulerText))}
          ${detail('Очередь по умолчанию', status.defaultDestination || '—')}
          ${detail('IPP / AirPrint', '0.0.0.0:631')}
          ${detail('Современный WebUI', ':8099 / Ingress')}
        </div>
      </div>
    </div>`;

  $('#open-classic-admin').onclick = () => window.open(`${classicUrl()}admin/`, '_blank');
  $('#save-server').onclick = async event => {
    const button = event.currentTarget;
    const payload = {};
    $$('#server-switches input').forEach(i => (payload[i.name] = i.checked));
    setButtonBusy(button, true, 'Применяем…');
    try {
      await api('./api/server', { method: 'PATCH', body: JSON.stringify(payload) });
      toast('Настройки CUPS применены');
      await renderServer();
    } catch (e) {
      if (/fetch|network|peer|reset|failed/i.test(String(e.message || ''))) {
        try {
          await reconnectServerSettings();
          toast('Настройки CUPS применены');
          await renderServer();
          return;
        } catch (recoverError) {
          toast(recoverError.message, 'bad');
        }
      } else {
        toast(e.message, 'bad');
      }
    } finally {
      setButtonBusy(button, false);
    }
  };
}

function switchRow(name, title, sub, checked) {
  return `<div class="switch-row"><div><strong>${esc(title)}</strong><small>${esc(sub)}</small></div><label class="switch"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span></span></label></div>`;
}

async function renderAgent(signal) {
  const { agent } = await api('./api/agent?refresh=1', { signal });
  $('#content').innerHTML = `
    <section class="section card">
      ${sectionHead('Состояние агента', agent.serverConnected ? 'Соединение с PrintHub Server установлено' : 'Нет соединения с PrintHub Server')}
      <div class="detail-list">
        ${detail('Agent ID', agent.agentId)}
        ${detail('Сервер', agent.serverUrl)}
        ${detail('WebSocket', agent.serverConnected ? 'Онлайн' : 'Офлайн')}
        ${detail('Последняя связь', agent.serverLastMessageAt || agent.lastSeen)}
        ${detail('Планировщик CUPS', agent.cupsSchedulerRunning ? 'Работает' : 'Недоступен')}
        ${detail('Основная очередь CUPS', agent.cupsQueueUsbExists ? 'Готова' : 'Не найдена')}
        ${detail('Занят', agent.busy ? 'Да' : 'Нет')}
        ${detail('Активное задание', agent.activeJobId || '—')}
        ${detail('В очереди', agent.queuedJobs || 0)}
        ${detail('Последний транспорт печати', agent.lastPrintTransport || '—')}
        ${detail('Версия агента', agent.version || '—')}
        ${detail('Последняя ошибка', agent.serverLastError || '—')}
      </div>
    </section>`;
  updateHeader(agent, { schedulerRunning: agent.cupsSchedulerRunning });
}

async function renderLogs(signal) {
  const { logs } = await api('./api/logs?lines=400', { signal });
  $('#content').innerHTML = `${pageTools(`<button class="btn" id="refresh-logs">Обновить</button>`)}
    <div class="grid"><div class="card"><h3>error_log</h3><pre class="log">${esc(logs.error_log || 'Пусто')}</pre></div><div class="card"><h3>access_log</h3><pre class="log">${esc(logs.access_log || 'Пусто')}</pre></div><div class="card"><h3>page_log</h3><pre class="log">${esc(logs.page_log || 'Пусто')}</pre></div></div>`;
  $('#refresh-logs').onclick = () => render(true);
}

function renderHelp() {
  $('#content').innerHTML = `
    <section class="section help-grid">
      <div class="help-item"><h3>Принтеры</h3><p>Добавление, редактирование и удаление очередей, URI, PPD/model, общего доступа, очереди по умолчанию и параметров печати.</p></div>
      <div class="help-item"><h3>Задания</h3><p>Активные и завершённые задания, отмена, пауза, продолжение, повтор и перенос между очередями.</p></div>
      <div class="help-item"><h3>Классы</h3><p>Создание и изменение классов, управление участниками и назначение класса по умолчанию.</p></div>
      <div class="help-item"><h3>Администрирование</h3><p>Общий доступ, удалённое администрирование, детальные логи и включение классического WebUI.</p></div>
      <div class="help-item"><h3>Устройства / драйверы</h3><p>Поиск устройств через lpinfo, ручное добавление URI, список моделей CUPS и загрузка собственного PPD.</p></div>
      <div class="help-item"><h3>Classic CUPS</h3><p>Оригинальный интерфейс CUPS продолжает работать на TCP 631 для редких низкоуровневых операций.</p></div>
    </section>
    <section class="section"><button class="btn primary" id="help-classic">Открыть Classic CUPS</button></section>`;
  $('#help-classic').onclick = () => window.open(classicUrl(), '_blank');
}

function openModal(title, body, foot = '') {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><section class="modal"><header class="modal-head"><h3>${esc(title)}</h3><button class="close" type="button" data-close data-fa="close" aria-label="Закрыть"></button></header><div class="modal-body">${body}</div><footer class="modal-foot">${foot}</footer></section></div>`;
  mountAppSelects(root);
  decorateButtons(root);
  $$('[data-close]', root).forEach(b => (b.onclick = closeModal));
  $('.modal-backdrop', root).onclick = e => {
    if (e.target.classList.contains('modal-backdrop')) closeModal();
  };
}

function closeModal() {
  $('#modal-root').innerHTML = '';
}

const uiObserver = new MutationObserver(() => {
  queueMicrotask(() => {
    mountAppSelects(document);
    decorateButtons(document);
  });
});
uiObserver.observe(document.body, { childList: true, subtree: true });

renderNav();
syncPageHeading();
decorateButtons(document);
setupAutoRefresh();
startInitialSplash();
render();
