"""PrintHub integration."""

from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import PrintHubApiClient
from .const import (
    CONFIG_ENTRY_VERSION,
    CONF_ADMIN_API_KEY,
    CONF_AGENT_URL,
    CONF_SERVER_URL,
    CONF_SCAN_INTERVAL,
    DEFAULT_AGENT_URL,
    DEFAULT_SCAN_INTERVAL,
    PLATFORMS,
)
from .coordinator import PrintHubCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_migrate_entry(
    hass: HomeAssistant, entry: ConfigEntry
) -> bool:
    """Migrate older PrintHub config entries to the current schema."""
    _LOGGER.debug(
        "Migrating PrintHub configuration from version %s.%s",
        entry.version,
        entry.minor_version,
    )

    if entry.version > CONFIG_ENTRY_VERSION:
        _LOGGER.error(
            "Cannot migrate PrintHub config entry from newer version %s.%s "
            "to supported version %s",
            entry.version,
            entry.minor_version,
            CONFIG_ENTRY_VERSION,
        )
        return False

    if entry.version < 1:
        _LOGGER.error(
            "Unsupported PrintHub config entry version %s.%s",
            entry.version,
            entry.minor_version,
        )
        return False

    if entry.version == 1:
        data = dict(entry.data)

        agent_url = str(data.get(CONF_AGENT_URL) or DEFAULT_AGENT_URL).strip()
        data[CONF_AGENT_URL] = agent_url.rstrip("/") or DEFAULT_AGENT_URL
        data[CONF_SERVER_URL] = str(data.get(CONF_SERVER_URL) or "").strip().rstrip("/")
        data[CONF_ADMIN_API_KEY] = str(data.get(CONF_ADMIN_API_KEY) or "").strip()

        try:
            scan_interval = int(data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL))
        except (TypeError, ValueError):
            scan_interval = DEFAULT_SCAN_INTERVAL
        if not 5 <= scan_interval <= 300:
            scan_interval = DEFAULT_SCAN_INTERVAL
        data[CONF_SCAN_INTERVAL] = scan_interval

        hass.config_entries.async_update_entry(
            entry,
            data=data,
            version=CONFIG_ENTRY_VERSION,
            minor_version=1,
        )

    _LOGGER.debug(
        "PrintHub configuration migration to version %s.%s successful",
        entry.version,
        entry.minor_version,
    )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up PrintHub from a config entry."""
    client = PrintHubApiClient(
        async_get_clientsession(hass),
        entry.data.get(CONF_AGENT_URL, DEFAULT_AGENT_URL),
        entry.data.get(CONF_SERVER_URL),
        entry.data.get(CONF_ADMIN_API_KEY),
    )

    coordinator = PrintHubCoordinator(hass, entry, client)
    await coordinator.async_config_entry_first_refresh()

    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload PrintHub."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
