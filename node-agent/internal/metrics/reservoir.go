package metrics

import (
	"sort"
	"sync"
	"math"
)

type Reservoir struct {
	mu   sync.Mutex
	win  int
	data []int64
}

func NewReservoir(window int) *Reservoir {
	if window <= 0 {
		window = 256
	}
	return &Reservoir{win: window, data: make([]int64, 0, window)}
}

func (r *Reservoir) Add(v int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.data) < r.win {
		r.data = append(r.data, v)
		return
	}
	copy(r.data, r.data[1:])
	r.data[len(r.data)-1] = v
}

func (r *Reservoir) Percentile(p float64) int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.data) == 0 {
		return 0
	}
	cp := make([]int64, len(r.data))
	copy(cp, r.data)
	sort.Slice(cp, func(i, j int) bool { return cp[i] < cp[j] })
	if p <= 0 {
		return cp[0]
	}
	if p >= 1 {
		return cp[len(cp)-1]
	}
	idx := int(math.Ceil(p*float64(len(cp))) - 1)
	if idx < 0 {
		idx = 0
	}
	if idx >= len(cp) {
		idx = len(cp) - 1
	}
	return cp[idx]
}
