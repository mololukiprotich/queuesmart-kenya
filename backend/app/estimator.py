"""
Wait-time estimation — deliberately NOT machine learning for v1.

estimated_wait = (position_in_queue / active_counters_for_service) * avg_service_time

This is Little's Law applied at counter level: with N people ahead of you
split across k active counters, you're roughly N/k "service turns" away,
each turn taking the service's average completion time. It's transparent
(you can explain exactly why a number is what it is — important for a
system citizens are trusting with their time), cheap to compute, and it
self-corrects as staffing changes through the day. An ML model needs
historical data to train on; this needs none, and the ticket timestamp
log we keep regardless becomes that training data later if it's ever wanted.
"""


def estimate_wait_seconds(position: int, active_counters: int, avg_service_time_seconds: float) -> float:
    if position <= 0:
        return 0.0
    counters = max(active_counters, 1)  # never divide by zero if no counter is staffed yet
    turns_ahead = position / counters
    return turns_ahead * avg_service_time_seconds


def update_rolling_average(current_avg: float, completed_count: int, new_sample_seconds: float) -> float:
    """
    Incremental mean: avg_{n+1} = avg_n + (sample - avg_n) / (n + 1).
    Avoids storing every past sample just to recompute an average, and
    each new completed ticket nudges the estimate rather than recomputing
    from scratch over the whole history every time.
    """
    n = completed_count + 1
    return current_avg + (new_sample_seconds - current_avg) / n
