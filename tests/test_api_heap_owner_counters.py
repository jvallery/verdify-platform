"""Selected-source ownership counters: partial sends and retained capacity."""

import hashlib
import importlib.util
from pathlib import Path

from test_api_overflow_patch import PRELUDE, compile_native, queue_source

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("owner_patch", ROOT / "firmware/build_api_batch_patch.py")
PATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)
FIXTURE = ROOT / "tests/fixtures/esphome_api_batch"


def test_selected_source_snapshot_no_allocations_or_mutation(tmp_path):
    h = PATCH.transform("api_buffer.h", (FIXTURE / "api_buffer.h").read_text())
    h = "\n".join(line for line in h.splitlines() if not line.startswith("#include") and line != "#pragma once")
    # The production grow_ body is unchanged. Exact same selected source is
    # imported from the source-owned fixture header; supply its simple body.
    source = (
        PRELUDE
        + r"""
#undef ESPHOME_ALWAYS_INLINE
#define ESPHOME_ALWAYS_INLINE __attribute__((always_inline))
#include <memory>
#include <limits>
#include <utility>

"""
        + queue_source(patched=True)
        + h
        + r"""
namespace esphome::api {
void APIBuffer::grow_(size_t n) {
  auto new_data = make_buffer(n);
  if (this->size_) std::memcpy(new_data.get(), this->data_.get(), this->size_);
  this->data_ = std::move(new_data); this->capacity_ = n;
}
}
struct EntityBase {};
struct EventResponse { static constexpr uint8_t MESSAGE_TYPE=99; };
#define USE_EVENT
struct APIConnection {
"""
        + PATCH.replacement_batch()
        + r"""
  enum class ActiveIterator { NONE, LIST_ENTITIES, INITIAL_STATE };
  struct Flags { bool remove{false}; } flags_;
  ActiveIterator active_iterator_{ActiveIterator::NONE};
  DeferredBatch deferred_batch_;
  uint32_t verdify_connection_id_{0};
  struct Helper {
    const char *client_name_{"Home Assistant 2026.11.1"};
    const char *get_client_name() const { return client_name_; }
    esphome::api::APIBuffer rx_buf_;
    esphome::api::APIOverflowBuffer overflow_buf_;
"""
    )
    helper = PATCH.transform("api_frame_helper.h", (FIXTURE / "api_frame_helper.h").read_text())
    for signature in [
        "  size_t rx_capacity_bytes()",
        "  size_t overflow_allocated_bytes()",
        "  size_t overflow_pending_bytes()",
        "  size_t overflow_count()",
    ]:
        start, end = PATCH.function_span(helper, signature)
        source += helper[start:end] + "\n"
    source += (
        r"""
  };
  std::unique_ptr<Helper> helper_;
};
struct Server {
  esphome::api::APIBuffer shared_write_buffer_;
  std::array<std::unique_ptr<APIConnection>,20> clients;
  size_t n{0};
  auto active_clients() const { return std::span(clients.data(),n); }
"""
        + (ROOT / "firmware/patches/api_heap_snapshot.inc").read_text()
        + r"""
};
int main() {
  Server server;
  auto empty=server.heap_snapshot(); assert(empty.peers==0 && empty.shared_bytes==0);
  server.shared_write_buffer_.resize(1390); server.shared_write_buffer_.clear();
  // Peer creation/removal is synthetic; the actual selected snapshot consumes
  // the same fields and exact real overflow/deferred/API buffer implementations.
  for(size_t i=0;i<20;++i) {
    server.clients[i]=std::make_unique<APIConnection>();
    server.clients[i]->helper_=std::make_unique<APIConnection::Helper>();
  }
  server.n=20;
  auto &a=*server.clients[0], &b=*server.clients[1];
  a.active_iterator_=APIConnection::ActiveIterator::LIST_ENTITIES;
  b.flags_.remove=true;
  EntityBase entities[620];
  for(auto &entity:entities) assert(a.deferred_batch_.add_item(&entity,1,20));
  a.deferred_batch_.remove_front(610);
  b.helper_->rx_buf_.resize(500); b.helper_->rx_buf_.clear();
  unsigned char bytes[100]{}; iovec iov{bytes,100};
  assert(a.helper_->overflow_buf_.enqueue_iov(&iov,1,100,0));
  assert(b.helper_->overflow_buf_.enqueue_iov(&iov,1,100,20));
  esphome::socket::Socket sock; sock.next=30;
  a.helper_->overflow_buf_.try_drain(&sock);
  const size_t before_alloc=calls, before_live=outstanding, before_new=new_calls;
  const auto *items=a.deferred_batch_.items;
  // Review GL-1: the recorder among the clients, by its Hello name; the oldest of several, never a removed one.
  for(size_t i=0;i<20;++i) server.clients[i]->verdify_connection_id_=uint32_t(100+i);
  auto is_rec=[](const char *n){ return std::strcmp(n,"aioesphomeapi")==0; };
  assert(server.recorder_snapshot(+is_rec).connection_id==0);
  b.helper_->client_name_="aioesphomeapi";  // removed: not the recorder
  a.helper_->client_name_="aioesphomeapi";
  server.clients[7]->helper_->client_name_="aioesphomeapi";
  for(size_t repeat=0;repeat<10000;++repeat) {
    auto rec=server.recorder_snapshot(+is_rec);
    assert(rec.connection_id==100 && rec.syncing==1 && rec.batch_items==10);
    assert(rec.pending_bytes==a.helper_->overflow_pending_bytes() && rec.pending_bytes>0 && rec.pending_bytes<150);
    assert(rec.overflow_bytes==a.helper_->overflow_allocated_bytes() && rec.overflow_bytes>0);
    auto out=server.heap_snapshot();
    assert(out.peers==20 && out.removing==1 && out.syncing==1);
    assert(out.overflow_entries==2);
    assert(out.overflow_bytes==180+2*sizeof(esphome::api::APIOverflowBuffer::Entry));
    assert(out.pending_bytes==150 && out.batch_items==10);
    assert(out.batch_bytes==1024*sizeof(APIConnection::DeferredBatch::BatchItem));
    assert(out.rx_bytes==500 && out.shared_bytes==1390);
  }
  assert(calls==before_alloc && outstanding==before_live && new_calls==before_new);
  assert(a.deferred_batch_.items==items && a.deferred_batch_.size()==10);
  // Drain releases exact data; capacity clear differs from actual release.
  sock.next=99999; a.helper_->overflow_buf_.try_drain(&sock);
  b.helper_->overflow_buf_.try_drain(&sock);
  a.deferred_batch_.clear(); a.deferred_batch_.release_buffer();
  b.helper_->rx_buf_.release();
  a.flags_.remove=true;
  { auto rec=server.recorder_snapshot(+is_rec); assert(rec.connection_id==107 && rec.syncing==0 && rec.batch_items==0); }
  a.flags_.remove=false;
  auto drained=server.heap_snapshot();
  assert(drained.overflow_entries==0 && drained.overflow_bytes==0 && drained.pending_bytes==0);
  assert(drained.batch_bytes==0 && drained.rx_bytes==0 && drained.shared_bytes==1390);
  for(auto &client:server.clients) client.reset(); server.n=0;
  auto removed=server.heap_snapshot(); assert(removed.peers==0 && removed.shared_bytes==1390);
  server.shared_write_buffer_.release(); assert(server.heap_snapshot().shared_bytes==0);
}
"""
    )
    source = (
        r"""
#include <span>
#include <cstdlib>
#include <new>
static size_t new_calls=0;
void *operator new(size_t n) { ++new_calls; auto *p=std::malloc(n); if(!p) std::abort(); return p; }
void *operator new[](size_t n) { return ::operator new(n); }
void operator delete(void *p) noexcept { std::free(p); }
void operator delete[](void *p) noexcept { std::free(p); }
void operator delete(void *p, size_t) noexcept { std::free(p); }
void operator delete[](void *p, size_t) noexcept { std::free(p); }
"""
        + source
    )
    binary = compile_native(tmp_path, source, "heap-owner")
    import subprocess

    subprocess.run([str(binary)], check=True, capture_output=True, timeout=10)


