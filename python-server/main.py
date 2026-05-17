from __future__ import annotations

import json
import math
import os
from importlib.metadata import PackageNotFoundError, version as package_version
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

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
SIMILARITY_GRAPH_ENDPOINT = "/api/genschema/similarity-graph"
SIMILARITY_GRAPH_ALIAS = "/api/genschema/graph"
SIMILARITY_GRAPH_DEFAULT_RADIUS = 240

DEFAULT_COMPARATOR_SPECS: list[dict[str, Any]] = [
    {"name": "format"},
    {"name": "enum"},
    {"name": "required"},
    {"name": "empty"},
    {"name": "delete", "attribute": "isPseudoArray"},
]

GRAPH_COMPARATOR_SPECS: list[dict[str, Any]] = [
    {"name": "format"},
    {"name": "required"},
    {"name": "empty"},
    {"name": "delete", "attribute": "isPseudoArray"},
]

DISPLAY_SCHEMA_DELETE_COMPARATOR_SPECS: list[dict[str, Any]] = [
    {"name": "delete", "attribute": "j2sElementTrigger"},
    {"name": "delete", "attribute": "j2sEnumRejected"},
    {"name": "delete", "attribute": "isPseudoArray"},
]

class ApiError(Exception):
    pass


app = FastAPI(title="Genschema REST API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ApiError)
async def handle_api_error(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"error": str(exc)})


@app.exception_handler(StarletteHTTPException)
async def handle_http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    message = exc.detail
    if exc.status_code == 404 and message == "Not Found":
        message = "Not found"
    return JSONResponse(status_code=exc.status_code, content={"error": str(message)})


@app.exception_handler(Exception)
async def handle_unexpected_error(_: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={
            "error": "Failed to process genschema request",
            "detail": str(exc),
        },
    )


@dataclass(slots=True)
class ParsedInputItem:
    kind: str
    value: Any
    label: str
    source: str | None = None
    path: str | None = None


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


def infer_input_label(item: Any, kind: str, index: int, path: str | None = None) -> str:
    if is_record(item):
        for key in ("label", "title", "name", "id"):
            candidate = normalize_text(item.get(key), "")
            if candidate:
                return candidate

    if path:
        basename = os.path.basename(path)
        if basename:
            return basename

    if kind.startswith("file:"):
        return f"file {index + 1}"

    return f"document {index + 1}"


def summarize_input_value(kind: str, value: Any) -> str:
    if kind.startswith("file:"):
        if isinstance(value, str):
            basename = os.path.basename(value)
            return f"File input {basename or value}"
        return "File input"

    if kind == "schema":
        if is_record(value):
            return f"Schema object with {len(value)} top-level keys"
        if isinstance(value, list):
            return f"Schema array with {len(value)} items"
        return "Schema source"

    if isinstance(value, dict):
        keys = list(value.keys())
        if not keys:
            return "Empty object"
        preview = ", ".join(str(key) for key in keys[:5])
        if len(keys) > 5:
            preview = f"{preview}, +{len(keys) - 5} more"
        return f"Object with {len(keys)} top-level keys: {preview}"

    if isinstance(value, list):
        return f"Array with {len(value)} items"

    return f"{type(value).__name__.capitalize()} value"


def unfold_stringified_json(value: Any) -> Any:
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("{") or text.startswith("["):
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                return value
            return unfold_stringified_json(parsed)
        return value

    if isinstance(value, list):
        return [unfold_stringified_json(item) for item in value]

    if is_record(value):
        return {key: unfold_stringified_json(item) for key, item in value.items()}

    return value


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


def resolve_comparator_specs(
    payload: dict[str, Any],
    default_specs: list[dict[str, Any]] | None = None,
) -> list[Any]:
    default_specs = [] if default_specs is None else default_specs
    use_default_comparators = normalize_bool(payload.get("use_default_comparators"), True)
    raw_comparators = payload.get("comparators")

    if raw_comparators is None:
        return list(default_specs) if use_default_comparators else []
    if not isinstance(raw_comparators, list):
        raise ApiError("comparators must be an array")
    return list(raw_comparators)


def comparator_spec_name(spec: Any) -> str:
    if isinstance(spec, str):
        return spec.strip().lower()
    if is_record(spec):
        return normalize_text(spec.get("name"), "").lower()
    return ""


def comparator_spec_attribute(spec: Any) -> str:
    if not is_record(spec):
        return ""
    return normalize_text(spec.get("attribute"), "")


