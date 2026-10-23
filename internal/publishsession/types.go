// Package publishsession owns temporary foreground publishing processes. It
// never adopts or stops existing services, accounts, or background rules.
package publishsession

import "time"

type Request struct {
	Mode    string `json:"mode"`
	Origin  string `json:"origin"`
	Port    uint16 `json:"port"`
	Minutes int    `json:"minutes"`
}
type OriginObservation struct {
	Connected  bool  `json:"connected"`
	DurationMs int64 `json:"durationMs"`
}
type Preview struct {
	Revision   string            `json:"revision"`
	ExpiresAt  time.Time         `json:"expiresAt"`
	Request    Request           `json:"request"`
	Audience   string            `json:"audience"`
	Executable string            `json:"executable"`
	Arguments  []string          `json:"arguments"`
	Origin     OriginObservation `json:"origin"`
	Notice     string            `json:"notice"`
}
type StartRequest struct {
	Revision  string `json:"revision"`
	Confirmed bool   `json:"confirmed"`
}
type Event struct {
	ObservedAt time.Time `json:"observedAt"`
	Message    string    `json:"message"`
}
type Session struct {
	ID                string            `json:"id"`
	Mode              string            `json:"mode"`
	Audience          string            `json:"audience"`
	OriginURL         string            `json:"originUrl"`
	Origin            OriginObservation `json:"origin"`
	Endpoint          string            `json:"endpoint"`
	EndpointVerified  bool              `json:"endpointVerified"`
	EndpointStatus    int               `json:"endpointStatus"`
	EndpointCheckedAt *time.Time        `json:"endpointCheckedAt"`
	EndpointError     string            `json:"endpointError"`
	State             string            `json:"state"`
	Reason            string            `json:"reason"`
	Cleanup           string            `json:"cleanup"`
	PID               int               `json:"pid"`
	StartedAt         time.Time         `json:"startedAt"`
	ExpiresAt         time.Time         `json:"expiresAt"`
	Events            []Event           `json:"events"`
}
type Snapshot struct {
	Session *Session `json:"session"`
}
