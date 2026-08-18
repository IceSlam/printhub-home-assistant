# PrintHub 2-in-1: Agent + CUPS

After installation open **Settings → Apps → PrintHub → Open Web UI** or the PrintHub sidebar panel.

The App owns TCP 631 and the USB printer. Stop/remove any other CUPS App before starting it.

## Default queues

- `XP365B` — internal multi-size queue used by PrintHub Agent;
- `XP365B_AirPrint` — shared AirPrint proxy queue, fixed to the configured media size.

## Modern CUPS administration

The Ingress WebUI provides:

- add/modify/delete printers;
- enable/disable, accept/reject, test page, server default;
- printer default options from `lpoptions -l`;
- allowed-users policy;
- active/completed jobs with cancel/hold/release/restart;
- printer classes and membership;
- `lpinfo` device discovery;
- installed driver/model list and custom PPD upload with `cupstestppd` validation;
- CUPS server sharing/remote-admin/debug settings;
- persistent CUPS logs;
- PrintHub Agent diagnostics.

The original CUPS WebUI remains available at `http://HOME_ASSISTANT_IP:631/` for version-specific/advanced functions.

## Persistence

CUPS ServerRoot is stored in `/data/cups/config`. Printer queues, classes and server settings survive App restarts and upgrades.
