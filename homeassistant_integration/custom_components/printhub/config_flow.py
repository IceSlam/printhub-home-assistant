"""Config flow for PrintHub."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import PrintHubApiClient, PrintHubCannotConnect
from .const import (
    CONFIG_ENTRY_VERSION,
    CONF_ADMIN_API_KEY,
    CONF_AGENT_URL,
    CONF_SCAN_INTERVAL,
    CONF_SERVER_URL,
    DEFAULT_AGENT_URL,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
)


async def _validate_local_api(
    hass: HomeAssistant,
    agent_url: str,
) -> tuple[dict[str, Any], bool]:
    """Validate PrintHub and detect the All-in-One overview API."""
    client = PrintHubApiClient(async_get_clientsession(hass), agent_url)

    try:
        overview = await client.async_get_local_overview()
    except PrintHubCannotConnect:
        status = await client.async_get_agent_status(refresh=True)
        return status, False

    agent = overview.get("agent")
    if not isinstance(agent, dict):
        raise PrintHubCannotConnect("PrintHub overview has no Agent object")

    return agent, True


def _schema(defaults: dict[str, Any]) -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(
                CONF_AGENT_URL,
                default=defaults.get(CONF_AGENT_URL, DEFAULT_AGENT_URL),
            ): str,
            vol.Optional(
                CONF_SERVER_URL,
                default=defaults.get(CONF_SERVER_URL, ""),
            ): str,
            vol.Optional(
                CONF_ADMIN_API_KEY,
                default=defaults.get(CONF_ADMIN_API_KEY, ""),
            ): str,
            vol.Optional(
                CONF_SCAN_INTERVAL,
                default=defaults.get(
                    CONF_SCAN_INTERVAL,
                    DEFAULT_SCAN_INTERVAL,
                ),
            ): vol.All(vol.Coerce(int), vol.Range(min=5, max=300)),
        }
    )


class PrintHubConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a PrintHub config flow."""

    VERSION = CONFIG_ENTRY_VERSION

    async def async_step_user(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> FlowResult:
        """Handle initial setup."""
        errors: dict[str, str] = {}
        description_placeholders: dict[str, str] = {}

        if user_input is not None:
            agent_url = str(user_input[CONF_AGENT_URL]).rstrip("/")

            try:
                status, combo = await _validate_local_api(
                    self.hass,
                    agent_url,
                )
            except PrintHubCannotConnect:
                errors["base"] = "cannot_connect"
            else:
                agent_id = str(status.get("agentId") or "printhub-agent")

                await self.async_set_unique_id(agent_id)
                self._abort_if_unique_id_configured()

                server_url = str(
                    user_input.get(CONF_SERVER_URL) or ""
                ).strip().rstrip("/")
                admin_api_key = str(
                    user_input.get(CONF_ADMIN_API_KEY) or ""
                ).strip()

                return self.async_create_entry(
                    title=f"PrintHub · {agent_id}",
                    data={
                        CONF_AGENT_URL: agent_url,
                        CONF_SERVER_URL: server_url,
                        CONF_ADMIN_API_KEY: admin_api_key,
                        CONF_SCAN_INTERVAL: int(
                            user_input.get(
                                CONF_SCAN_INTERVAL,
                                DEFAULT_SCAN_INTERVAL,
                            )
                        ),
                    },
                    description=(
                        "PrintHub All-in-One"
                        if combo
                        else "PrintHub legacy Agent API"
                    ),
                )

        return self.async_show_form(
            step_id="user",
            data_schema=_schema({}),
            errors=errors,
            description_placeholders=description_placeholders,
        )

    async def async_step_reconfigure(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> FlowResult:
        """Allow changing the local API/server settings without re-adding."""
        entry = self._get_reconfigure_entry()
        errors: dict[str, str] = {}

        if user_input is not None:
            agent_url = str(user_input[CONF_AGENT_URL]).rstrip("/")

            try:
                status, _combo = await _validate_local_api(
                    self.hass,
                    agent_url,
                )
            except PrintHubCannotConnect:
                errors["base"] = "cannot_connect"
            else:
                agent_id = str(status.get("agentId") or "printhub-agent")
                await self.async_set_unique_id(agent_id)
                self._abort_if_unique_id_mismatch(reason="wrong_agent")

                return self.async_update_reload_and_abort(
                    entry,
                    data_updates={
                        CONF_AGENT_URL: agent_url,
                        CONF_SERVER_URL: str(
                            user_input.get(CONF_SERVER_URL) or ""
                        ).strip().rstrip("/"),
                        CONF_ADMIN_API_KEY: str(
                            user_input.get(CONF_ADMIN_API_KEY) or ""
                        ).strip(),
                        CONF_SCAN_INTERVAL: int(
                            user_input.get(
                                CONF_SCAN_INTERVAL,
                                DEFAULT_SCAN_INTERVAL,
                            )
                        ),
                    },
                )

        return self.async_show_form(
            step_id="reconfigure",
            data_schema=_schema(dict(entry.data)),
            errors=errors,
        )
