# PrintHub Home Assistant App

All-in-one Home Assistant App combining:

- PrintHub Agent;
- CUPS print server;
- Xprinter XP-365B PDF → TSPL driver/filter;
- AirPrint queue and DNS-SD publication;
- modern CUPS administration WebUI through Home Assistant Ingress;
- classic CUPS WebUI on TCP 631 as an advanced compatibility fallback;
- local status API on `127.0.0.1:35994` used by the PrintHub Home Assistant integration.

The modern WebUI covers printers, default options, jobs, classes, discovered devices, PPD upload, server settings, Agent diagnostics and CUPS logs.
