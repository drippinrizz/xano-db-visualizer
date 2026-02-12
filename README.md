# Xano DB Visualizer

Interactive node-based graph visualizer for Xano databases. Zero dependencies — runs on Node.js 18+ with nothing to install.

One command deploys a **self-hosted visualizer** directly to your Xano workspace. No local servers, no hosting, no config — just a URL you open in your browser.

![graph](https://img.shields.io/badge/canvas-2D_graph-a78bfa?style=flat-square) ![zero deps](https://img.shields.io/badge/deps-zero-34d399?style=flat-square) ![node 18+](https://img.shields.io/badge/node-18%2B-60a5fa?style=flat-square)

## What it does

- **Auto-discovers** every table in your Xano workspace
- **Detects foreign keys** (`*_id` fields) and draws relationship edges between records
- **Deploys two endpoints** to a "Visualizer" API group:
  - `GET /graph-data` — returns all records from all tables as JSON
  - `GET /visualizer` — serves the full interactive HTML page (self-hosted on Xano)
- **Outputs a single URL** — open it and you're looking at your data

### The Visualizer

- **Force-directed graph layout** with clustered table groupings
- **Hover** any node to see its fields and connected records
- **Click a table label** to zoom into that cluster
- **Search** records in real-time
- **Filter** by table via the legend
- **Smooth animations** with spring physics and eased zoom
- Canvas-rendered, handles hundreds of records

## Quick Start

```bash
git clone https://github.com/camcodes/xano-db-visualizer.git
cd xano-db-visualizer
node setup.mjs
```

The CLI will prompt you for:
1. Your Xano workspace base URL (e.g. `https://xxxx-xxxx.n7.xano.io`)
2. Your Metadata API key (from Xano Account → Metadata API)

It then:
1. Lists your workspaces — pick one
2. Discovers all tables
3. Deploys both endpoints
4. Prints the visualizer URL

```
╔═══════════════════════════════════════════════════════╗
║                  Setup Complete! ✓                    ║
╚═══════════════════════════════════════════════════════╝

Visualizer URL: https://your-workspace.xano.io/api:xxx/visualizer

Open that URL in your browser — it just works!
```

## How it works

```
┌─────────────┐     ┌──────────────────────┐     ┌────────────────┐
│  setup.mjs  │────▶│  Xano Meta API       │────▶│  /graph-data   │
│  (CLI)      │     │  (discover + deploy)  │     │  (JSON API)    │
└─────────────┘     └──────────────────────┘     └───────┬────────┘
                                                         │
                    ┌──────────────────────┐             │ fetch
                    │  /visualizer         │◀────────────┘
                    │  (self-hosted HTML)  │
                    │  Canvas graph engine │
                    └──────────────────────┘
```

The visualizer HTML page is embedded inside the Xano endpoint itself — served with `Content-Type: text/html`. It fetches `./graph-data` relative to its own URL, so it's completely self-contained within a single API group.

## Controls

| Action | Effect |
|--------|--------|
| **Scroll** | Zoom in/out |
| **Drag** | Pan the canvas |
| **Click table label** | Zoom to that cluster |
| **Double-click** | Fit all nodes |
| **F** | Fit all nodes |
| **Esc** | Reset filters and search |
| **Hover node** | Show record details + connections |
| **Click legend item** | Filter to that table |

## Requirements

- **Node.js 18+** (uses native `fetch`)
- **Xano account** with Metadata API access
- No npm install needed — zero dependencies

## FAQ

**Does this read my data?**
Yes — the `graph-data` endpoint queries up to 250 records per table. It's a public GET endpoint. If your data is sensitive, you can add authentication to the API group in Xano after deployment.

**Can I run this on multiple workspaces?**
Yes — run the CLI again with a different workspace. Each gets its own "Visualizer" API group.

**What if a table name has hyphens?**
Handled — keys with special characters are auto-quoted in the XanoScript to prevent parsing issues.

## License

MIT
