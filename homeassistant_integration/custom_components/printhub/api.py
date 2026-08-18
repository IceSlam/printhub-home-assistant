"""HTTP client for the PrintHub All-in-One App and optional PrintHub Server."""

from __future__ import annotations

import asyncio
from typing import Any

from aiohttp import ClientError, ClientResponseError, ClientSession


class PrintHubApiError(Exception):
    """Base PrintHub API error."""


class PrintHubCannotConnect(PrintHubApiError):
    """Raised when PrintHub cannot be reached."""


class PrintHubAuthError(PrintHubApiError):
    """Raised when the PrintHub Server API key is rejected."""


class PrintHubApiClient:
    """Async client using Home Assistant's shared aiohttp session."""

    def __init__(
        self,
        session: ClientSession,
        agent_url: str,
        server_url: str | None = None,
        admin_api_key: str | None = None,
    ) -> None:
        self._session = session
        self.agent_url = agent_url.rstrip("/")
        self.server_url = (server_url or "").rstrip("/") or None
        self.admin_api_key = (admin_api_key or "").strip() or None

    async def _request_json(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        payload: dict[str, Any] | None = None,
        timeout: float = 7.0,
    ) -> dict[str, Any] | list[Any]:
        try:
            async with asyncio.timeout(timeout):
                response = await self._session.request(
                    method,
                    url,
                    headers=headers,
                    json=payload,
                )

                if response.status in (401, 403):
                    response.release()
                    raise PrintHubAuthError("PrintHub rejected the request")

                response.raise_for_status()
                return await response.json()
        except PrintHubAuthError:
            raise
        except (TimeoutError, ClientError, ClientResponseError, ValueError) as err:
            raise PrintHubCannotConnect(str(err)) from err

    async def async_get_agent_status(self, *, refresh: bool = False) -> dict[str, Any]:
        """Read the backwards-compatible local Agent status endpoint."""
        suffix = "/status?refresh=1" if refresh else "/status"
        payload = await self._request_json("GET", f"{self.agent_url}{suffix}")

        if not isinstance(payload, dict) or not payload.get("ok"):
            raise PrintHubCannotConnect("Invalid response from PrintHub local status API")

        agent = payload.get("agent")
        if not isinstance(agent, dict):
            raise PrintHubCannotConnect("PrintHub status response has no agent data")

        return agent

    async def async_get_local_overview(self) -> dict[str, Any]:
        """Read CUPS/Agent/AirPrint state from PrintHub All-in-One App 2.1+."""
        payload = await self._request_json("GET", f"{self.agent_url}/overview", timeout=10.0)

        if not isinstance(payload, dict) or not payload.get("ok"):
            raise PrintHubCannotConnect("Invalid PrintHub All-in-One overview response")

        return payload

    async def async_printer_action(
        self,
        printer: str,
        action: str,
    ) -> dict[str, Any]:
        """Run a safe loopback-only printer action through the App."""
        payload = await self._request_json(
            "POST",
            f"{self.agent_url}/control/printer-action",
            payload={"printer": printer, "action": action},
            timeout=20.0,
        )

        if not isinstance(payload, dict) or not payload.get("ok"):
            raise PrintHubCannotConnect("PrintHub printer action failed")

        return payload

    async def async_get_server_health(self, server_url: str) -> dict[str, Any]:
        """Read public low-detail PrintHub Server health."""
        payload = await self._request_json(
            "GET",
            f"{server_url.rstrip('/')}/health",
        )

        if not isinstance(payload, dict):
            raise PrintHubCannotConnect("Invalid PrintHub Server health response")

        return payload

    async def async_get_server_jobs(self, server_url: str) -> list[dict[str, Any]]:
        """Read detailed remote jobs when ADMIN_API_KEY is configured."""
        if not self.admin_api_key:
            return []

        payload = await self._request_json(
            "GET",
            f"{server_url.rstrip('/')}/api/jobs",
            headers={"x-api-key": self.admin_api_key},
        )

        if not isinstance(payload, list):
            raise PrintHubCannotConnect("Invalid PrintHub Server jobs response")

        return [item for item in payload if isinstance(item, dict)]
