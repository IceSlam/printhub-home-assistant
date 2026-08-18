#!/bin/bash
set -Eeuo pipefail

export LC_ALL=C LANG=C
OPTIONS=/data/options.json

opt() {
  local key="$1" default="$2"
  jq -r --arg k "$key" --arg d "$default" '.[$k] // $d' "$OPTIONS"
}

ADMIN_USER="$(opt admin_username admin)"
ADMIN_PASSWORD="$(opt admin_password admin)"
MAIN_QUEUE="$(opt main_queue XP365B)"
PRINTER_NAME="$(opt printer_display_name 'Xprinter XP-365B')"
USB_URI_OPTION="$(opt usb_uri '')"
SHARE_MAIN="$(opt share_main_queue false)"
AIRPRINT_ENABLED="$(opt airprint_enabled true)"
AIRPRINT_QUEUE="$(opt airprint_queue XP365B_AirPrint)"
AIRPRINT_NAME="$(opt airprint_display_name 'Xprinter XP-365B 58x40')"
AIRPRINT_SIZE="$(opt airprint_size 58x40)"
DEFAULT_SIZE="$(opt default_page_size 58x40)"
DARKNESS="$(opt darkness 15)"
PRINT_SPEED="$(opt print_speed 12)"
GAP_MM="$(opt gap_mm 3)"

case "$DEFAULT_SIZE" in
  58x40) MAIN_PAGE=w5.8h4 ;;
  40x58) MAIN_PAGE=w4h5.8 ;;
  58x60) MAIN_PAGE=w5.8h6 ;;
  75x120) MAIN_PAGE=w7.5h12 ;;
  120x75) MAIN_PAGE=w12h7.5 ;;
  *) echo "[PrintHub] Invalid default_page_size=$DEFAULT_SIZE; using 58x40"; MAIN_PAGE=w5.8h4 ;;
esac

case "$AIRPRINT_SIZE" in
  58x40) AIRPRINT_PAGE=w5.8h4; AIRPRINT_PPD=/usr/share/cups/model/printhub/XP-365B-58x40-AirPrint.ppd ;;
  58x60) AIRPRINT_PAGE=w5.8h6; AIRPRINT_PPD=/usr/share/cups/model/printhub/XP-365B-58x60-AirPrint.ppd ;;
  75x120) AIRPRINT_PAGE=w7.5h12; AIRPRINT_PPD=/usr/share/cups/model/printhub/XP-365B-75x120-AirPrint.ppd ;;
  40x58) AIRPRINT_PAGE=w4h5.8; AIRPRINT_PPD=/usr/share/cups/model/printhub/XP-365B-40x58-AirPrint.ppd ;;
  120x75) AIRPRINT_PAGE=w12h7.5; AIRPRINT_PPD=/usr/share/cups/model/printhub/XP-365B-120x75-AirPrint.ppd ;;
  *) AIRPRINT_SIZE=58x40; AIRPRINT_PAGE=w5.8h4; AIRPRINT_PPD=/usr/share/cups/model/printhub/XP-365B-58x40-AirPrint.ppd ;;
esac

mkdir -p /data/cups/config /data/cups/log /data/cups/custom-models /run/cups /var/spool/cups /var/cache/cups

# Persist the complete CUPS server root so printers/classes/defaults configured
# from the modern or classic UI survive App upgrades/restarts.
if [ ! -f /data/cups/config/.printhub-seeded ]; then
  cp -a /etc/cups/. /data/cups/config/
  touch /data/cups/config/.printhub-seeded
fi
rm -rf /etc/cups
ln -s /data/cups/config /etc/cups

# CUPS Basic auth uses local users; recreate the configured admin each boot.
if ! id "$ADMIN_USER" >/dev/null 2>&1; then
  useradd --system --create-home --groups lpadmin "$ADMIN_USER"
else
  usermod -a -G lpadmin "$ADMIN_USER" || true
fi
printf '%s:%s\n' "$ADMIN_USER" "$ADMIN_PASSWORD" | chpasswd

