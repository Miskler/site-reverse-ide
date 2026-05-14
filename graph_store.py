from __future__ import annotations

import json
import threading
from copy import deepcopy
from pathlib import Path
from typing import Any


class GraphValidationError(ValueError):
    pass


DEFAULT_GRAPH: dict[str, Any] = {
    "version": 1,
    "nodes": [
        {
            "id": "node-start",
            "title": "Идея",
            "note": "Сюда складываем исходную мысль, задачу или гипотезу.",
            "x": 120,
            "y": 120,
            "color": "#2f8f83",
        },
        {
            "id": "node-middle",
            "title": "Разбор",
            "note": "Промежуточный блок для шагов, зависимостей и черновиков.",
            "x": 420,
            "y": 260,
            "color": "#ef7d57",
        },
        {
            "id": "node-end",
            "title": "Результат",
            "note": "Финальный вывод, который должен получиться после связей.",
            "x": 780,
            "y": 160,
            "color": "#d9a441",
        },
    ],
    "edges": [
        {"id": "edge-start-middle", "source": "node-start", "target": "node-middle"},
        {"id": "edge-middle-end", "source": "node-middle", "target": "node-end"},
    ],
}


class GraphStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()

    def load(self) -> dict[str, Any]:
        if not self.path.exists():
            return deepcopy(DEFAULT_GRAPH)

        try:
            raw = self.path.read_text(encoding="utf-8")
            parsed = json.loads(raw)
            return self._normalize_graph(parsed)
        except (OSError, json.JSONDecodeError, GraphValidationError):
            return deepcopy(DEFAULT_GRAPH)

    def save(self, payload: dict[str, Any]) -> dict[str, Any]:
        graph = self._normalize_graph(payload)
        self.path.parent.mkdir(parents=True, exist_ok=True)

        serialized = json.dumps(graph, ensure_ascii=False, indent=2)
        with self._lock:
            temp_path = self.path.with_suffix(".json.tmp")
            temp_path.write_text(serialized, encoding="utf-8")
            temp_path.replace(self.path)

        return graph

    def _normalize_graph(self, payload: Any) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise GraphValidationError("Graph payload must be a JSON object")

        version = payload.get("version", 1)
        if version != 1:
            raise GraphValidationError("Unsupported graph version")

        nodes = payload.get("nodes")
        edges = payload.get("edges")
        if not isinstance(nodes, list):
            raise GraphValidationError("nodes must be a list")
        if not isinstance(edges, list):
            raise GraphValidationError("edges must be a list")

        normalized_nodes: list[dict[str, Any]] = []
        node_ids: set[str] = set()
        for node in nodes:
            normalized_nodes.append(self._normalize_node(node, node_ids))

        node_lookup = {node["id"]: node for node in normalized_nodes}
        normalized_edges: list[dict[str, Any]] = []
        edge_ids: set[str] = set()
        seen_pairs: set[tuple[str, str]] = set()
        for edge in edges:
            normalized_edge = self._normalize_edge(edge, node_lookup, edge_ids, seen_pairs)
            if normalized_edge is not None:
                normalized_edges.append(normalized_edge)

        return {
            "version": 1,
            "nodes": normalized_nodes,
            "edges": normalized_edges,
        }

    def _normalize_node(self, node: Any, node_ids: set[str]) -> dict[str, Any]:
        if not isinstance(node, dict):
            raise GraphValidationError("Each node must be an object")

        node_id = self._require_string(node.get("id"), "node.id")
        if node_id in node_ids:
            raise GraphValidationError(f"Duplicate node id: {node_id}")
        node_ids.add(node_id)

        title = self._clean_text(node.get("title"), "node.title", fallback="Без названия")
        note = self._clean_text(node.get("note"), "node.note", fallback="")
        x = self._require_number(node.get("x"), "node.x")
        y = self._require_number(node.get("y"), "node.y")
        color = self._clean_color(node.get("color"))

        return {
            "id": node_id,
            "title": title,
            "note": note,
            "x": x,
            "y": y,
            "color": color,
        }

    def _normalize_edge(
        self,
        edge: Any,
        node_lookup: dict[str, dict[str, Any]],
        edge_ids: set[str],
        seen_pairs: set[tuple[str, str]],
    ) -> dict[str, Any] | None:
        if not isinstance(edge, dict):
            raise GraphValidationError("Each edge must be an object")

        edge_id = self._require_string(edge.get("id"), "edge.id")
        if edge_id in edge_ids:
            raise GraphValidationError(f"Duplicate edge id: {edge_id}")
        edge_ids.add(edge_id)

        source = self._require_string(edge.get("source"), "edge.source")
        target = self._require_string(edge.get("target"), "edge.target")
        if source == target:
            return None
        if source not in node_lookup or target not in node_lookup:
            return None

        pair = (source, target)
        if pair in seen_pairs:
            return None
        seen_pairs.add(pair)

        return {
            "id": edge_id,
            "source": source,
            "target": target,
        }

    def _require_string(self, value: Any, field_name: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise GraphValidationError(f"{field_name} must be a non-empty string")
        return value.strip()

    def _require_number(self, value: Any, field_name: str) -> float:
        if not isinstance(value, (int, float)):
            raise GraphValidationError(f"{field_name} must be a number")
        return float(value)

    def _clean_text(self, value: Any, field_name: str, fallback: str) -> str:
        if value is None:
            return fallback
        if not isinstance(value, str):
            raise GraphValidationError(f"{field_name} must be a string")
        text = value.strip()
        return text if text else fallback

    def _clean_color(self, value: Any) -> str:
        if not isinstance(value, str):
            return "#2f8f83"
        text = value.strip()
        if not text.startswith("#") or len(text) not in (4, 7):
            return "#2f8f83"
        return text
