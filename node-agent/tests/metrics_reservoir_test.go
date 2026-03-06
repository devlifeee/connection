package tests

import (
	"testing"
	m "github.com/nhex-team/connection/node-agent/internal/metrics"
)

func TestReservoirPercentiles(t *testing.T) {
	r := m.NewReservoir(5)
	for _, v := range []int64{10, 20, 30, 40, 50} {
		r.Add(v)
	}
	if p50 := r.Percentile(0.5); p50 != 30 {
		t.Fatalf("p50=%d", p50)
	}
	if p95 := r.Percentile(0.95); p95 != 50 {
		t.Fatalf("p95=%d", p95)
	}
}
