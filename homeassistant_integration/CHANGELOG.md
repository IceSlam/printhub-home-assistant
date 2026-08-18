# Changelog

## 2.0.2
- Добавлен `async_migrate_entry` для бесшовного обновления существующих Config Entry версии 1 до схемы версии 2.
- При миграции нормализуются URL и добавляются отсутствующие параметры `server_url`, `admin_api_key` и `scan_interval` без удаления существующей конфигурации.

## 2.0.1
- Добавлен фирменный бренд PrintHub для Home Assistant Integration: icon/logo, dark variants и @2x assets.
- Brand assets поставляются локально вместе с custom integration.

## 2.0.0
- Dedicated support for PrintHub All-in-One App 2.1.0+.
- Reads local `/overview` with Agent + CUPS + AirPrint + USB state.
- Added USB, main queue, AirPrint, CUPS sharing/WebUI binary sensors.
- Added App/CUPS/AirPrint/printer configuration diagnostic sensors.
- Added CUPS test-print and purge-queue actions.
- Added reconfigure flow.
- Retains legacy `/status` fallback for upgrade-order compatibility.
- Existing entity unique IDs remain unchanged.
- Timestamp output remains `HH:MM DD.MM.YYYYг.` in Home Assistant local timezone.
