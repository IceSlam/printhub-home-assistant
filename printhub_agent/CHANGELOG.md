# Changelog

## 1.1.2
- Исправлено падение локального status API: `getAgentStatusSnapshot is not a function`.
- `agent.js` теперь экспортирует `getAgentStatusSnapshot()` и `refreshAgentStatusSnapshot()`, которые вызывает Home Assistant entrypoint.
- Добавлены telemetry-поля `serverConnected`, `serverConnectedAt`, `serverDisconnectedAt`, `serverLastMessageAt`, `serverLastPongAt`, `serverLastError`.
- Agent core version обновлена до 1.5.1.
- Печать через CUPS и профили 58×40 / 58×60 / 75×120 не изменялись.

## 1.1.0
- Embedded PrintHub Agent upgraded to 1.5.0.
- Added local read-only status API on `127.0.0.1:35994`.
- Exposes WebSocket/server connection state, CUPS health, current job and queue.
- Added telemetry timestamps for server connection, messages and pong.
- Designed for the bundled Home Assistant PrintHub custom integration.

## 1.0.1
- Prepared a clean GitHub repository distribution.
- Repository metadata is now expected at the Git repository root.
- Description explicitly supports Home Assistant OS and Home Assistant Supervised.
- No runtime PrintHub protocol changes; embedded PrintHub Agent remains 1.4.0.

## 1.0.0
- First Home Assistant App release.
- Reuses PrintHub Agent 1.4.0.
- Connects to an existing CUPS App through TCP/IPP.
- No raw USB access.
- Sequential print queue.
- WebSocket heartbeat and reconnect.
- CUPS health monitoring and print retry.
- Russian configuration translations.
