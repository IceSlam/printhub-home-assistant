"""Constants for the PrintHub integration."""

DOMAIN = "printhub"
CONFIG_ENTRY_VERSION = 2

CONF_AGENT_URL = "agent_url"
CONF_SERVER_URL = "server_url"
CONF_ADMIN_API_KEY = "admin_api_key"
CONF_SCAN_INTERVAL = "scan_interval"

DEFAULT_AGENT_URL = "http://127.0.0.1:35994"
DEFAULT_SCAN_INTERVAL = 10

PLATFORMS = ["binary_sensor", "sensor", "button"]
