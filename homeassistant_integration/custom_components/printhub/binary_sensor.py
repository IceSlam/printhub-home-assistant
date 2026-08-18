"""Binary sensors for PrintHub."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
    BinarySensorEntityDescription,
)
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .entity import PrintHubEntity


@dataclass(frozen=True, kw_only=True)
class PrintHubBinaryDescription(BinarySensorEntityDescription):
    """PrintHub binary sensor description."""

    value_fn: Callable[[dict], bool]
    available_fn: Callable[[dict], bool] = lambda data: True


def combo(data: dict) -> bool:
    """Return whether the new All-in-One overview contract is available."""
    return bool(data.get("combo_available"))


DESCRIPTIONS = (
    # Existing unique IDs are intentionally retained.
    PrintHubBinaryDescription(
        key="agent_server_connection",
        translation_key="agent_server_connection",
        device_class=BinarySensorDeviceClass.CONNECTIVITY,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data: bool(data["agent"].get("serverConnected")),
    ),
    PrintHubBinaryDescription(
        key="cups_scheduler",
        translation_key="cups_scheduler",
        device_class=BinarySensorDeviceClass.RUNNING,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data: bool(
            data.get("cups", {}).get(
                "schedulerRunning",
                data["agent"].get("cupsSchedulerRunning"),
            )
        ),
    ),
    PrintHubBinaryDescription(
        key="cups_queue",
        translation_key="cups_queue",
        device_class=BinarySensorDeviceClass.CONNECTIVITY,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data: bool(
            data.get("main_printer")
            or data["agent"].get("cupsQueueUsbExists")
        ),
    ),
    PrintHubBinaryDescription(
        key="busy",
        translation_key="busy",
        device_class=BinarySensorDeviceClass.RUNNING,
        value_fn=lambda data: bool(data["agent"].get("busy")),
    ),
    PrintHubBinaryDescription(
        key="server_health",
        translation_key="server_health",
        device_class=BinarySensorDeviceClass.CONNECTIVITY,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data: bool((data.get("server_health") or {}).get("ok")),
    ),
    PrintHubBinaryDescription(
        key="usb_printer_connected",
        translation_key="usb_printer_connected",
        device_class=BinarySensorDeviceClass.CONNECTIVITY,
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: bool(data.get("hardware", {}).get("usbConnected")),
    ),
    PrintHubBinaryDescription(
        key="main_queue_enabled",
        translation_key="main_queue_enabled",
        device_class=BinarySensorDeviceClass.RUNNING,
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: bool((data.get("main_printer") or {}).get("enabled")),
    ),
    PrintHubBinaryDescription(
        key="main_queue_accepting",
        translation_key="main_queue_accepting",
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: bool((data.get("main_printer") or {}).get("accepting")),
    ),
    PrintHubBinaryDescription(
        key="airprint_ready",
        translation_key="airprint_ready",
        device_class=BinarySensorDeviceClass.CONNECTIVITY,
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: bool(data.get("airprint", {}).get("ready")),
    ),
    PrintHubBinaryDescription(
        key="cups_sharing",
        translation_key="cups_sharing",
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: bool(data.get("server_settings", {}).get("sharePrinters")),
    ),
    PrintHubBinaryDescription(
        key="cups_web_interface",
        translation_key="cups_web_interface",
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: bool(data.get("server_settings", {}).get("webInterface")),
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up PrintHub binary sensors."""
    coordinator = entry.runtime_data

    async_add_entities(
        PrintHubBinarySensor(coordinator, entry.entry_id, description)
        for description in DESCRIPTIONS
    )


class PrintHubBinarySensor(PrintHubEntity, BinarySensorEntity):
    """PrintHub binary sensor."""

    entity_description: PrintHubBinaryDescription

    def __init__(self, coordinator, entry_id: str, description: PrintHubBinaryDescription) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._attr_unique_id = f"{entry_id}_{description.key}"

    @property
    def available(self) -> bool:
        return bool(
            super().available
            and self.entity_description.available_fn(self.coordinator.data)
        )

    @property
    def is_on(self) -> bool:
        return self.entity_description.value_fn(self.coordinator.data)
