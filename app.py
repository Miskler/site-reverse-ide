from __future__ import annotations

from pathlib import Path

from flask import Flask, jsonify, render_template, request

from graph_store import GraphStore, GraphValidationError


def create_app() -> Flask:
    app = Flask(__name__, instance_relative_config=True)
    store = GraphStore(Path(app.instance_path) / "graph.json")

    @app.get("/")
    def index() -> str:
        return render_template("index.html")

    @app.get("/api/graph")
    def get_graph():
        return jsonify(store.load())

    @app.post("/api/graph")
    def save_graph():
        payload = request.get_json(silent=True)
        if payload is None:
            return jsonify({"error": "JSON body is required"}), 400

        try:
            saved = store.save(payload)
        except GraphValidationError as exc:
            return jsonify({"error": str(exc)}), 400

        return jsonify(saved)

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    return app


app = create_app()


if __name__ == "__main__":
    import os

    app.run(
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG", "0") == "1",
    )
