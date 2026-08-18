"""Base entities for PrintHub."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import PrintHubCoordinator


class PrintHubEntity(CoordinatorEntity[PrintHubCoordinator]):
    """Base PrintHub entity."""

    _attr_has_entity_name = True

    @property
    def _agent(self) -> dict:
        return self.coordinator.data.get("agent", {})

    @property
    def _app(self) -> dict:
        return self.coordinator.data.get("app", {})

    @property
    def device_info(self) -> DeviceInfo:
        agent = self._agent
        app = self._app

        agent_id = str(agent.get("agentId") or "printhub-agent")
        printer_name = str(
            app.get("printerDisplayName")
            or agent.get("printerName")
            or "PrintHub printer"
        )
        combo = bool(self.coordinator.data.get("combo_available"))

        return DeviceInfo(
            identifiers={(DOMAIN, agent_id)},
            name=f"PrintHub · {printer_name}",
            manufacturer="PrintHub",
            model=(
                "PrintHub All-in-One · Agent + CUPS + AirPrint"
                if combo
                else "PrintHub Agent"
            ),
            sw_version=str(
                app.get("version")
                or agent.get("version")
                or "unknown"
            ),
        )
