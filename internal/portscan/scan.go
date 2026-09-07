// Package portscan performs bounded TCP connect scans of one explicitly selected host.
package portscan

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/targetguard"
)

const MaxPorts = 1024

type Request struct {
	Host      string `json:"host"`
	Ports     string `json:"ports"`
	TimeoutMS int    `json:"timeoutMs"`
	Family    string `json:"family"`
}
type Result struct {
	Port       int    `json:"port"`
	State      string `json:"state"`
	DurationMS int64  `json:"durationMs"`
}
type Response struct {
	Host       string   `json:"host"`
	Address    string   `json:"address"`
	Results    []Result `json:"results"`
	DurationMS int64    `json:"durationMs"`
	Complete   bool     `json:"complete"`
}
type Resolver interface {
	LookupNetIP(context.Context, string, string) ([]netip.Addr, error)
}
type Dial func(context.Context, string, string) (net.Conn, error)
type Scanner struct {
	Resolver Resolver
	Dial     Dial
}

var ErrInvalid = errors.New("invalid port scan")

func ParsePorts(input string) ([]int, error) {
	if len(input) > 8192 || strings.TrimSpace(input) == "" {
		return nil, fmt.Errorf("%w: enter ports or ranges, such as 80,443,8000-8010", ErrInvalid)
	}
	unique := make(map[int]bool)
	for _, item := range strings.Split(input, ",") {
		bounds := strings.Split(strings.TrimSpace(item), "-")
		if len(bounds) > 2 {
			return nil, fmt.Errorf("%w: malformed port range", ErrInvalid)
		}
		first, err := strconv.Atoi(strings.TrimSpace(bounds[0]))
		if err != nil || first < 1 || first > 65535 {
			return nil, fmt.Errorf("%w: ports must be 1–65535", ErrInvalid)
		}
		last := first
		if len(bounds) == 2 {
			last, err = strconv.Atoi(strings.TrimSpace(bounds[1]))
			if err != nil || last < first || last > 65535 {
				return nil, fmt.Errorf("%w: invalid range", ErrInvalid)
			}
		}
		if last-first+1 > MaxPorts {
			return nil, fmt.Errorf("%w: choose at most %d ports per scan", ErrInvalid, MaxPorts)
		}
		for port := first; port <= last; port++ {
			unique[port] = true
			if len(unique) > MaxPorts {
				return nil, fmt.Errorf("%w: choose at most %d ports per scan", ErrInvalid, MaxPorts)
			}
		}
	}
	ports := make([]int, 0, len(unique))
	for port := range unique {
		ports = append(ports, port)
	}
	slices.Sort(ports)
	return ports, nil
}

func (scanner Scanner) Scan(parent context.Context, input Request) (Response, error) {
	start := time.Now()
	host, err := targetguard.NormalizeHostname(input.Host)
	if err != nil {
		return Response{}, fmt.Errorf("%w: enter a hostname or IP without a URL, port or subnet", ErrInvalid)
	}
	ports, err := ParsePorts(input.Ports)
	if err != nil {
		return Response{}, err
	}
	if input.TimeoutMS < 100 || input.TimeoutMS > 2000 {
		return Response{}, fmt.Errorf("%w: timeout must be 100–2000 ms", ErrInvalid)
	}
	if input.Family != "auto" && input.Family != "ipv4" && input.Family != "ipv6" {
		return Response{}, fmt.Errorf("%w: invalid IP family", ErrInvalid)
	}
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return Response{}, err
	}
	network := "ip"
	if input.Family == "ipv4" {
		network = "ip4"
	}
	if input.Family == "ipv6" {
		network = "ip6"
	}
	resolver := scanner.Resolver
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	resolveCtx, resolveCancel := context.WithTimeout(ctx, 2*time.Second)
	addresses, err := resolver.LookupNetIP(resolveCtx, network, host)
	resolveCancel()
	if err != nil {
		return Response{}, fmt.Errorf("resolve target: %w", err)
	}
	if len(addresses) > 32 {
		return Response{}, fmt.Errorf("%w: target resolved to too many addresses", ErrInvalid)
	}
	var address netip.Addr
	for _, candidate := range addresses {
		candidate = candidate.Unmap()
		if candidate.Zone() != "" || (!candidate.IsGlobalUnicast() && !candidate.IsLoopback()) {
			continue
		}
		if (input.Family == "ipv4" && !candidate.Is4()) || (input.Family == "ipv6" && !candidate.Is6()) {
			continue
		}
		// Auto prefers IPv4 when available; the selected address is returned explicitly.
		if !address.IsValid() || (input.Family == "auto" && candidate.Is4() && !address.Is4()) {
			address = candidate
		}
	}
	if !address.IsValid() {
		return Response{}, fmt.Errorf("%w: no usable unicast address for the selected family", ErrInvalid)
	}
	response := Response{Host: host, Address: address.String(), Results: make([]Result, len(ports))}
	for i, port := range ports {
		response.Results[i] = Result{Port: port, State: "not-scanned"}
	}
	dial := scanner.Dial
	if dial == nil {
		dialer := &net.Dialer{}
		dial = dialer.DialContext
	}
	jobs := make(chan int)
	var workers sync.WaitGroup
	for range min(32, len(ports)) {
		workers.Go(func() {
			for index := range jobs {
				if ctx.Err() != nil {
					continue
				}
				probeCtx, probeCancel := context.WithTimeout(ctx, time.Duration(input.TimeoutMS)*time.Millisecond)
				sent := time.Now()
				conn, err := dial(probeCtx, "tcp", net.JoinHostPort(address.String(), strconv.Itoa(ports[index])))
				elapsed := time.Since(sent).Milliseconds()
				probeCancel()
				if conn != nil {
					_ = conn.Close()
				}
				state := "unreachable"
				if err == nil {
					state = "open"
				} else if ctx.Err() != nil {
					state = "not-scanned"
				} else if errors.Is(err, syscall.ECONNREFUSED) || platformConnectionRefused(err) {
					state = "closed"
				} else {
					var networkError net.Error
					if errors.As(err, &networkError) && networkError.Timeout() {
						state = "no-response"
					}
				}
				response.Results[index] = Result{Port: ports[index], State: state, DurationMS: elapsed}
			}
		})
	}
	for i := range ports {
		select {
		case jobs <- i:
		case <-ctx.Done():
		}
	}
	close(jobs)
	workers.Wait()
	response.DurationMS = time.Since(start).Milliseconds()
	response.Complete = ctx.Err() == nil
	if parent.Err() != nil {
		return response, parent.Err()
	}
	return response, nil
}
