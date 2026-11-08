"""#1496: api and hermes-iris egress is an explicit allowlist (in-cluster, Frigate's hostNetwork
endpoint, public tcp/443), never IoT, Home, the management set or another public port."""

import ipaddress

import pytest
from test_egress_deny_management import pod_labels, policies, rendered, selected  # noqa: F401

ALLOW = "egress-api-hermes-allowlist"


@pytest.fixture(scope="module")
def allow(rendered):  # noqa: F811
    return policies(rendered)[ALLOW]


def test_allowlist_is_the_only_egress_policy_for_api_and_hermes(rendered):  # noqa: F811
    egress = {name: p for name, p in policies(rendered).items() if "Egress" in p["spec"].get("policyTypes", [])}
    by_workload = {
        workload: sorted(name for name, p in egress.items() if selected(p["spec"]["podSelector"], labels))
        for workload, labels in pod_labels(rendered)
    }
    assert by_workload["verdify-api"] == [ALLOW]
    assert by_workload["verdify-hermes-iris"] == [ALLOW]
    assert {w for w, names in by_workload.items() if ALLOW in names} == {"verdify-api", "verdify-hermes-iris"}


def reaches(policy, address, port):
    address = ipaddress.ip_address(address)
    for rule in policy["spec"]["egress"]:
        ports = rule.get("ports")
        if ports is not None and not any(p["port"] == port and p.get("protocol", "TCP") == "TCP" for p in ports):
            continue
        for peer in rule["to"]:
            block = peer["ipBlock"]
            if address in ipaddress.ip_network(block["cidr"]) and not any(
                address in ipaddress.ip_network(x) for x in block.get("except", [])
            ):
                return True
    return False


@pytest.mark.parametrize(
    "address,port",
    [
        ("10.43.0.10", 53),  # CoreDNS service
        ("10.42.6.239", 5432),  # verdify-db pod
        ("10.43.212.2", 8000),  # verdify-mcp
        ("192.168.30.39", 8973),  # Frigate hostNetwork on node8
        ("192.168.30.35", 8973),  # Frigate after a reschedule
        ("104.18.94.41", 443),  # public HTTPS (Cloudflare, OpenAI)
    ],
)
def test_declared_dependencies_are_allowed(allow, address, port):
    assert reaches(allow, address, port), (address, port)


@pytest.mark.parametrize(
    "address,port",
    [
        ("192.168.10.111", 6053),  # greenhouse ESP32 (the ingestor is the only device writer)
        ("192.168.10.36", 502),  # Shelly Modbus on IoT
        ("192.168.10.50", 80),  # IoT web
        ("192.168.40.20", 80),  # Home
        ("192.168.40.20", 443),
        ("192.168.30.107", 8123),  # Home Assistant
        ("192.168.30.126", 443),  # NAS (management)
        ("192.168.30.31", 6443),  # control plane (management)
        ("192.168.30.39", 22),  # worker SSH
        ("192.168.7.53", 53),  # Pi-hole outside CoreDNS
        ("1.1.1.1", 53),  # public DNS
        ("104.18.94.41", 80),  # public, non-443
        ("104.18.94.41", 587),  # SMTP is not configured in production
        ("100.64.0.1", 443),  # CGNAT
        ("169.254.169.254", 443),  # link-local metadata
    ],
)
def test_iot_home_management_and_other_ports_are_refused(allow, address, port):
    assert not reaches(allow, address, port), (address, port)
