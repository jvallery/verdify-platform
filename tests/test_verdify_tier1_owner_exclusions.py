"""Only single-label product hosts reach the Verdify tier-2 forwarder."""

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "deploy/k8s/overlays/prod/traefik/verdify-tier1-apps-forward.yaml"


def test_outside_owner_exclusions_preserve_existing_forwarder_contract():
    route = yaml.safe_load(SOURCE.read_text())
    spec = route["spec"]
    match = spec["routes"][0]["match"]
    assert set(re.findall(r"!Host\(`([^`]+)`\)", match)) == {
        name + ".verdify.ai"
        for name in (
            "www",
            "www-dev",
            "proposals-hello",
            "auth",
            "crm",
            "mqtt",
            "dashboard",
        )
    }
    assert spec["entryPoints"] == ["websecure", "web"]
    assert spec["routes"][0]["priority"] == 50
    assert spec["routes"][0]["services"] == [{"name": "verdify-traefik", "port": 80}]
    assert spec["tls"] == {}


def test_product_and_unknown_single_label_hosts_keep_forwarding():
    match = yaml.safe_load(SOURCE.read_text())["spec"]["routes"][0]["match"]
    expression = re.search(r"HostRegexp\(`([^`]+)`\)", match).group(1)
    excluded = set(re.findall(r"!Host\(`([^`]+)`\)", match))

    def forwards(host):
        return re.fullmatch(expression, host) is not None and host not in excluded

    assert all(forwards(name + ".verdify.ai") for name in ("api", "lab", "labs", "graphs", "mcp", "unclaimed"))
    # Retired (network-infra#602); no longer excluded (#1582).
    assert all(forwards(name + ".verdify.ai") for name in ("analytics", "logs", "botauth", "traefik"))
    assert not any(
        forwards(host)
        for host in (
            "www-dev.verdify.ai",
            "proposals-hello.verdify.ai",
            "dashboard.verdify.ai",
            "verdify.ai",
            "a.b.verdify.ai",
        )
    )


def test_public_product_hosts_carry_shared_hsts_baseline():
    """network-infra#1104: HSTS baseline on api/lab/labs/mcp, not on graphs."""
    routes = yaml.safe_load(SOURCE.read_text())["spec"]["routes"]
    hardened = routes[1]
    assert set(re.findall(r"Host\(`([^`]+)`\)", hardened["match"])) == {
        name + ".verdify.ai" for name in ("api", "lab", "labs", "mcp")
    }
    assert hardened["priority"] > routes[0]["priority"]
    assert hardened["middlewares"][0] == {"name": "baseline-headers-app-csp", "namespace": "network-infra"}
    assert hardened["services"] == routes[0]["services"]
    # graphs panels are iframed cross-origin by lab; SAMEORIGIN would break them.
    assert "graphs.verdify.ai" not in hardened["match"]
    assert routes[0]["middlewares"] == [{"name": "hsts-only", "namespace": "network-infra"}]


def test_graphs_host_carries_hsts_only():
    """network-infra#1104: graphs gets HSTS without the frame/CSP baseline."""
    routes = yaml.safe_load(SOURCE.read_text())["spec"]["routes"]
    graphs = routes[2]
    assert graphs["match"] == "Host(`graphs.verdify.ai`)"
    assert graphs["priority"] > routes[0]["priority"]
    assert graphs["middlewares"] == [{"name": "hsts-only", "namespace": "network-infra"}]
    assert graphs["services"] == routes[0]["services"]
