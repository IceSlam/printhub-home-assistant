"""Diagnostics for PrintHub."""

from __future__ import annotations

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.core import HomeAssistant

from .const import CONF_ADMIN_API_KEY


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant,
    entry,
) -> dict:
    """Return redacted PrintHub diagnostics."""
    coordinator = entry.runtime_data

    return {
        "entry": async_redact_data(
            dict(entry.data),
            {CONF_ADMIN_API_KEY},
        ),
        "data": coordinator.data,
        "last_update_success": coordinator.last_update_success,
    }