def extend_display_schema_comparator_specs(specs: list[Any]) -> list[Any]:
    result = list(specs)
    existing_delete_attributes = {
        comparator_spec_attribute(spec)
        for spec in result
        if comparator_spec_name(spec) in {"delete", "delete_element"}
    }

    for spec in DISPLAY_SCHEMA_DELETE_COMPARATOR_SPECS:
        attribute = comparator_spec_attribute(spec)
        if attribute not in existing_delete_attributes:
            result.append(spec)
            existing_delete_attributes.add(attribute)

    return result


def parse_input_items(payload: dict[str, Any]) -> list[ParsedInputItem]:
    raw_inputs = payload.get("inputs")
    if raw_inputs is None:
        raw_inputs = payload.get("documents")
    if raw_inputs is None:
        raw_inputs = payload.get("items")
    if raw_inputs is None:
        raw_inputs = []

    if not isinstance(raw_inputs, list):
        raise ApiError("inputs must be an array")

    parsed: list[ParsedInputItem] = []
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
                parsed.append(
                    ParsedInputItem(
                        kind=f"file:{source}",
                        value=path,
                        label=infer_input_label(item, kind, index, path),
                        source=source,
                        path=path,
                    )
                )
                continue

            if "value" not in item:
                raise ApiError(f"Missing value for input at index {index}")
            parsed.append(
                ParsedInputItem(
                    kind=kind,
                    value=item["value"],
                    label=infer_input_label(item, kind, index),
                )
            )
            continue

        parsed.append(
            ParsedInputItem(
                kind="json",
                value=item,
                label=infer_input_label(item, "json", index),
            )
        )

    return parsed


def parse_inputs(payload: dict[str, Any]) -> list[tuple[str, Any]]:
    return [(item.kind, item.value) for item in parse_input_items(payload)]


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


def register_comparators(
    converter: Converter,
    payload: dict[str, Any],
    default_specs: list[dict[str, Any]] | None = None,
) -> list[str]:
    comparator_specs = resolve_comparator_specs(payload, default_specs)
    applied: list[str] = []
    for spec in comparator_specs:
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
        normalized_value = unfold_stringified_json(value)
        if isinstance(normalized_value, str):
            converter._jsons.append(Resource(resource_id, "json", normalized_value))
            return
        converter.add_json(normalized_value)
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


def build_converter(
    payload: dict[str, Any],
    *,
    inputs_override: list[tuple[str, Any]] | None = None,
    default_comparator_specs: list[dict[str, Any]] | None = None,
) -> tuple[Converter, list[str], list[tuple[str, Any]]]:
    base_of = normalize_text(payload.get("base_of"), "anyOf")
    if base_of not in SUPPORTED_BASE_OF:
        raise ApiError(f"base_of must be one of: {', '.join(SUPPORTED_BASE_OF)}")

    pseudo_array = normalize_bool(payload.get("pseudo_array"), True)
    converter = Converter(
        pseudo_handler=PseudoArrayHandler() if pseudo_array else None,
        base_of=base_of,  # type: ignore[arg-type]
    )

    applied_comparators = register_comparators(
        converter,
        payload,
        default_specs=DEFAULT_COMPARATOR_SPECS if default_comparator_specs is None else default_comparator_specs,
    )

    if inputs_override is None:
        inputs = parse_inputs(payload)
    else:
        inputs = inputs_override

    for index, (kind, value) in enumerate(inputs):
        add_input(converter, kind, value, index)

    return converter, applied_comparators, inputs


