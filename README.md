# Canvas Links

Node app for editing function cards and links, plus a side-by-side Python REST API for the `genschema` library.

## Node app

```bash
npm install
npm run dev
```

Development:

- UI: `http://127.0.0.1:5173`
- Node API: `http://127.0.0.1:3001`
- The node editor popup now accepts raw JSON and sends it to the Python `genschema` backend.
- By default the UI expects that backend at `http://127.0.0.1:8000`; set `VITE_GENSCHEMA_URL` if you run it elsewhere.

Production:

```bash
npm run build
npm start
```

Production UI:

- `http://127.0.0.1:3000`

## Python genschema API

The Python server wraps the real [`genschema`](https://pypi.org/project/genschema/) package and exposes it over REST.

Install dependencies:

```bash
pip install -r python-server/requirements.txt
```

Run the server:

```bash
python python-server/genschema_server.py
```

Or:

```bash
npm run py:genschema
```

Default address:

- `http://127.0.0.1:8000`

Endpoints:

- `GET /api/health`
- `GET /api/genschema`
- `POST /api/genschema`
- `POST /api/genschema/postprocess`
- `POST /api/genschema/similarity-graph`
- `POST /api/genschema/graph`

Example request:

```bash
curl -X POST http://127.0.0.1:8000/api/genschema \
  -H "Content-Type: application/json" \
  -d '{
    "base_of": "anyOf",
    "pseudo_array": true,
    "documents": [
      { "name": "Alice", "email": "alice@example.com" },
      { "name": "Bob", "email": "bob@example.com" }
    ],
    "use_default_comparators": true
  }'
```

The server accepts:

- `inputs`, `documents`, or `items` as the input array
- `kind: "json"` or `kind: "schema"` wrappers for explicit input types
- optional `label`, `title`, or `name` on wrapper items for graph node labels
- optional comparator configuration for `FormatComparator`, `EnumComparator`, `RequiredComparator`, `EmptyComparator`, `DeleteElement`, `NoAdditionalProperties`, `PreserveCommonKeywordsComparator`, and `SchemaVersionComparator`
- optional reference postprocessing via `SchemaReferencePostprocessor`

The similarity graph endpoint returns a complete weighted graph where each node is one input and each edge is one pairwise schema match.

Graph defaults:

- shape-first comparator set: `FormatComparator`, `RequiredComparator`, `EmptyComparator`, `DeleteElement`
- `EnumComparator` is disabled by default so low-cardinality strings do not dominate similarity
- score uses Dice similarity over structural schema tokens

Example graph request:

```bash
curl -X POST http://127.0.0.1:8000/api/genschema/similarity-graph \
  -H "Content-Type: application/json" \
  -d '{
    "documents": [
      {
        "kind": "json",
        "label": "alpha",
        "value": { "name": "Alice", "email": "alice@example.com" }
      },
      {
        "kind": "json",
        "label": "beta",
        "value": { "name": "Bob", "email": "bob@example.com", "age": 30 }
      }
    ]
  }'
```
