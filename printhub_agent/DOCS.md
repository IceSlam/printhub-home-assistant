# PrintHub Agent for Home Assistant

## Why this is a Home Assistant App, not an integration

PrintHub Agent is a long-running external service:
- keeps a permanent WSS connection to PrintHub Server;
- downloads print jobs;
- invokes `pdfinfo`, `lp` and `lpstat`;
- maintains a local sequential print queue;
- monitors CUPS health.

It therefore runs as a Home Assistant App (formerly add-on), not inside Home Assistant Core.

The existing CUPS App remains responsible for:
- USB access to the physical printer;
- the XP-365B driver / PPD;
- printer sharing / AirPrint;
- persistent CUPS queues.

PrintHub Agent does **not** access `/dev/bus/usb` and does **not** run its own CUPS daemon.

Architecture:

```text
PrintHub Server
      │ WSS
      ▼
Home Assistant App: PrintHub Agent
      │ CUPS/IPP TCP 127.0.0.1:631
      ▼
Home Assistant App: CUPS
      │ USB
      ▼
Xprinter XP-365B
```

## Requirements

1. Home Assistant OS or Home Assistant Supervised with Apps support.
2. CUPS App already installed and running.
3. CUPS printer queue named `XP365B` (or change `cups_printer`).
4. CUPS reachable on TCP 631.
5. Same `agent_token` as PrintHub Server.

## Verify CUPS first

Open the CUPS Web UI and make sure the queue is present.

Typical queue:

```text
XP365B
```

The PrintHub Agent default CUPS endpoint is:

```text
127.0.0.1:631
```

This assumes the CUPS App exposes TCP 631 on Home Assistant host networking.

## Local installation

Copy the complete `printhub_agent` folder to the Home Assistant local apps directory:

```text
/addons/printhub_agent/
```

The folder must contain:

```text
config.yaml
Dockerfile
package.json
src/
translations/
```

Then in Home Assistant:

1. Settings → Apps → App store.
2. Open the three-dot menu.
3. Check for updates / reload local apps.
4. Install **PrintHub Agent**.
5. Open Configuration.
6. Set `agent_token`.
7. Confirm `cups_printer: XP365B`.
8. Start the App.
9. Enable **Start on boot** and **Watchdog** in the App UI.

## Recommended configuration

```yaml
server_url: https://print.iceslam.ru
ws_url: wss://print.iceslam.ru/ws/agent
agent_token: YOUR_AGENT_TOKEN
agent_id: homeassistant-xp365b

cups_server: 127.0.0.1:631
cups_printer: XP365B

printer_name: Xprinter XP-365B
print_dpi: 203

cups_ready_timeout_seconds: 30
cups_health_interval_seconds: 15
cups_print_retries: 3
cups_print_retry_delay_seconds: 2
cups_wait_for_job: true
cups_job_timeout_seconds: 90
cups_job_poll_ms: 1500

ws_status_interval_seconds: 10
ws_native_ping_seconds: 10
ws_pong_timeout_seconds: 45
```

## Expected log

```text
Home Assistant PrintHub Agent bootstrap {
  cupsServer: '127.0.0.1:631',
  cupsPrinter: 'XP365B'
}
CUPS preflight scheduler is running
connecting wss://print.iceslam.ru/ws/agent?...
connected
CUPS queue available {
  printer: 'XP365B',
  transport: 'Home Assistant CUPS / IPP'
}
```

## If CUPS says scheduler is not running

Check whether the CUPS App is started.

If its web interface is available at:

```text
http://HOME_ASSISTANT_IP:631
```

but PrintHub Agent cannot use `127.0.0.1:631`, set `cups_server` to:

```text
HOME_ASSISTANT_IP:631
```

and restart PrintHub Agent.

## No USB permissions are required for PrintHub Agent

Do not enable `usb: true`, `full_access`, Docker API, Supervisor API, or Home Assistant API
for this App. The CUPS App already owns the printer.