def build_display_schema(
    technical_schema: dict[str, Any],
    payload: dict[str, Any],
    *,
    default_comparator_specs: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    display_payload = dict(payload)
    comparator_specs = resolve_comparator_specs(payload, default_comparator_specs)
    display_payload["comparators"] = extend_display_schema_comparator_specs(comparator_specs)
    display_payload["use_default_comparators"] = False

    converter, _, _ = build_converter(
        display_payload,
        inputs_override=[("schema", technical_schema)],
        default_comparator_specs=default_comparator_specs,
    )
    return converter.run()


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


async def read_graph_payload(request: Request) -> dict[str, Any]:
    max_body_bytes_raw = os.environ.get("GENSCHEMA_MAX_BODY_BYTES")
    if max_body_bytes_raw is None:
        max_body_bytes = DEFAULT_MAX_BODY_BYTES
    else:
        try:
            max_body_bytes = int(max_body_bytes_raw)
        except ValueError as exc:
            raise ApiError("Invalid GENSCHEMA_MAX_BODY_BYTES") from exc

    content_length_raw = request.headers.get("content-length")
    if content_length_raw is not None:
        try:
            content_length = int(content_length_raw)
        except ValueError as exc:
            raise ApiError("Invalid Content-Length") from exc
        if content_length < 0:
            raise ApiError("Invalid Content-Length")
        if content_length > max_body_bytes:
            raise ApiError("Request body too large")

    body = await request.body()
    if len(body) > max_body_bytes:
        raise ApiError("Request body too large")
    if not body:
        raise ApiError("Empty request body")

    try:
        payload = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ApiError("Invalid JSON") from exc

    if not is_record(payload):
        raise ApiError("Request body must be a JSON object")

    return payload


def collect_structural_tokens(schema: dict[str, Any]) -> frozenset[str]:
    return frozenset(SchemaReferencePostprocessor._collect_structural_tokens(schema))


def count_structural_keys(tokens: frozenset[str]) -> int:
    return SchemaReferencePostprocessor._count_total_keys(tokens)


def dice_similarity(left: frozenset[str], right: frozenset[str]) -> float:
    if not left and not right:
        return 1.0
    if not left or not right:
        return 0.0
    return (2.0 * len(left & right)) / (len(left) + len(right))


def build_circle_position(index: int, total: int) -> dict[str, float]:
    if total <= 1:
        return {"x": 0.0, "y": 0.0}

    angle = (2.0 * math.pi * index / total) - (math.pi / 2.0)
    return {
        "x": round(math.cos(angle) * SIMILARITY_GRAPH_DEFAULT_RADIUS, 3),
        "y": round(math.sin(angle) * SIMILARITY_GRAPH_DEFAULT_RADIUS, 3),
    }


def build_similarity_graph(payload: dict[str, Any]) -> dict[str, Any]:
    input_items = parse_input_items(payload)
    include_schema = normalize_bool(payload.get("include_schema"), False)
    use_default_comparators = normalize_bool(payload.get("use_default_comparators"), True)
    default_comparators = GRAPH_COMPARATOR_SPECS if use_default_comparators else []

    postprocess_spec = payload.get("postprocess")
    postprocess_enabled = is_record(postprocess_spec) and normalize_bool(postprocess_spec.get("enabled"), True)
    postprocess_config = build_postprocess_config(postprocess_spec) if postprocess_enabled else None

    node_records: list[dict[str, Any]] = []
    applied_comparators: list[str] = []
    for index, item in enumerate(input_items):
        displayed_value = unfold_stringified_json(item.value) if item.kind == "json" else item.value
        converter, current_comparators, _ = build_converter(
            payload,
            inputs_override=[(item.kind, item.value)],
            default_comparator_specs=default_comparators,
        )
        if not applied_comparators:
            applied_comparators = current_comparators
        schema = converter.run()
        if postprocess_config is not None:
            schema = SchemaReferencePostprocessor.process(schema, postprocess_config)

        tokens = collect_structural_tokens(schema)
        total_keys = count_structural_keys(tokens)
        node_records.append(
            {
                "id": f"input-{index + 1}",
                "label": item.label,
                "description": summarize_input_value(item.kind, displayed_value),
                "position": build_circle_position(index, len(input_items)),
                "metadata": {
                    "index": index,
                    "kind": item.kind,
                    "source": item.source,
                    "path": item.path,
                    "structural_tokens": len(tokens),
                    "total_keys": total_keys,
                    "postprocessed": postprocess_enabled,
                },
                "schema": schema if include_schema else None,
                "_tokens": tokens,
            }
        )

    edges: list[dict[str, Any]] = []
    for left_index in range(len(node_records)):
        left = node_records[left_index]
        left_tokens = left["_tokens"]
        for right_index in range(left_index + 1, len(node_records)):
            right = node_records[right_index]
            right_tokens = right["_tokens"]

            structure_score = dice_similarity(left_tokens, right_tokens)
            combined_score = structure_score

            edges.append(
                {
                    "id": f"{left['id']}--{right['id']}",
                    "source": left["id"],
                    "target": right["id"],
                    "kind": "similarity",
                    "score": round(combined_score, 6),
                    "percentage": round(combined_score * 100.0, 2),
                    "label": f"{round(combined_score * 100.0, 1)}%",
                    "structure_score": round(structure_score, 6),
                    "metadata": {
                        "shared_tokens": len(left_tokens & right_tokens),
                        "left_tokens": len(left_tokens),
                        "right_tokens": len(right_tokens),
                    },
                }
            )

    nodes: list[dict[str, Any]] = []
    for record in node_records:
        node = {key: value for key, value in record.items() if not key.startswith("_")}
        if node.get("schema") is None:
            node.pop("schema", None)
        nodes.append(node)

    return {
        "nodes": nodes,
        "edges": edges,
        "meta": {
            "inputs": len(input_items),
            "pairs": len(edges),
            "complete_graph": True,
            "base_of": normalize_text(payload.get("base_of"), "anyOf"),
            "pseudo_array": normalize_bool(payload.get("pseudo_array"), True),
            "use_default_comparators": use_default_comparators,
            "comparators": applied_comparators,
            "default_comparators": default_comparators,
            "postprocessed": postprocess_enabled,
            "include_schema": include_schema,
        },
    }


def get_server_address() -> tuple[str, int]:
    host = os.environ.get("GENSCHEMA_HOST", DEFAULT_HOST)
    port_raw = os.environ.get("GENSCHEMA_PORT", str(DEFAULT_PORT))
    try:
        port = int(port_raw)
    except ValueError:
        port = DEFAULT_PORT
    return host, port


def build_health_payload() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": SERVICE_NAME,
        "library": "genschema",
        "library_version": read_package_version(),
    }


