"""Buttons for PrintHub."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .api import PrintHubApiError
from .entity import PrintHubEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up PrintHub buttons."""
    coordinator = entry.runtime_data

    async_add_entities(
        [
            PrintHubRefreshButton(coordinator, entry.entry_id),
            PrintHubTestPrintButton(coordinator, entry.entry_id),
            PrintHubPurgeQueueButton(coordinator, entry.entry_id),
        ]
    )


class PrintHubRefreshButton(PrintHubEntity, ButtonEntity):
    """Refresh PrintHub status immediately."""

    _attr_translation_key = "refresh_status"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator, entry_id: str) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry_id}_refresh_status"

    async def async_press(self) -> None:
        await self.coordinator.async_request_refresh()


class PrintHubPrinterActionButton(PrintHubEntity, ButtonEntity):
    """Base button for safe local printer actions."""

    _attr_entity_category = EntityCategory.CONFIG
    action: str

    def __init__(self, coordinator, entry_id: str, key: str) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry_id}_{key}"

    @property
    def available(self) -> bool:
        return bool(
            super().available
            and self.coordinator.data.get("combo_available")
            and self.coordinator.data.get("main_printer")
        )

    async def async_press(self) -> None:
        printer = self.coordinator.data.get("app", {}).get("mainQueue")
        if not printer:
            raise HomeAssistantError("PrintHub main CUPS queue is unavailable")

        try:
            await self.coordinator.client.async_printer_action(
                str(printer),
                self.action,
            )
        except PrintHubApiError as err:
            raise HomeAssistantError(
                f"PrintHub printer action failed: {err}"
            ) from err

        await self.coordinator.async_request_refresh()


class PrintHubTestPrintButton(PrintHubPrinterActionButton):
    """Print the CUPS test page on the main queue."""

    _attr_translation_key = "test_print"
    action = "test"

    def __init__(self, coordinator, entry_id: str) -> None:
        super().__init__(coordinator, entry_id, "test_print")


class PrintHubPurgeQueueButton(PrintHubPrinterActionButton):
    """Cancel all current jobs in the main CUPS queue."""

    _attr_translation_key = "purge_queue"
    action = "purge"

    def __init__(self, coordinator, entry_id: str) -> None:
        super().__init__(coordinator, entry_id, "purge_queue")
