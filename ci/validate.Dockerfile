# ============================================================================
# verdify-ci-validate: the job image of the verdify-platform-ci ARC set
# (jvallery/estate-ci runners.yaml), where the validate parts run
# ci/gha/validate.sh and scripts/ci-local.sh. PostgreSQL 16 is preinstalled
# and the base's Debian packages are upgraded at build time.
#
# Why: postgres_bin() in scripts/qualify-component-containment.py uses an
# installed /usr/lib/postgresql/16 toolchain when one is present. Otherwise it
# downloads and unpacks the PGDG packages on every validate run, which takes
# about 170 s per PR. The upgrade picks up bookworm-security fixes that the
# upstream python:3.13-bookworm index has not been rebuilt with yet, so the
# image passes the CVE gate without an exception row.
#
# Base: python:3.13-bookworm (Debian 12 bookworm; it already ships g++, make,
# git, curl and tar), the estate-ci mirrors.txt copy of the same index digest
# the set ran before this image. tests/test_ci_validate_dockerfile.py pins it.
#
# Build: build.yml builds verdifyconsultancy/verdify-ci-validate (path impact,
# profile ci-validate) on a merge that changes this file; repin the ci set's
# job_image in estate-ci runners.yaml with the new digest. Kaniko and BuildKit
# read ci/validate.Dockerfile.dockerignore in place of the root .dockerignore,
# so the build context holds only the two COPY inputs below.
#
# Keep COPY lines plain: no ADD, no flag other than --from=<earlier stage>, and
# no $ in a COPY line. The in-cluster Kaniko path rebuilds every image on those.
# ============================================================================

# Runtime provenance, as in api/Dockerfile: repo-build passes the exact 40-hex
# revision as GIT_SHA. A build without it falls back to the detached
# checkout's .git/HEAD (from a linked worktree, pass GIT_SHA).
FROM registry.vallery.net/jvallery/estate-ci/mirror/docker.io/library/python@sha256:cc55e4ded9c95f6ce2133b3d096db43f214d280c2a8af65d83e246c8fa7d168c AS source-metadata
ARG GIT_SHA=unknown
COPY .git /tmp/verdify-git-metadata
RUN set -eu; \
    candidate="$GIT_SHA"; \
    if ! printf '%s\n' "$candidate" | grep -Eq '^[0-9a-f]{40}$'; then \
        test -f /tmp/verdify-git-metadata/HEAD; \
        candidate="$(tr -d '\r\n' < /tmp/verdify-git-metadata/HEAD)"; \
    fi; \
    printf '%s\n' "$candidate" | grep -Eq '^[0-9a-f]{40}$'; \
    install -d -m 0755 /out; \
    printf '%s\n' "$candidate" > /out/source-revision; \
    chmod 0444 /out/source-revision

FROM registry.vallery.net/jvallery/estate-ci/mirror/docker.io/library/python@sha256:cc55e4ded9c95f6ce2133b3d096db43f214d280c2a8af65d83e246c8fa7d168c

# The PGDG signing key is the vendored copy that the qualifier also reads. The
# build checks it against the qualifier's pinned SHA-256 (PGDG_KEY_SHA256)
# before apt uses it, and signed-by limits its trust to the PGDG source.
COPY db/qualification/pgdg-ACCC4CF8.asc /etc/apt/keyrings/pgdg-ACCC4CF8.asc

# Upgrade the base's Debian packages (bookworm-security fixes the upstream
# index lacks), then install the PostgreSQL 16 server and client at the paths
# postgres_bin() checks. These are packages only: with create_main_cluster = false the package
# scripts create no cluster, so no server can start. The containment fixture
# initialises its own private cluster at test time.
RUN set -eux; \
    export DEBIAN_FRONTEND=noninteractive; \
    echo '0144068502a1eddd2a0280ede10ef607d1ec592ce819940991203941564e8e76  /etc/apt/keyrings/pgdg-ACCC4CF8.asc' | sha256sum -c -; \
    chmod 0644 /etc/apt/keyrings/pgdg-ACCC4CF8.asc; \
    grep -qx 'VERSION_CODENAME=bookworm' /etc/os-release; \
    echo 'deb [signed-by=/etc/apt/keyrings/pgdg-ACCC4CF8.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get -y upgrade; \
    apt-get install -y --no-install-recommends postgresql-common; \
    sed -ri 's/#(create_main_cluster) .*$/\1 = false/' /etc/postgresql-common/createcluster.conf; \
    grep -qx 'create_main_cluster = false' /etc/postgresql-common/createcluster.conf; \
    apt-get install -y --no-install-recommends postgresql-16 postgresql-client-16; \
    rm -rf /var/lib/apt/lists/*; \
    test -x /usr/lib/postgresql/16/bin/initdb; \
    test -f /usr/share/postgresql/16/extension/pgcrypto.control; \
    /usr/lib/postgresql/16/bin/postgres --version; \
    test -z "$(pg_lsclusters --no-header)"

# No kustomize here: the estate-ci runner image provides kustomize on PATH
# (ci_require_runner_tools in ci/gha/lib.sh), built with a current Go. The
# upstream release binary carried a fixable Go standard-library CVE.

COPY --from=source-metadata /out/source-revision /etc/verdify/source-revision

# The managed Kaniko invocation sets the revision and created OCI labels. There
# is no ENV, USER or WORKDIR: the validate step runs as root in the base's
# environment.
LABEL org.opencontainers.image.source="https://github.com/jvallery/verdify-platform" \
      org.opencontainers.image.title="verdify-ci-validate"
