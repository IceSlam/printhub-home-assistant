"""Data coordinator for PrintHub."""

from __future__ import annotations

from datetime import timedelta
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import PrintHubApiClient, PrintHubApiError
from .const import CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL, DOMAIN

_LOGGER = logging.getLogger(__name__)


def _find_printer(printers: list[dict[str, Any]], name: str | None) -> dict[str, Any] | None:
    if not name:
        return None
    return next((item for item in printers if item.get("name") == name), None)


class PrintHubCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Coordinate PrintHub All-in-One App and optional remote server data."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        client: PrintHubApiClient,
    ) -> None:
        self.client = client

        interval = int(
            entry.options.get(
                CONF_SCAN_INTERVAL,
                entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
            )
        )

        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            config_entry=entry,
            update_interval=timedelta(seconds=max(5, interval)),
        )

    async def _async_update_data(self) -> dict[str, Any]:
        overview: dict[str, Any] | None = None

        try:
            overview = await self.client.async_get_local_overview()
            agent = overview.get("agent") or {}
        except PrintHubApiError as overview_error:
            # Backward-compatible fallback so users can update the integration
            # before they update the All-in-One App.
            try:
                agent = await self.client.async_get_agent_status()
            except PrintHubApiError as status_error:
                raise UpdateFailed(
                    f"PrintHub local API is unavailable: {status_error}"
                ) from status_error

            _LOGGER.debug(
                "PrintHub /overview unavailable; using legacy /status: %s",
                overview_error,
            )

        if not isinstance(agent, dict):
            raise UpdateFailed("PrintHub local API returned invalid Agent data")

        app = (overview or {}).get("app") or {}
        cups = (overview or {}).get("cups") or {}
        printers = (overview or {}).get("printers") or []
        active_cups_jobs = (overview or {}).get("activeJobs") or []
        classes = (overview or {}).get("classes") or []
        server_settings = (overview or {}).get("serverSettings") or {}
        hardware = (overview or {}).get("hardware") or {}
        airprint = (overview or {}).get("airprint") or {}

        main_queue = app.get("mainQueue")
        airprint_queue = app.get("airprintQueue")

        main_printer = (
            (overview or {}).get("mainPrinter")
            or _find_printer(printers, main_queue)
        )
        airprint_printer = (
            (overview or {}).get("airprintPrinter")
            or _find_printer(printers, airprint_queue)
        )

        server_url = self.client.server_url or str(
            agent.get("serverUrl") or ""
        ).rstrip("/")
        server_health: dict[str, Any] | None = None
        remote_jobs: list[dict[str, Any]] = []
        server_error: str | None = None

        if server_url:
            try:
                server_health = await self.client.async_get_server_health(server_url)
                if self.client.admin_api_key:
                    remote_jobs = await self.client.async_get_server_jobs(server_url)
            except PrintHubApiError as err:
                # Local printing must remain fully available when the public
                # PrintHub Server health endpoint cannot be reached.
                server_error = str(err)

        status_counts = {
            "pending": 0,
            "sent": 0,
            "printing": 0,
            "done": 0,
            "failed": 0,
        }

        for job in remote_jobs:
            status = str(job.get("status") or "")
            if status in status_counts:
                status_counts[status] += 1

        last_job = remote_jobs[0] if remote_jobs else None

        return {
            "combo_available": overview is not None,
            "overview": overview or {},
            "app": app,
            "agent": agent,
            "cups": cups,
            "printers": printers,
            "main_printer": main_printer,
            "airprint_printer": airprint_printer,
            "active_cups_jobs": active_cups_jobs,
            "classes": classes,
            "server_settings": server_settings,
            "hardware": hardware,
            "airprint": airprint,
            "server_url": server_url or None,
            "server_health": server_health,
            "server_error": server_error,
            "jobs": remote_jobs,
            "job_counts": status_counts,
            "last_job": last_job,
        }