# Create the administration-capable LAN configuration only once. Afterwards
# cupsd.conf is persistent and changes made by cupsctl/Classic CUPS survive restarts.
if [ ! -f /data/cups/config/.printhub-cupsd-initialized ]; then
cat > /etc/cups/cupsd.conf <<EOF
LogLevel warn
ErrorLog /data/cups/log/error_log
AccessLog /data/cups/log/access_log
PageLog /data/cups/log/page_log

Listen 0.0.0.0:631
Listen /run/cups/cups.sock
ServerAlias *
WebInterface Yes

Browsing Yes
BrowseLocalProtocols dnssd
BrowseDNSSDSubTypes _cups,_print,_universal
BrowseWebIF No
DefaultShared Yes

DefaultAuthType Basic
JobSheets none,none
PreserveJobHistory Yes
PreserveJobFiles Yes
MaxJobs 500

<Location />
  Order allow,deny
  Allow localhost
  Allow @LOCAL
  Allow 10.0.0.0/8
  Allow 172.16.0.0/12
  Allow 192.168.0.0/16
</Location>

<Location /admin>
  AuthType Basic
  Require user @SYSTEM
  Order allow,deny
  Allow localhost
  Allow @LOCAL
  Allow 10.0.0.0/8
  Allow 172.16.0.0/12
  Allow 192.168.0.0/16
</Location>

<Location /admin/conf>
  AuthType Basic
  Require user @SYSTEM
  Order allow,deny
  Allow localhost
  Allow @LOCAL
  Allow 10.0.0.0/8
  Allow 172.16.0.0/12
  Allow 192.168.0.0/16
</Location>

<Policy default>
  <Limit Create-Job Print-Job Print-URI Validate-Job Send-Document Send-URI Close-Job>
    # AirPrint/iOS may use Create-Job + Send-Document with a requesting-user-name
    # that has no matching local UNIX account. Keep the print data path
    # unauthenticated; network access is still constrained by <Location />.
    Order deny,allow
  </Limit>
  <Limit Hold-Job Release-Job Restart-Job Purge-Jobs Set-Job-Attributes Create-Job-Subscription Renew-Subscription Cancel-Subscription Get-Notifications Reprocess-Job Cancel-Current-Job Suspend-Current-Job Resume-Current-Job Cancel-My-Jobs CUPS-Move-Job CUPS-Get-Document>
    Require user @OWNER @SYSTEM
    Order deny,allow
  </Limit>
  <Limit CUPS-Add-Modify-Printer CUPS-Delete-Printer CUPS-Add-Modify-Class CUPS-Delete-Class CUPS-Set-Default CUPS-Get-Devices>
    AuthType Default
    Require user @SYSTEM
    Order deny,allow
  </Limit>
  <Limit Pause-Printer Resume-Printer Enable-Printer Disable-Printer Pause-Printer-After-Current-Job Hold-New-Jobs Release-Held-New-Jobs Deactivate-Printer Activate-Printer Restart-Printer Shutdown-Printer Startup-Printer Promote-Job Schedule-Job-After CUPS-Accept-Jobs CUPS-Reject-Jobs>
    AuthType Default
    Require user @SYSTEM
    Order deny,allow
  </Limit>
  <Limit Cancel-Job CUPS-Authenticate-Job>
    Require user @OWNER @SYSTEM
    Order deny,allow
  </Limit>
  <Limit All>
    Order deny,allow
  </Limit>
</Policy>
EOF
  touch /data/cups/config/.printhub-cupsd-initialized
fi

# Upgrade existing persistent configurations created before PrintHub 2.2.4.
# Keep the local CUPS socket available for CUPS-native tooling while the
# public IPP/AirPrint listener remains available on TCP 631. Modern WebUI
# server settings are applied atomically to cupsd.conf and do not use cupsctl.
if ! grep -Eq '^Listen[[:space:]]+/run/cups/cups\.sock([[:space:]]|$)' /etc/cups/cupsd.conf; then
  printf '\nListen /run/cups/cups.sock\n' >> /etc/cups/cupsd.conf
fi


