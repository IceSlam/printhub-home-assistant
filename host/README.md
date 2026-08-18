# Orange Pi host recovery

Run once from the project root:

```bash
sudo ./host/setup-orange-pi.sh
```

The script keeps the existing XP365B USB URI when present, installs the bundled PPD, enables persistent journald, disables USB runtime autosuspend for the printer serial, configures CUPS restart, creates a 30-second CUPS guard timer, and enables systemd hardware watchdog when `/dev/watchdog*` exists.

After the next reboot, previous-boot logs are available with:

```bash
journalctl -b -1 -k
```
