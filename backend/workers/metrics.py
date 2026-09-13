"""Metrics and monitoring for parallel job execution.

Tracks performance, success rates, and provides insights for optimization.
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any


@dataclass
class JobMetrics:
    """Metrics for a single job execution."""
    job_id: str
    start_time: float = field(default_factory=time.monotonic)
    end_time: float | None = None
    total_nodes: int = 0
    completed_nodes: int = 0
    failed_nodes: int = 0
    skipped_nodes: int = 0
    node_metrics: dict[str, dict[str, Any]] = field(default_factory=dict)
    
    @property
    def duration(self) -> float:
        if self.end_time is None:
            return time.monotonic() - self.start_time
        return self.end_time - self.start_time
    
    @property
    def success_rate(self) -> float:
        if self.total_nodes == 0:
            return 0.0
        return self.completed_nodes / self.total_nodes
    
    @property
    def throughput(self) -> float:
        """Nodes completed per second."""
        if self.duration == 0:
            return 0.0
        return self.completed_nodes / self.duration
    
    def record_node(self, node_id: str, status: str, duration: float, **kwargs: Any) -> None:
        """Record metrics for a completed node."""
        self.node_metrics[node_id] = {
            "status": status,
            "duration": duration,
            **kwargs,
        }
        
        if status == "ok":
            self.completed_nodes += 1
        elif status == "failed":
            self.failed_nodes += 1
        elif status == "skipped":
            self.skipped_nodes += 1
    
    def finish(self) -> None:
        """Mark the job as finished."""
        self.end_time = time.monotonic()
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "duration": round(self.duration, 2),
            "total_nodes": self.total_nodes,
            "completed_nodes": self.completed_nodes,
            "failed_nodes": self.failed_nodes,
            "skipped_nodes": self.skipped_nodes,
            "success_rate": round(self.success_rate, 2),
            "throughput": round(self.throughput, 2),
            "node_metrics": self.node_metrics,
        }


class MetricsStore:
    """In-memory metrics store for tracking parallel job performance."""
    
    def __init__(self, max_jobs: int = 1000):
        self.max_jobs = max_jobs
        self._jobs: dict[str, JobMetrics] = {}
        self._task_stats: dict[str, dict[str, Any]] = defaultdict(lambda: {
            "count": 0,
            "total_duration": 0.0,
            "successes": 0,
            "failures": 0,
        })
    
    def start_job(self, job_id: str, total_nodes: int) -> JobMetrics:
        """Start tracking a new job."""
        metrics = JobMetrics(job_id=job_id, total_nodes=total_nodes)
        self._jobs[job_id] = metrics
        
        # Evict old jobs if at capacity
        if len(self._jobs) > self.max_jobs:
            oldest = min(self._jobs, key=lambda k: self._jobs[k].start_time)
            del self._jobs[oldest]
        
        return metrics
    
    def record_node(self, job_id: str, node_id: str, task: str, status: str, duration: float) -> None:
        """Record a node completion."""
        if job_id in self._jobs:
            self._jobs[job_id].record_node(node_id, status, duration, task=task)
        
        # Update task-level stats
        stats = self._task_stats[task]
        stats["count"] += 1
        stats["total_duration"] += duration
        if status == "ok":
            stats["successes"] += 1
        elif status == "failed":
            stats["failures"] += 1
    
    def finish_job(self, job_id: str) -> None:
        """Mark a job as finished."""
        if job_id in self._jobs:
            self._jobs[job_id].finish()
    
    def get_job_metrics(self, job_id: str) -> dict[str, Any] | None:
        """Get metrics for a specific job."""
        if job_id in self._jobs:
            return self._jobs[job_id].to_dict()
        return None
    
    def get_task_stats(self) -> dict[str, dict[str, Any]]:
        """Get aggregated statistics by task type."""
        result = {}
        for task, stats in self._task_stats.items():
            avg_duration = stats["total_duration"] / stats["count"] if stats["count"] > 0 else 0
            success_rate = stats["successes"] / stats["count"] if stats["count"] > 0 else 0
            result[task] = {
                "count": stats["count"],
                "avg_duration": round(avg_duration, 2),
                "success_rate": round(success_rate, 2),
            }
        return result
    
    def get_summary(self) -> dict[str, Any]:
        """Get overall summary metrics."""
        total_jobs = len(self._jobs)
        total_nodes = sum(m.total_nodes for m in self._jobs.values())
        total_completed = sum(m.completed_nodes for m in self._jobs.values())
        total_failed = sum(m.failed_nodes for m in self._jobs.values())
        
        return {
            "total_jobs": total_jobs,
            "total_nodes": total_nodes,
            "total_completed": total_completed,
            "total_failed": total_failed,
            "overall_success_rate": round(total_completed / total_nodes if total_nodes > 0 else 0, 2),
            "task_stats": self.get_task_stats(),
        }


# Global metrics store
_metrics_store: MetricsStore | None = None


def get_metrics_store() -> MetricsStore:
    """Get the global metrics store."""
    global _metrics_store
    if _metrics_store is None:
        _metrics_store = MetricsStore()
    return _metrics_store
