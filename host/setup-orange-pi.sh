#!/usr/bin/env bash
set -Eeuo pipefail

QUEUE="${PRINT_QUEUE:-XP365B}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_PPD="${PPD_SOURCE:-$PROJECT_ROOT/agent/XP-365B.ppd}"
PPD_DIR="/usr/local/share/printhub"
PPD_DST="$PPD_DIR/XP-365B.ppd"
GUARD_ENV="/etc/printhub/cups-guard.env"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y cups cups-client avahi-daemon

systemctl enable --now cups.socket cups.service avahi-daemon.service

install -d -m 0755 "$PPD_DIR" /etc/printhub
install -m 0644 "$SOURCE_PPD" "$PPD_DST"

DEVICE_URI="$(lpstat -v "$QUEUE" 2>/dev/null | sed -n "s/^device for ${QUEUE}: //p" | head -n1 || true)"
if [[ -z "$DEVICE_URI" ]]; then
  DEVICE_URI="$(lpinfo -v 2>/dev/null | awk '/direct usb:\/\/Xprinter\//{print $2; exit}')"
fi

if [[ -z "$DEVICE_URI" ]]; then
  echo "Xprinter USB device not found. Connect printer and rerun." >&2
  exit 2
fi

lpadmin -p "$QUEUE" -E -v "$DEVICE_URI" -P "$PPD_DST" \
  -o printer-is-shared=true \
  -o printer-error-policy=retry-job \
  -o PageSize=w5.8h4 \
  -o Resolution=203dpi \
  -o MediaMethod=Direct \
  -o PaperType=LabelGaps \
  -o GapsHeight=3 \
  -o PrintSpeed=12 \
  -o Darkness=15 \
  -o HalftoneType=None
cupsenable "$QUEUE"
cupsaccept "$QUEUE"

# Keep CUPS alive if scheduler crashes.
install -d -m 0755 /etc/systemd/system/cups.service.d
cat >/etc/systemd/system/cups.service.d/printhub-restart.conf <<'EOF'
[Service]
Restart=on-failure
RestartSec=2s
EOF

# Persistent journal: journalctl -b -1 will work after the next reboot.
install -d -m 0755 /etc/systemd/journald.conf.d /var/log/journal
cat >/etc/systemd/journald.conf.d/printhub.conf <<'EOF'
[Journal]
Storage=persistent
SystemMaxUse=256M
RuntimeMaxUse=64M
EOF

# Kernel panic recovery.
cat >/etc/sysctl.d/99-printhub-recovery.conf <<'EOF'
kernel.panic=10
kernel.panic_on_oops=1
EOF
sysctl --system >/dev/null || true

# Hardware watchdog if the board/kernel exposes one.
if compgen -G '/dev/watchdog*' >/dev/null; then
  install -d -m 0755 /etc/systemd/system.conf.d
  cat >/etc/systemd/system.conf.d/printhub-watchdog.conf <<'EOF'
[Manager]
RuntimeWatchdogSec=30s
RebootWatchdogSec=2min
EOF
  echo "Hardware watchdog enabled through systemd."
else
  echo "No /dev/watchdog* found; hardware watchdog config skipped."
fi

# Disable USB runtime autosuspend for this printer by serial if available.
SERIAL="$(printf '%s' "$DEVICE_URI" | sed -n 's/.*[?&]serial=\([^&]*\).*/\1/p')"
if [[ -n "$SERIAL" ]]; then
  cat >/etc/udev/rules.d/80-printhub-xprinter-power.rules <<EOF
ACTION=="add|bind", SUBSYSTEM=="usb", ATTR{serial}=="$SERIAL", TEST=="power/control", ATTR{power/control}="on"
EOF
  udevadm control --reload-rules
  udevadm trigger --subsystem-match=usb || true
  for d in /sys/bus/usb/devices/*; do
    [[ -f "$d/serial" && -f "$d/power/control" ]] || continue
    if [[ "$(cat "$d/serial" 2>/dev/null || true)" == "$SERIAL" ]]; then
      echo on >"$d/power/control" || true
    fi
  done
fi

# Store recovery parameters for the periodic guard.
printf 'QUEUE=%q\nDEVICE_URI=%q\nPPD=%q\n' "$QUEUE" "$DEVICE_URI" "$PPD_DST" >"$GUARD_ENV"
chmod 0600 "$GUARD_ENV"

cat >/usr/local/sbin/printhub-cups-guard <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
source /etc/printhub/cups-guard.env

if ! systemctl is-active --quiet cups.service; then
  systemctl restart cups.service
  sleep 1
fi

if ! lpstat -r 2>/dev/null | grep -q 'scheduler is running'; then
  systemctl restart cups.service
  sleep 1
fi

if ! lpstat -p "$QUEUE" >/dev/null 2>&1; then
  lpadmin -p "$QUEUE" -E -v "$DEVICE_URI" -P "$PPD" \
    -o printer-is-shared=true \
    -o printer-error-policy=retry-job \
    -o PageSize=w5.8h4 \
    -o Resolution=203dpi \
    -o MediaMethod=Direct \
    -o PaperType=LabelGaps \
    -o GapsHeight=3 \
    -o PrintSpeed=12 \
    -o Darkness=15 \
    -o HalftoneType=None
fi

cupsenable "$QUEUE" >/dev/null 2>&1 || true
cupsaccept "$QUEUE" >/dev/null 2>&1 || true
EOF
chmod 0755 /usr/local/sbin/printhub-cups-guard

cat >/etc/systemd/system/printhub-cups-guard.service <<'EOF'
[Unit]
Description=PrintHub CUPS self-healing guard
After=cups.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/printhub-cups-guard
EOF

cat >/etc/systemd/system/printhub-cups-guard.timer <<'EOF'
[Unit]
Description=Run PrintHub CUPS guard periodically

[Timer]
OnBootSec=20s
OnUnitActiveSec=30s
AccuracySec=5s
Unit=printhub-cups-guard.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl restart cups.service
systemctl restart systemd-journald.service || true
systemctl daemon-reexec || true
systemctl enable --now printhub-cups-guard.timer

sleep 2
/usr/local/sbin/printhub-cups-guard

echo
echo "PrintHub host hardening complete"
echo "Queue: $QUEUE"
echo "URI:   $DEVICE_URI"
echo "CUPS:  $(lpstat -r 2>&1 || true)"
lpstat -p "$QUEUE" -v || true
echo
echo "IMPORTANT: rebuild/recreate the agent container so it uses /run/cups:/run/cups."
