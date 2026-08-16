# PrintHub Home Assistant Apps

Home Assistant App repository for PrintHub.

## Included App

### PrintHub Agent

PrintHub Agent maintains a persistent WSS connection to the PrintHub server and sends
print jobs to an existing CUPS App over CUPS/IPP.

Recommended architecture:

```text
PrintHub Server
      │ WSS
      ▼
PrintHub Agent App
      │ CUPS/IPP
      │ 127.0.0.1:631
      ▼
CUPS Print Server App
      │ USB
      ▼
Xprinter XP-365B
```

The PrintHub Agent App does not require raw USB access. The CUPS App remains responsible
for the physical printer, driver/PPD and USB connection.

## Add this repository to Home Assistant

Push the contents of this directory to the root of a public GitHub repository.

The repository root must look like:

```text
repository.yaml
README.md
printhub_agent/
  config.yaml
  Dockerfile
  package.json
  DOCS.md
  CHANGELOG.md
  translations/
  src/
```

Then in Home Assistant:

1. Open **Settings → Apps → Install app**.
2. Open the repository management menu.
3. Add the URL of this GitHub repository.
4. Reload the App Store if necessary.
5. Install **PrintHub Agent**.

## PrintHub Agent configuration

The only secret that must be changed is `agent_token`. It must match `AGENT_TOKEN`
on the PrintHub server.

Recommended configuration:

```yaml
server_url: https://print.iceslam.ru
ws_url: wss://print.iceslam.ru/ws/agent
agent_token: YOUR_AGENT_TOKEN
agent_id: homeassistant-xp365b

cups_server: 127.0.0.1:631
cups_printer: XP365B
printer_name: Xprinter XP-365B
print_dpi: 203

pdf_detect_tolerance_mm: 3
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

If the CUPS App is reachable on the Home Assistant host but not through localhost,
set `cups_server` to the Home Assistant host IP with port 631, for example
`192.168.1.200:631`.

## Supported architectures

- aarch64
- amd64

## Build model

No prebuilt `image:` is specified in `config.yaml`; Home Assistant Supervisor builds
the App from the included Dockerfile when installing it from the repository.
