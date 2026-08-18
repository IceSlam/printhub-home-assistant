# PrintHub Home Assistant Integration 2.0.0

Custom integration designed for **PrintHub All-in-One App 2.1.0+**.

## Local contract

The integration uses:

```text
http://127.0.0.1:35994/overview
```

to obtain Agent + CUPS + AirPrint state without exposing CUPS administration
credentials to Home Assistant Core.

Safe control actions use a loopback-only endpoint:

```text
POST /control/printer-action
```

The App accepts only `test` and `purge` through this endpoint and rejects
non-loopback callers.

## What is exposed

### Connectivity / state

- PrintHub Agent ↔ Server connection
- CUPS scheduler
- USB printer presence
- main CUPS queue present/enabled/accepting
- AirPrint ready
- CUPS printer sharing
- Classic CUPS WebUI enabled
- Agent busy state
- optional public PrintHub Server health

### Diagnostics

- PrintHub App and Agent versions
- CUPS default destination
- printer / active job / class counts
- main queue state and URI
- AirPrint queue state and media
- USB URI
- configured default media, darkness, speed and gap
- PrintHub WebUI port
- Agent queue, active job and last print transport
- formatted server timestamps

### Actions

- refresh status
- CUPS test print
- purge active jobs from the main CUPS queue

## Installation

Copy:

```text
custom_components/printhub
```

to:

```text
/config/custom_components/printhub
```

Restart Home Assistant and add **PrintHub** from Devices & services.

Default local API:

```text
http://127.0.0.1:35994
```

Existing config entries are kept compatible; old entities keep their unique IDs.
New All-in-One entities become available after App 2.1.0+ is running.