# AirPrint clients browse the _universal subtype of _ipp._tcp. Older PrintHub
# versions only advertised _cups/_print, so upgrade persistent configurations.
if grep -Eq '^BrowseDNSSDSubTypes[[:space:]]+' /etc/cups/cupsd.conf; then
  sed -i -E 's/^BrowseDNSSDSubTypes[[:space:]].*/BrowseDNSSDSubTypes _cups,_print,_universal/' /etc/cups/cupsd.conf
else
  printf '
BrowseDNSSDSubTypes _cups,_print,_universal
' >> /etc/cups/cupsd.conf
fi

# CUPS security hardening shipped in 2026 changed @OWNER authorization so that
# remote requesting-user-name values without a matching local UNIX account can
# no longer perform Send-Document. iOS/AirPrint commonly uses exactly that
# Create-Job + Send-Document flow, which can make the phone report a successful
# send while no printable job reaches the queue. Migrate persistent configs from
# older PrintHub versions by keeping only the data-submission operations open.
# <Location /> still limits who can reach the scheduler, while job-management and
# administration operations continue to require @OWNER/@SYSTEM authentication.
python3 - <<'PY_CUPS_POLICY'
from pathlib import Path
import re

path = Path('/etc/cups/cupsd.conf')
text = path.read_text()

policy_match = re.search(r'<Policy\s+default>(?P<body>[\s\S]*?)</Policy>', text, re.I)
if policy_match:
    body = policy_match.group('body')
    blocks = list(re.finditer(r'(?P<indent>^[ \t]*)<Limit\s+(?P<ops>[^>]+)>\s*\n(?P<content>[\s\S]*?)^[ \t]*</Limit>', body, re.I | re.M))
    changed = False
    insert_at = None
    indent = '  '

    # If the fixed block already exists there is nothing to migrate.
    has_airprint_block = any(
        all(op in re.split(r'\s+', m.group('ops').strip()) for op in ('Send-Document', 'Close-Job'))
        and 'Require user @OWNER @SYSTEM' not in m.group('content')
        for m in blocks
    )

    if not has_airprint_block:
        for m in blocks:
            ops = re.split(r'\s+', m.group('ops').strip())
            if 'Send-Document' not in ops:
                continue
            # Only rewrite the legacy owner-authenticated PrintHub policy.
            if 'Require user @OWNER @SYSTEM' not in m.group('content'):
                continue
            kept = [op for op in ops if op not in {'Send-Document', 'Send-URI', 'Close-Job'}]
            if not kept:
                continue
            replacement = f"{m.group('indent')}<Limit {' '.join(kept)}>\n{m.group('content').rstrip()}\n{m.group('indent')}</Limit>"
            body = body[:m.start()] + replacement + body[m.end():]
            insert_at = m.start()
            indent = m.group('indent') or '  '
            changed = True
            break

        if changed and insert_at is not None:
            airprint = (
                f"{indent}<Limit Send-Document Send-URI Close-Job>\n"
                f"{indent}  # PrintHub AirPrint compatibility: remote iOS users need not exist locally.\n"
                f"{indent}  Order deny,allow\n"
                f"{indent}</Limit>\n"
            )
            body = body[:insert_at] + airprint + body[insert_at:]
            text = text[:policy_match.start('body')] + body + text[policy_match.end('body'):]
            path.write_text(text)
            print('[PrintHub] migrated CUPS policy for iOS/AirPrint Send-Document compatibility')
PY_CUPS_POLICY

/usr/sbin/cupsd -t
/usr/sbin/cupsd -f &
CUPSD_PID=$!