def build_service_info_payload() -> dict[str, Any]:
    return {
        "service": SERVICE_NAME,
        "library": "genschema",
        "library_version": read_package_version(),
        "supported_base_of": list(SUPPORTED_BASE_OF),
        "default_comparators": DEFAULT_COMPARATOR_SPECS,
        "graph_defaults": {
            "route": SIMILARITY_GRAPH_ENDPOINT,
            "aliases": [SIMILARITY_GRAPH_ALIAS],
            "default_comparators": GRAPH_COMPARATOR_SPECS,
        },
        "endpoints": [
            "/api/health",
            "/api/genschema",
            "/api/genschema/postprocess",
            SIMILARITY_GRAPH_ENDPOINT,
            SIMILARITY_GRAPH_ALIAS,
        ],
    }


@app.get("/api/health")
@app.get("/api/health/")
async def health() -> dict[str, Any]:
    return build_health_payload()


@app.get("/api/genschema")
@app.get("/api/genschema/")
async def genschema_info() -> dict[str, Any]:
    return build_service_info_payload()


async def run_generate_schema(payload: dict[str, Any]) -> dict[str, Any]:
    converter, applied_comparators, inputs = build_converter(payload)
    schema = converter.run()

    postprocess_spec = payload.get("postprocess")
    if is_record(postprocess_spec) and normalize_bool(postprocess_spec.get("enabled"), True):
        config = build_postprocess_config(postprocess_spec)
        schema = SchemaReferencePostprocessor.process(schema, config)

    display_schema = build_display_schema(
        schema,
        payload,
        default_comparator_specs=DEFAULT_COMPARATOR_SPECS,
    )

    return {
        "schema": schema,
        "display_schema": display_schema,
        "meta": {
            "inputs": len(inputs),
            "comparators": applied_comparators,
            "base_of": normalize_text(payload.get("base_of"), "anyOf"),
            "pseudo_array": normalize_bool(payload.get("pseudo_array"), True),
            "postprocessed": is_record(payload.get("postprocess"))
            and normalize_bool(payload["postprocess"].get("enabled"), True),
        },
    }


@app.post("/api/genschema")
@app.post("/api/genschema/")
@app.post("/api/genschema/convert")
@app.post("/api/genschema/convert/")
async def generate_schema(request: Request) -> dict[str, Any]:
    payload = await read_graph_payload(request)
    return await run_generate_schema(payload)


@app.post(SIMILARITY_GRAPH_ENDPOINT)
@app.post(f"{SIMILARITY_GRAPH_ENDPOINT}/")
@app.post(SIMILARITY_GRAPH_ALIAS)
@app.post(f"{SIMILARITY_GRAPH_ALIAS}/")
async def similarity_graph(request: Request) -> dict[str, Any]:
    payload = await read_graph_payload(request)
    return build_similarity_graph(payload)


@app.post("/api/genschema/postprocess")
@app.post("/api/genschema/postprocess/")
async def postprocess_schema(request: Request) -> dict[str, Any]:
    payload = await read_graph_payload(request)

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
    display_schema = build_display_schema(
        result,
        {"use_default_comparators": True},
        default_comparator_specs=DEFAULT_COMPARATOR_SPECS,
    )
    return {
        "schema": result,
        "display_schema": display_schema,
    }


def main() -> None:
    host, port = get_server_address()
    import uvicorn

    print(f"{SERVICE_NAME} REST API listening on http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
