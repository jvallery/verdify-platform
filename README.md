# Verdify

**A public AI-assisted greenhouse control loop.**

367 sq ft. Longmont, Colorado. 5,090 feet. 15% humidity. 95°F solar peaks. Mixed crops. One deterministic controller.

The band is the policy: what the house should be at each point of the solar day.
An ESP32 controller decides climate alone, every second, with one band-edge law
(`firmware/lib/climate_law.h`) whose thresholds are fixed offsets from the band
edges and whose constants are compiled from one file. The host serves the band
and one price (the drying cost limit), stores telemetry, grades compliance and
raises alerts. The AI reviewer (Iris) reads the record once a day and writes no
climate value. [docs/CONTROL-ARCHITECTURE.md](docs/CONTROL-ARCHITECTURE.md) is
the control document.

**[verdify.ai](https://verdify.ai)**

## Architecture

```
crop_band_anchors (DB) + drying cost limit (DB) + operator switches, irrigation, lighting
  └── Ingestor (the only device writer): pushes on change or readback mismatch,
      confirms every pushed value by its readback, stores telemetry, grades, alerts
        └── ESP32 controller: band curve from stored anchors and its clock,
            the band-edge law every second, relay layer, irrigation engine,
            lighting, gap log in flash

TimescaleDB (telemetry, relay events, band, settings, compliance, daily record, alerts)
  ├── Operator dashboard (dashboard.verdify.ai: band editor, settings, water, review)
  ├── Grafana (public and private dashboards)
  ├── FastAPI (public and operator APIs, product metrics)
  ├── MCP server (typed read tools, irrigation tools, operator switches)
  └── Quartz (static lab site with embedded panels)

Reviewer (Iris: Hermes hermes-iris → OpenAI GPT-6 Luna / xhigh → MCP): once a day
reads the daily record and writes one review row; it proposes band edits and
writes no climate value.
```

Everything runs in one production environment on k3s; relay control stays local on
the ESP32, which keeps holding the band with no host, clock or network.

## Components

| Directory | What |
|-----------|------|
| `ingestor/` | Python async service — ESP32 data capture, 15 periodic tasks, entity routing |
| `api/` | FastAPI public API, the operator API behind the dashboard, and the product metrics |
| `firmware/` | ESPHome YAML + C++ headers: the band-edge climate law (`lib/climate_law.h`), the irrigation engine and lighting |
| `mcp/` | FastMCP server: typed read tools, irrigation tools and the operator switches for agents |
| `dashboard/` | The operator web app for `dashboard.verdify.ai` |
| `deploy/k8s/` | Kustomize sources for production, the dashboard and the descheduler |
| `scripts/` | Operational scripts: release promotion, smoke checks, generators, site publishing |
| `grafana/` | Grafana dashboard JSON + provisioning config (dashboards render into ConfigMaps under `deploy/k8s/components/grafana/`) |
| `db/` | Schema, analytical views, functions, and migrations |
| `templates/` | Jinja2 planner prompt + reference docs |
| `config/` | AI model config, zone definitions |
| `tests/` | Smoke, drift, and integration tests |
| `site/` | Canonical Quartz static-site generator for `lab.verdify.ai` |

## Development

```bash
# Prerequisites: Docker, Python 3.12+ (3.13 preferred for parity with CI/runtime)

# Create/update repo-local tooling environment (.venv)
make setup

# Full offline pre-merge gate (scripts/ci-local.sh)
make ci

# Individual commands
make lint              # Ruff linter
make format            # Auto-format Python
make test-firmware     # Native firmware logic tests + replay
make firmware-check    # Compile ESP32 firmware
make planner-dry       # Render planner prompt (no API call)
make test              # tests/, including live-stack smoke tests (needs kubectl + prod access)
make help              # List all targets
```

**Tooling:** ruff (lint + format), pytest, pre-commit hooks, and GitHub Actions
on in-cluster runners. Images are built with Kaniko, pushed to the estate
registry and promoted by digest pins.
**Config:** `pyproject.toml` is the single source of truth for deps, lint rules, and test config. `make setup` reads it directly; there is no checked-in duplicate requirements file for local tooling.

### Agents

Agent guidance lives in `AGENTS.md`, which Claude Code and Codex both read.

## The Greenhouse

The control system has three parts:

1. **The band**: the owner's temperature and VPD edges across the solar day
   (sunrise, solar noon, sunset, solar midnight), edited in the dashboard and
   stored on the controller.
2. **The controller**: the band-edge law, every second, on the ESP32. Inside the
   band only the electric heater works steadily; every other action starts at an
   edge. Protection limits (100°F and 40°F) hold whatever the host does.
3. **The reviewer**: Iris reads the daily record once a day, writes a short
   review and may propose band edits with their simulated price. Only the owner
   changes the band.

Telemetry, readbacks, dashboards and the lab notebook show what happened.

## KPIs

Band compliance (graded in five-minute buckets against the band the controller
served), relay cycles and run time, energy and water use, and the drying meter,
all in the daily record.

## License

MIT
