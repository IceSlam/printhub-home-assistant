"""Sensors for PrintHub."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Callable

from homeassistant.components.sensor import SensorEntity, SensorEntityDescription
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from .entity import PrintHubEntity


def format_printhub_datetime(value: Any) -> str | None:
    """Format a PrintHub timestamp in Home Assistant local time."""
    if value in (None, ""):
        return None

    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = dt_util.parse_datetime(str(value))

    if parsed is None:
        return str(value)

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)

    local = dt_util.as_local(parsed)
    return local.strftime("%H:%M %d.%m.%Yг.")


def combo(data: dict) -> bool:
    return bool(data.get("combo_available"))


def printer_attrs(printer: dict | None) -> dict[str, Any]:
    item = printer or {}
    return {
        "uri": item.get("uri"),
        "description": item.get("description"),
        "location": item.get("location"),
        "enabled": item.get("enabled"),
        "accepting": item.get("accepting"),
        "default": item.get("isDefault"),
        "state_text": item.get("stateText"),
    }


@dataclass(frozen=True, kw_only=True)
class PrintHubSensorDescription(SensorEntityDescription):
    """PrintHub sensor description."""

    value_fn: Callable[[dict], Any]
    attrs_fn: Callable[[dict], dict[str, Any]] = lambda data: {}
    available_fn: Callable[[dict], bool] = lambda data: True


DESCRIPTIONS = (
    # Existing entities.
    PrintHubSensorDescription(
        key="queued_jobs",
        translation_key="queued_jobs",
        native_unit_of_measurement="jobs",
        value_fn=lambda data: int(data["agent"].get("queuedJobs") or 0),
    ),
    PrintHubSensorDescription(
        key="active_job",
        translation_key="active_job",
        value_fn=lambda data: data["agent"].get("activeJobId"),
    ),
    PrintHubSensorDescription(
        key="last_print_transport",
        translation_key="last_print_transport",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data: data["agent"].get("lastPrintTransport"),
    ),
    PrintHubSensorDescription(
        key="cups_health",
        translation_key="cups_health",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data: data["agent"].get("cupsHealthDetail"),
    ),
    PrintHubSensorDescription(
        key="agent_version",
        translation_key="agent_version",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data: data["agent"].get("version"),
    ),
    PrintHubSensorDescription(
        key="server_last_message",
        translation_key="server_last_message",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data: format_printhub_datetime(
            data["agent"].get("serverLastMessageAt")
        ),
    ),
    PrintHubSensorDescription(
        key="server_jobs",
        translation_key="server_jobs",
        native_unit_of_measurement="jobs",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data: (data.get("server_health") or {}).get("jobs"),
    ),
    PrintHubSensorDescription(
        key="server_pending_jobs",
        translation_key="server_pending_jobs",
        native_unit_of_measurement="jobs",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data: (data.get("job_counts") or {}).get("pending", 0),
    ),
    PrintHubSensorDescription(
        key="server_printing_jobs",
        translation_key="server_printing_jobs",
        native_unit_of_measurement="jobs",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data: (data.get("job_counts") or {}).get("printing", 0),
    ),
    PrintHubSensorDescription(
        key="server_failed_jobs",
        translation_key="server_failed_jobs",
        native_unit_of_measurement="jobs",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data: (data.get("job_counts") or {}).get("failed", 0),
    ),
    PrintHubSensorDescription(
        key="last_server_job",
        translation_key="last_server_job",
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data: (data.get("last_job") or {}).get("title"),
    ),

    # All-in-One App 2.1+.
    PrintHubSensorDescription(
        key="app_version",
        translation_key="app_version",
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: data.get("app", {}).get("version"),
    ),
    PrintHubSensorDescription(
        key="cups_default_destination",
        translation_key="cups_default_destination",
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: data.get("cups", {}).get("defaultDestination"),
    ),
    PrintHubSensorDescription(
        key="cups_printers_count",
        translation_key="cups_printers_count",
        native_unit_of_measurement="printers",
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: len(data.get("printers") or []),
    ),
    PrintHubSensorDescription(
        key="cups_active_jobs_count",
        translation_key="cups_active_jobs_count",
        native_unit_of_measurement="jobs",
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: len(data.get("active_cups_jobs") or []),
    ),
    PrintHubSensorDescription(
        key="cups_classes_count",
        translation_key="cups_classes_count",
        native_unit_of_measurement="classes",
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: len(data.get("classes") or []),
    ),
    PrintHubSensorDescription(
        key="main_queue_state",
        translation_key="main_queue_state",
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: (
            (data.get("main_printer") or {}).get("name")
            if data.get("main_printer")
            else "not_found"
        ),
        attrs_fn=lambda data: printer_attrs(data.get("main_printer")),
    ),
    PrintHubSensorDescription(
        key="main_queue_uri",
        translation_key="main_queue_uri",
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: (data.get("main_printer") or {}).get("uri"),
    ),
    PrintHubSensorDescription(
        key="airprint_queue_state",
        translation_key="airprint_queue_state",
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: (
            (data.get("airprint_printer") or {}).get("name")
            if data.get("airprint_printer")
            else "not_found"
        ),
        attrs_fn=lambda data: printer_attrs(data.get("airprint_printer")),
    ),
    PrintHubSensorDescription(
        key="airprint_profile",
        translation_key="airprint_profile",
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: str(data.get("app", {}).get("airprintSize") or "").replace("x", "×"),
    ),
    PrintHubSensorDescription(
        key="usb_uri",
        translation_key="usb_uri",
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: data.get("hardware", {}).get("usbUri"),
    ),
    PrintHubSensorDescription(
        key="default_media",
        translation_key="default_media",
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: str(data.get("app", {}).get("defaultPageSize") or "").replace("x", "×"),
    ),
    PrintHubSensorDescription(
        key="darkness",
        translation_key="darkness",
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: data.get("app", {}).get("darkness"),
    ),
    PrintHubSensorDescription(
        key="print_speed",
        translation_key="print_speed",
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: data.get("app", {}).get("printSpeed"),
    ),
    PrintHubSensorDescription(
        key="gap_mm",
        translation_key="gap_mm",
        native_unit_of_measurement="mm",
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: data.get("app", {}).get("gapMm"),
    ),
    PrintHubSensorDescription(
        key="webui_port",
        translation_key="webui_port",
        entity_category=EntityCategory.DIAGNOSTIC,
        available_fn=combo,
        value_fn=lambda data: data.get("app", {}).get("webPort"),
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up PrintHub sensors."""
    coordinator = entry.runtime_data

    async_add_entities(
        PrintHubSensor(coordinator, entry.entry_id, description)
        for description in DESCRIPTIONS
    )


class PrintHubSensor(PrintHubEntity, SensorEntity):
    """PrintHub sensor."""

    entity_description: PrintHubSensorDescription

    def __init__(self, coordinator, entry_id: str, description: PrintHubSensorDescription) -> None:
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
    def native_value(self):
        return self.entity_description.value_fn(self.coordinator.data)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            key: value
            for key, value in self.entity_description.attrs_fn(
                self.coordinator.data
            ).items()
            if value is not None
        }
