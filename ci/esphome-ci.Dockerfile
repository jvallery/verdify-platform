# ============================================================================
# verdify-esphome-ci: the job image of the verdify-platform-ci-esphome ARC set
# (jvallery/estate-ci runners.yaml), which runs ci/gha/firmware_secretless_compile.py.
#
# Why (#1535): the plain ESPHome image installs the pioarduino platform and its
# toolchain packages from github.com release assets on every run, and those
# downloads (HTTP 504) failed half of the failing main runs. This image installs
# them once, at build time, into /opt/verdify-platformio, which the compile job
# then uses in place (the path matters: pioarduino installs its tools and the
# ESP-IDF Python environment by absolute path). Each ARC job gets a fresh
# container, so the directory is still private to one run.
#
# The esp32 block below must match firmware/greenhouse.yaml (board, framework
# type, version, platform_version); firmware/greenhouse-recovery.yaml has no
# esp32 block of its own and inherits it through `packages: base: !include
# greenhouse.yaml`. tests/test_gha_firmware_secretless_compile.py fails when
# either drifts. Only the PlatformIO core (platform, framework and toolchain
# packages, the github.com release assets) is baked: PlatformIO libraries and
# ESP-IDF managed components resolve per build directory from
# registry.platformio.org and components.espressif.com, as before. After a
# change, build.yml builds verdifyconsultancy/verdify-esphome-ci (path impact,
# profile esphome-ci); repin the ci-esphome job_image in estate-ci runners.yaml.
#
# Base: ESPHome 2026.6.5, the zot mirror of the same index digest the set ran
# (estate-ci mirrors.txt). Copies nothing from the repository.
# ============================================================================
FROM registry.vallery.net/jvallery/estate-ci/mirror/ghcr.io/esphome/esphome@sha256:ffe23402d169fc9b8ff29fc3c9fc13b3c47e8a53726fce4569e2280bd534c84c

ENV PLATFORMIO_CORE_DIR=/opt/verdify-platformio

# A minimal config with the firmware's esp32 block installs the same platform,
# framework and toolchain packages; retried because the downloads are flaky.
RUN set -eux; \
    mkdir -p /tmp/toolchain-bake; \
    printf '%s\n' \
      'esphome:' \
      '  name: toolchain-bake' \
      'esp32:' \
      '  board: esp32dev' \
      '  framework:' \
      '    type: esp-idf' \
      '    version: 5.5.4' \
      '    platform_version: 55.3.39' \
      > /tmp/toolchain-bake/bake.yaml; \
    for attempt in 1 2 3; do \
      esphome compile /tmp/toolchain-bake/bake.yaml && break; \
      [ "$attempt" -lt 3 ]; \
      sleep 30; \
    done; \
    test -d /opt/verdify-platformio/platforms; \
    test -d /opt/verdify-platformio/packages; \
    rm -rf /tmp/toolchain-bake /root/.cache; \
    chmod -R a+rwX /opt/verdify-platformio