def test_new_header_sources_exact_and_idempotent():
    for name in ["api_buffer.h", "api_frame_helper.h", "api_server.h"]:
        raw = (FIXTURE / name).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == PATCH.UPSTREAM_HASHES[name]
        patched = PATCH.transform(name, raw.decode()).encode()
        assert hashlib.sha256(patched).hexdigest() == PATCH.PATCHED_HASHES[name]


def test_counter_logs_only_existing_snapshot_events():
    config = (ROOT / "firmware/greenhouse.yaml").read_text()
    controls = (ROOT / "firmware/greenhouse/controls.yaml").read_text()
    assert config.count("heap_snapshot()") == 1
    # The 15-minute heap_profile log. The gap log's replay gate reads the recorder's own connection through
    # recorder_snapshot() (review GL-1), in the control pass (liveness) and the 250 ms pump (the gate); both
    # snapshots are allocation-free and read-only.
    assert controls.count("heap_snapshot()") == 1
    assert controls.count("recorder_snapshot(gap_log::is_recorder_client)") == 2
    assert controls.count("gap_log::ReplayConditions c;") == 1
    assert "return heap_kb < 15.0f;" in config
    assert "gh_take_control_loop_overrun_count()" in controls
    for text in [config, controls]:
        assert "api_pending_b=%u" in text and "api_shared_b=%u" in text


def test_existing_allocator_and_api_loop_bytes_preserved():
    # All executable allocator/send/drain/iterator code remains exact fe466. api_connection.h adds only the gap log's
    # per-connection id (review GL-1: a counter in a default member initializer, no allocation, no send path).
    for name, digest in {
        "api_connection.cpp": "29c45da79cf5d6a8c3db0eb1c91f4997ed6c04fc0bc83687d4e200a542fbde9d",
        "api_connection.h": "d440d47068e314d6372e7e1295837bf0803b42959ae2e526257411ab7c041390",
        "api_overflow_buffer.cpp": "370db5e67ad5c4145e6f1f7d93558a1502cb9680064f4cf28bbdae511d289003",
    }.items():
        actual = PATCH.transform(name, (FIXTURE / name).read_text()).encode()
        assert hashlib.sha256(actual).hexdigest() == digest
    h = PATCH.transform("api_overflow_buffer.h", (FIXTURE / "api_overflow_buffer.h").read_text())
    h = h.replace("\n" + (ROOT / "firmware/patches/api_overflow_snapshot.inc").read_text(), "", 1)
    assert hashlib.sha256(h.encode()).hexdigest() == "93524c629fbde8de099834586acd65a7e6351f818bad1a16ab9989cebc7b6359"
