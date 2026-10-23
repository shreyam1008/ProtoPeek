package packetwork

import (
	"context"
	"fmt"
	"sort"
)

const MaxTCPFlows = 32
const MaxTCPSegments = 512
const MaxTCPFlowBytes = 64 << 10
const MaxTCPPayloadBytes = 256 << 10
const maxSequenceDistance = 1 << 20

type TCPSpan struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
}
type TCPSegment struct {
	Packet   int    `json:"packet"`
	Sequence uint32 `json:"sequence"`
	Offset   int64  `json:"offset"`
	Data     []byte `json:"data"`
}
type TCPDirection struct {
	Source            string       `json:"source"`
	Destination       string       `json:"destination"`
	StartObserved     bool         `json:"startObserved"`
	EndObserved       bool         `json:"endObserved"`
	SequenceAmbiguous bool         `json:"sequenceAmbiguous"`
	ConflictsLimited  bool         `json:"conflictsLimited"`
	Segments          []TCPSegment `json:"segments"`
	Gaps              []TCPSpan    `json:"gaps"`
	Conflicts         []TCPSpan    `json:"conflicts"`
	anchor            uint32
	anchored          bool
}
type TCPFlow struct {
	ID          string          `json:"id"`
	Section     int             `json:"section"`
	Interface   int             `json:"interface"`
	FirstPacket int             `json:"firstPacket"`
	LastPacket  int             `json:"lastPacket"`
	Directions  [2]TCPDirection `json:"directions"`
	Limited     bool            `json:"limited"`
	bytes       int
	closed      bool
	syn         uint32
	hasSyn      bool
}
type TCPReconstruction struct {
	Flows            []*TCPFlow `json:"flows"`
	RetainedBytes    int        `json:"retainedBytes"`
	Limited          bool       `json:"limited"`
	SkippedFragments int        `json:"skippedFragments"`
}
type tcpReconstructor struct {
	result   TCPReconstruction
	active   map[string]*TCPFlow
	segments int
}

func newTCPReconstructor() *tcpReconstructor {
	return &tcpReconstructor{result: TCPReconstruction{Flows: []*TCPFlow{}}, active: map[string]*TCPFlow{}}
}

func (r *tcpReconstructor) add(p Packet) {
	if p.fragmented {
		r.result.SkippedFragments++
		return
	}
	if p.TCP == nil {
		return
	}
	a, b := fmt.Sprintf("[%s]:%d", p.Source, p.SourcePort), fmt.Sprintf("[%s]:%d", p.Destination, p.DestinationPort)
	direction := 0
	if a > b {
		a, b, direction = b, a, 1
	}
	key := fmt.Sprintf("%d/%d/%s/%s", p.Section, p.Interface, a, b)
	flow := r.active[key]
	header := p.TCP
	syn := header.Flags&2 != 0 && header.Flags&16 == 0
	if flow == nil || (syn && (flow.closed || !flow.hasSyn || flow.syn != header.Sequence)) {
		if len(r.result.Flows) == MaxTCPFlows {
			r.result.Limited = true
			return
		}
		flow = &TCPFlow{ID: fmt.Sprintf("tcp-%d", len(r.result.Flows)+1), Section: p.Section, Interface: p.Interface, FirstPacket: p.Number,
			Directions: [2]TCPDirection{{Source: a, Destination: b, Segments: []TCPSegment{}, Gaps: []TCPSpan{}, Conflicts: []TCPSpan{}}, {Source: b, Destination: a, Segments: []TCPSegment{}, Gaps: []TCPSpan{}, Conflicts: []TCPSpan{}}}}
		r.active[key] = flow
		r.result.Flows = append(r.result.Flows, flow)
	}
	flow.LastPacket = p.Number
	if syn {
		flow.hasSyn, flow.syn = true, header.Sequence
	}
	d := &flow.Directions[direction]
	sequence := header.Sequence
	if header.Flags&2 != 0 {
		sequence++
		d.StartObserved = true
	}
	if header.Flags&1 != 0 {
		d.EndObserved = true
	}
	if header.Flags&4 != 0 {
		flow.closed = true
	}
	if flow.Directions[0].EndObserved && flow.Directions[1].EndObserved {
		flow.closed = true
	}
	if !d.anchored && (len(p.payload) > 0 || header.Flags&2 != 0) {
		d.anchor, d.anchored = sequence, true
	}
	if p.Truncated {
		flow.Limited = true
	}
	if len(p.payload) == 0 {
		return
	}
	// Signed sequence deltas handle wrap within a bounded window; do not guess at epochs.
	offset := int64(int32(sequence - d.anchor))
	if offset < -maxSequenceDistance || offset > maxSequenceDistance {
		d.SequenceAmbiguous, flow.Limited = true, true
		return
	}
	n := min(len(p.payload), MaxTCPFlowBytes-flow.bytes, MaxTCPPayloadBytes-r.result.RetainedBytes)
	if n < len(p.payload) || r.segments == MaxTCPSegments {
		flow.Limited, r.result.Limited = true, true
	}
	if n == 0 || r.segments == MaxTCPSegments {
		return
	}
	d.Segments = append(d.Segments, TCPSegment{Packet: p.Number, Sequence: sequence, Offset: offset, Data: append([]byte(nil), p.payload[:n]...)})
	flow.bytes += n
	r.result.RetainedBytes += n
	r.segments++
}

