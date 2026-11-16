  // Allocation-free main-loop snapshot: no socket/lock calls or state changes.
  // Excludes allocator metadata, lwIP/WiFi and Noise crypto allocations.
  struct HeapSnapshot {
    size_t peers{0}, removing{0}, syncing{0}, overflow_entries{0};
    size_t overflow_bytes{0}, pending_bytes{0}, batch_items{0};
    size_t batch_bytes{0}, rx_bytes{0}, shared_bytes{0};
  };
  HeapSnapshot heap_snapshot() const {
    HeapSnapshot out;
    out.shared_bytes = this->shared_write_buffer_.capacity_bytes();
    for (const auto &client : this->active_clients()) {
      ++out.peers;
      out.removing += client->flags_.remove;
      out.syncing += client->active_iterator_ != APIConnection::ActiveIterator::NONE;
      out.batch_items += client->deferred_batch_.size();
      out.batch_bytes += client->deferred_batch_.capacity * sizeof(APIConnection::DeferredBatch::BatchItem);
      if (client->helper_ != nullptr) {
        out.overflow_entries += client->helper_->overflow_count();
        out.overflow_bytes += client->helper_->overflow_allocated_bytes();
        out.pending_bytes += client->helper_->overflow_pending_bytes();
        out.rx_bytes += client->helper_->rx_capacity_bytes();
      }
    }
    return out;
  }
  // Verdify gap log (review GL-1): the recorder among the clients, by the client_info of its Hello, tested by the
  // caller's predicate (gap_log::is_recorder_client, the one list). Read-only and allocation-free, as above. With
  // several matches, the oldest connection (lowest id). connection_id 0 = no recorder attached.
  struct RecorderSnapshot {
    uint32_t connection_id{0};
    size_t syncing{0}, pending_bytes{0}, overflow_bytes{0}, batch_items{0};
  };
  RecorderSnapshot recorder_snapshot(bool (*is_recorder)(const char *)) const {
    RecorderSnapshot out;
    for (const auto &client : this->active_clients()) {
      if (client->flags_.remove || client->helper_ == nullptr) continue;
      if (!is_recorder(client->helper_->get_client_name())) continue;
      if (out.connection_id != 0 && client->verdify_connection_id_ > out.connection_id) continue;
      out.connection_id = client->verdify_connection_id_;
      out.syncing = client->active_iterator_ != APIConnection::ActiveIterator::NONE;
      out.pending_bytes = client->helper_->overflow_pending_bytes();
      out.overflow_bytes = client->helper_->overflow_allocated_bytes();
      out.batch_items = client->deferred_batch_.size();
    }
    return out;
  }