cleanup() {
  kill "$NODE_PID" "$WATCH_PID" "$CUPSD_PID" 2>/dev/null || true
  wait "$NODE_PID" "$WATCH_PID" "$CUPSD_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 50); do
  lpstat -r 2>/dev/null | grep -q 'scheduler is running' && break
  sleep 0.4
done
lpstat -r 2>/dev/null | grep -q 'scheduler is running' || { echo '[PrintHub] CUPS did not start' >&2; exit 1; }
echo '[PrintHub] CUPS scheduler is running'

# If an older/default configuration still says XP365B_AirPrint but the user
# renamed the managed proxy queue in CUPS, keep that actual queue instead of
# silently recreating XP365B_AirPrint on every App restart. Explicit custom
# airprint_queue values from Home Assistant settings always win.
if [ "$AIRPRINT_ENABLED" = true ] && [ "$AIRPRINT_QUEUE" = "XP365B_AirPrint" ] && ! lpstat -p "$AIRPRINT_QUEUE" >/dev/null 2>&1; then
  EXISTING_AIRPRINT_QUEUE="$(lpstat -v 2>/dev/null | awk '/printhubproxy:\// { line=$0; sub(/^device for /,"",line); sub(/: .*/,"",line); print line; exit }')"
  if [ -n "$EXISTING_AIRPRINT_QUEUE" ]; then
    echo "[PrintHub] adopting existing AirPrint queue: $EXISTING_AIRPRINT_QUEUE"
    AIRPRINT_QUEUE="$EXISTING_AIRPRINT_QUEUE"
  fi
fi
export PRINTHUB_AIRPRINT_QUEUE_EFFECTIVE="$AIRPRINT_QUEUE"

find_usb_uri() {
  if [ -n "$USB_URI_OPTION" ]; then printf '%s\n' "$USB_URI_OPTION"; return 0; fi
  local uri
  uri="$(lpinfo -v 2>/dev/null | awk 'BEGIN{IGNORECASE=1} /usb:\/\/.*xprinter/{print $2; exit}')"
  [ -n "$uri" ] || uri="$(lpinfo -v 2>/dev/null | awk '/usb:\/\//{print $2; exit}')"
  if [ -n "$uri" ]; then printf '%s\n' "$uri"; return 0; fi
  [ -s /data/last_usb_uri ] && { cat /data/last_usb_uri; return 0; }
  return 1
}

configure_printhub_queues() {
  local uri="$1"
  printf '%s\n' "$uri" > /data/last_usb_uri

  lpadmin -p "$MAIN_QUEUE" -E -v "$uri" \
    -P /usr/share/cups/model/printhub/XP-365B.ppd \
    -D "$PRINTER_NAME" -L 'PrintHub' \
    -o "printer-is-shared=$SHARE_MAIN" \
    -o printer-error-policy=retry-current-job \
    -o "PageSize=$MAIN_PAGE" -o "media=$MAIN_PAGE" \
    -o Resolution=203dpi -o MediaMethod=Direct -o PaperType=LabelGaps \
    -o "GapsHeight=$GAP_MM" -o "PrintSpeed=$PRINT_SPEED" \
    -o "Darkness=$DARKNESS" -o HalftoneType=None
  cupsenable "$MAIN_QUEUE" || true
  cupsaccept "$MAIN_QUEUE" || true
  lpadmin -d "$MAIN_QUEUE" || true

  if [ "$AIRPRINT_ENABLED" = true ]; then
    lpadmin -p "$AIRPRINT_QUEUE" -E \
      -v "printhubproxy:/$MAIN_QUEUE/$AIRPRINT_PAGE" \
      -P "$AIRPRINT_PPD" -D "$AIRPRINT_NAME" -L 'PrintHub AirPrint' \
      -o printer-is-shared=true -o printer-error-policy=retry-current-job
    cupsenable "$AIRPRINT_QUEUE" || true
    cupsaccept "$AIRPRINT_QUEUE" || true
  else
    lpadmin -x "$AIRPRINT_QUEUE" 2>/dev/null || true
  fi
}

CURRENT_URI=''
if URI="$(find_usb_uri)"; then
  CURRENT_URI="$URI"
  configure_printhub_queues "$URI"
else
  echo '[PrintHub] XP-365B USB URI not found yet; hotplug watcher will retry'
fi

(
  while kill -0 "$CUPSD_PID" 2>/dev/null; do
    sleep 10
    if URI="$(find_usb_uri)"; then
      if [ "$URI" != "$CURRENT_URI" ] || ! lpstat -p "$MAIN_QUEUE" >/dev/null 2>&1; then
        CURRENT_URI="$URI"
        configure_printhub_queues "$URI"
      fi
    fi
  done
) &
WATCH_PID=$!

cd /app
npm start &
NODE_PID=$!
wait "$NODE_PID"