func appendSpan(spans []TCPSpan, start, end int64) []TCPSpan {
	if start >= end {
		return spans
	}
	if len(spans) > 0 && spans[len(spans)-1].End >= start {
		spans[len(spans)-1].End = max(spans[len(spans)-1].End, end)
		return spans
	}
	return append(spans, TCPSpan{Start: start, End: end})
}

func (r *tcpReconstructor) finish(ctx context.Context) (*TCPReconstruction, error) {
	for _, flow := range r.result.Flows {
		for i := range flow.Directions {
			d := &flow.Directions[i]
			sort.SliceStable(d.Segments, func(i, j int) bool { return d.Segments[i].Offset < d.Segments[j].Offset })
			if len(d.Segments) == 0 {
				continue
			}
			start := min(int64(0), d.Segments[0].Offset)
			end := int64(0)
			if !d.StartObserved {
				end = d.Segments[0].Offset
			}
			conflicts := map[int64]struct{}{}
			for j := range d.Segments {
				if err := ctx.Err(); err != nil {
					return nil, err
				}
				segment := &d.Segments[j]
				if segment.Offset > end {
					d.Gaps = appendSpan(d.Gaps, end-start, segment.Offset-start)
				}
				end = max(end, segment.Offset+int64(len(segment.Data)))
				for k := 0; k < j; k++ {
					other := d.Segments[k]
					lo, hi := max(segment.Offset, other.Offset), min(segment.Offset+int64(len(segment.Data)), other.Offset+int64(len(other.Data)))
					for pos := lo; pos < hi; pos++ {
						if segment.Data[pos-segment.Offset] != other.Data[pos-other.Offset] {
							conflicts[pos-start] = struct{}{}
						}
					}
				}
			}
			// Coalesce before serialization, bounding report metadata as well as retained bytes.
			positions := make([]int64, 0, len(conflicts))
			for pos := range conflicts {
				positions = append(positions, pos)
			}
			sort.Slice(positions, func(i, j int) bool { return positions[i] < positions[j] })
			for _, pos := range positions {
				if len(d.Conflicts) == 128 && pos > d.Conflicts[len(d.Conflicts)-1].End {
					d.ConflictsLimited, flow.Limited, r.result.Limited = true, true, true
					break
				}
				d.Conflicts = appendSpan(d.Conflicts, pos, pos+1)
			}
			for j := range d.Segments {
				d.Segments[j].Offset -= start
			}
		}
	}
	return &r.result, nil
}
