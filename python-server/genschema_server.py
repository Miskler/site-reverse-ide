from __future__ import annotations

import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import PackageNotFoundError, version as package_version
from typing import Any
from urllib.parse import urlparse

from genschema import Converter, PseudoArrayHandler
from genschema.comparators import (
    DeleteElement,
    EmptyComparator,
    EnumComparator,
    FormatComparator,
    NoAdditionalProperties,
    PreserveCommonKeywordsComparator,
    RequiredComparator,
    SchemaVersionComparator,
)
from genschema.comparators.template import Resource
from genschema.postprocessing import SchemaReferenceExtractionConfig, SchemaReferencePostprocessor

SERVICE_NAME = "genschema"
SUPPORTED_BASE_OF = ("anyOf", "oneOf", "allOf")
DEFAULT_PORT = 8000
DEFAULT_HOST = "127.0.0.1"
DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024

DEFAULT_COMPARATOR_SPECS: list[dict[str, Any]] = [
    {"name": "format"},
    {"name": "enum"},
    {"name": "required"},
    {"name": "empty"},
    {"name": "delete", "attribute": "j2sElementTrigger"},
    {"name": "delete", "attribute": "isPseudoArray"},
]


class ApiError(Exception):
    pass


def is_record(value: Any) -> bool:
    return isinstance(value, dict)


def normalize_text(value: Any, fallback: str) -> str:
    if not isinstance(value, str):
        return fallback

    text = value.strip()
    return text if text else fallback


