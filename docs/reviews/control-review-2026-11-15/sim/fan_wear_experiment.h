#pragma once

#include <deque>

// Simulator experiment only. Positive balance means Fan 1 had more recent exclusive air time.
class FanWearExperiment {
 public:
  explicit FanWearExperiment(double window_s) : window_s_(window_s) {}

  bool choose(double now, bool turn1, bool may1, bool may2) {
    if (may1 != may2) return may1;
    if (!may1 || window_s_ == 0) return turn1;
    expire(now);
    return balance_ == 0 ? turn1 : balance_ < 0;
  }

  void observe(double now, double dt, bool fan1, bool fan2) {
    if (window_s_ == 0) return;
    expire(now);
    if (fan1 == fan2) return;
    const int sign = fan1 ? 1 : -1;
    if (!history_.empty() && history_.back().end == now && history_.back().sign == sign) {
      history_.back().end = now + dt;
    } else {
      history_.push_back({now, now + dt, sign});
    }
    balance_ += sign * dt;
  }

 private:
  struct Interval {
    double start;
    double end;
    int sign;
  };

  void expire(double now) {
    const double cutoff = now - window_s_;
    while (!history_.empty() && history_.front().start < cutoff) {
      auto& first = history_.front();
      if (first.end <= cutoff) {
        balance_ -= first.sign * (first.end - first.start);
        history_.pop_front();
      } else {
        balance_ -= first.sign * (cutoff - first.start);
        first.start = cutoff;
      }
    }
  }

  double window_s_;
  double balance_ = 0;
  std::deque<Interval> history_;
};