def normalize_bool(value: Any, fallback: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    return fallback


def normalize_int(value: Any, fallback: int) -> int:
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return fallback


def normalize_float(value: Any, fallback: float) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        numeric = float(value)
        if numeric == numeric and numeric not in (float("inf"), float("-inf")):
            return numeric
    return fallback


def read_package_version() -> str:
    try:
        return package_version("genschema")
    except PackageNotFoundError:
        return "unknown"


def ensure_allowed_keys(value: dict[str, Any], allowed: set[str], field_name: str) -> None:
    extra = set(value.keys()) - allowed
    if extra:
        extras = ", ".join(sorted(extra))
        raise ApiError(f"Unexpected fields in {field_name}: {extras}")


def parse_inputs(payload: dict[str, Any]) -> list[tuple[str, Any]]:
    raw_inputs = payload.get("inputs")
    if raw_inputs is None:
        raw_inputs = payload.get("documents")
    if raw_inputs is None:
        raw_inputs = payload.get("items")
    if raw_inputs is None:
        raw_inputs = []

    if not isinstance(raw_inputs, list):
        raise ApiError("inputs must be an array")

    parsed: list[tuple[str, Any]] = []
    for index, item in enumerate(raw_inputs):
        if is_record(item) and "kind" in item:
            kind = normalize_text(item.get("kind"), "").lower()
            if kind not in {"json", "schema", "file"}:
                raise ApiError(f"Unsupported input kind at index {index}: {kind}")

            if kind == "file":
                source = normalize_text(item.get("source"), "json").lower()
                path = normalize_text(item.get("path"), "")
                if source not in {"json", "schema"}:
                    raise ApiError(f"Unsupported file source at index {index}: {source}")
                if not path:
                    raise ApiError(f"Missing path for file input at index {index}")
                parsed.append((f"file:{source}", path))
                continue

            if "value" not in item:
                raise ApiError(f"Missing value for input at index {index}")
            parsed.append((kind, item["value"]))
            continue

        parsed.append(("json", item))

    return parsed


def build_comparator(spec: Any):
    if isinstance(spec, str):
        name = spec.strip().lower()
        options: dict[str, Any] = {}
    elif is_record(spec):
        name = normalize_text(spec.get("name"), "").lower()
        options = spec
    else:
        raise ApiError("Comparator spec must be a string or object")

    if not name:
        raise ApiError("Comparator spec requires a name")

    if name == "format":
        return FormatComparator()
    if name == "required":
        return RequiredComparator()
    if name == "empty":
        return EmptyComparator(
            flag_empty=normalize_bool(options.get("flag_empty"), True),
            flag_non_empty=normalize_bool(options.get("flag_non_empty"), True),
        )
    if name == "enum":
        excluded_field_names = options.get("excluded_field_names", [])
        if not isinstance(excluded_field_names, list):
            raise ApiError("enum.excluded_field_names must be an array")
        return EnumComparator(
            max_unique_values=normalize_int(options.get("max_unique_values"), 16),
            max_avg_string_length=normalize_int(options.get("max_avg_string_length"), 20),
            excluded_field_names={str(item) for item in excluded_field_names},
            reject_flag=normalize_text(options.get("reject_flag"), "j2sEnumRejected"),
        )
    if name in {"delete", "delete_element"}:
        return DeleteElement(normalize_text(options.get("attribute"), "j2sElementTrigger"))
    if name in {"no_additional_properties", "no-additional-properties"}:
        return NoAdditionalProperties()
    if name in {"preserve_common_keywords", "preserve-common-keywords"}:
        excluded_keywords = options.get("excluded_keywords", [])
        if not isinstance(excluded_keywords, list):
            raise ApiError("preserve_common_keywords.excluded_keywords must be an array")
        return PreserveCommonKeywordsComparator(excluded_keywords={str(item) for item in excluded_keywords})
    if name in {"schema_version", "schema-version"}:
        return SchemaVersionComparator(normalize_text(options.get("version"), "https://json-schema.org/draft/2020-12/schema"))

    raise ApiError(f"Unsupported comparator: {name}")


def register_comparators(converter: Converter, payload: dict[str, Any]) -> list[str]:
    use_default_comparators = normalize_bool(payload.get("use_default_comparators"), True)
    raw_comparators = payload.get("comparators")

    if raw_comparators is None:
        raw_comparators = DEFAULT_COMPARATOR_SPECS if use_default_comparators else []
    elif not isinstance(raw_comparators, list):
        raise ApiError("comparators must be an array")

    applied: list[str] = []
    for spec in raw_comparators:
        comparator = build_comparator(spec)
        converter.register(comparator)
        if isinstance(spec, str):
            applied.append(spec)
        elif is_record(spec):
            applied.append(normalize_text(spec.get("name"), "unknown"))
        else:
            applied.append("unknown")

    return applied


def add_input(converter: Converter, kind: str, value: Any, index: int) -> None:
    resource_id = str(index + 1)

    if kind == "json":
        if isinstance(value, str):
            converter._jsons.append(Resource(resource_id, "json", value))
            return
        converter.add_json(value)
        return

    if kind == "schema":
        if isinstance(value, str):
            converter._schemas.append(Resource(resource_id, "schema", value))
            return
        converter.add_schema(value)
        return

    if kind == "file:json":
        converter.add_json(value)
        return

    if kind == "file:schema":
        converter.add_schema(value)
        return

    raise ApiError(f"Unsupported input kind: {kind}")


def build_converter(payload: dict[str, Any]) -> tuple[Converter, list[str], list[tuple[str, Any]]]:
    base_of = normalize_text(payload.get("base_of"), "anyOf")
    if base_of not in SUPPORTED_BASE_OF:
        raise ApiError(f"base_of must be one of: {', '.join(SUPPORTED_BASE_OF)}")

    pseudo_array = normalize_bool(payload.get("pseudo_array"), True)
    converter = Converter(
        pseudo_handler=PseudoArrayHandler() if pseudo_array else None,
        base_of=base_of,  # type: ignore[arg-type]
    )

    inputs = parse_inputs(payload)
    applied_comparators = register_comparators(converter, payload)
    for index, (kind, value) in enumerate(inputs):
        add_input(converter, kind, value, index)

    return converter, applied_comparators, inputs


def build_postprocess_config(payload: dict[str, Any]) -> SchemaReferenceExtractionConfig:
    merge_base_of = normalize_text(payload.get("merge_base_of"), "anyOf")
    if merge_base_of not in SUPPORTED_BASE_OF:
        raise ApiError(f"merge_base_of must be one of: {', '.join(SUPPORTED_BASE_OF)}")

    merge_pseudo_array = normalize_bool(payload.get("merge_pseudo_array"), True)

    config_kwargs: dict[str, Any] = {
        "similarity_threshold": normalize_float(payload.get("similarity_threshold"), 0.85),
        "min_total_keys": normalize_int(payload.get("min_total_keys"), 3),
        "min_occurrences": normalize_int(payload.get("min_occurrences"), 2),
        "defs_key": normalize_text(payload.get("defs_key"), "$defs"),
        "ref_prefix": payload.get("ref_prefix") if payload.get("ref_prefix") is None else normalize_text(payload.get("ref_prefix"), ""),
        "merge_base_of": merge_base_of,
        "merge_pseudo_handler": PseudoArrayHandler() if merge_pseudo_array else None,
        "preserve_common_keywords": normalize_bool(payload.get("preserve_common_keywords"), True),
        "include_root": normalize_bool(payload.get("include_root"), False),
        "skip_existing_definitions": normalize_bool(payload.get("skip_existing_definitions"), True),
    }

    return SchemaReferenceExtractionConfig(**config_kwargs)


def read_graph_payload(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    max_body_bytes_raw = os.environ.get("GENSCHEMA_MAX_BODY_BYTES")
    if max_body_bytes_raw is None:
        max_body_bytes = DEFAULT_MAX_BODY_BYTES
    else:
        try:
            max_body_bytes = int(max_body_bytes_raw)
        except ValueError as exc:
            raise ApiError("Invalid GENSCHEMA_MAX_BODY_BYTES") from exc

    content_length_raw = handler.headers.get("Content-Length") or "0"
    try:
        content_length = int(content_length_raw)
    except ValueError as exc:
        raise ApiError("Invalid Content-Length") from exc

    if content_length < 0:
        raise ApiError("Invalid Content-Length")
    if content_length > max_body_bytes:
        raise ApiError("Request body too large")
    if content_length == 0:
        raise ApiError("Empty request body")

    raw = handler.rfile.read(content_length).decode("utf-8")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ApiError("Invalid JSON") from exc

    if not is_record(payload):
        raise ApiError("Request body must be a JSON object")

    return payload


class GenschemaHandler(BaseHTTPRequestHandler):
    server_version = "GenschemaRest/1.0"

    def _path(self) -> str:
        return urlparse(self.path).path.rstrip("/") or "/"

    def _send_json(self, status: HTTPStatus, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, status: HTTPStatus, message: str) -> None:
        self._send_json(status, {"error": message})

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        route = self._path()

        if route == "/api/health":
            self._send_json(
                HTTPStatus.OK,
                {
                    "status": "ok",
                    "service": SERVICE_NAME,
                    "library": "genschema",
                    "library_version": read_package_version(),
                },
            )
            return

        if route == "/api/genschema":
            self._send_json(
                HTTPStatus.OK,
                {
                    "service": SERVICE_NAME,
                    "library": "genschema",
                    "library_version": read_package_version(),
                    "supported_base_of": list(SUPPORTED_BASE_OF),
                    "default_comparators": DEFAULT_COMPARATOR_SPECS,
                    "endpoints": [
                        "/api/health",
                        "/api/genschema",
                        "/api/genschema/postprocess",
                    ],
                },
            )
            return

        self._send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_POST(self) -> None:  # noqa: N802
        route = self._path()

        try:
            payload = read_graph_payload(self)
        except ApiError as exc:
            self._send_error(HTTPStatus.BAD_REQUEST, str(exc))
            return

        try:
            if route in {"/api/genschema", "/api/genschema/convert"}:
                converter, applied_comparators, inputs = build_converter(payload)
                schema = converter.run()

                postprocess_spec = payload.get("postprocess")
                if is_record(postprocess_spec) and normalize_bool(postprocess_spec.get("enabled"), True):
                    config = build_postprocess_config(postprocess_spec)
                    schema = SchemaReferencePostprocessor.process(schema, config)

                self._send_json(
                    HTTPStatus.OK,
                    {
                        "schema": schema,
                        "meta": {
                            "inputs": len(inputs),
                            "comparators": applied_comparators,
                            "base_of": normalize_text(payload.get("base_of"), "anyOf"),
                            "pseudo_array": normalize_bool(payload.get("pseudo_array"), True),
                            "postprocessed": is_record(payload.get("postprocess"))
                            and normalize_bool(payload["postprocess"].get("enabled"), True),
                        },
                    },
                )
                return

            if route == "/api/genschema/postprocess":
                schema = payload.get("schema")
                if not is_record(schema):
                    raise ApiError("schema must be a JSON object")

                config_payload = payload.get("config")
                if config_payload is None:
                    config_payload = payload
                if not is_record(config_payload):
                    raise ApiError("config must be a JSON object")

                config = build_postprocess_config(config_payload)
                result = SchemaReferencePostprocessor.process(schema, config)
                self._send_json(HTTPStatus.OK, result)
                return

        except ApiError as exc:
            self._send_error(HTTPStatus.BAD_REQUEST, str(exc))
            return
        except Exception as exc:
            self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            body = json.dumps({"error": "Failed to process genschema request", "detail": str(exc)}, ensure_ascii=False, indent=2)
            self.wfile.write(body.encode("utf-8"))
            return

        self._send_error(HTTPStatus.NOT_FOUND, "Not found")

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        print(f"{self.client_address[0]} - {self.log_date_time_string()} - {format % args}")


def get_server_address() -> tuple[str, int]:
    host = os.environ.get("GENSCHEMA_HOST", DEFAULT_HOST)
    port_raw = os.environ.get("GENSCHEMA_PORT", str(DEFAULT_PORT))
    try:
        port = int(port_raw)
    except ValueError:
        port = DEFAULT_PORT
    return host, port


def main() -> None:
    host, port = get_server_address()
    server = ThreadingHTTPServer((host, port), GenschemaHandler)
    print(f"{SERVICE_NAME} REST API listening on http://{host}:{port}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
