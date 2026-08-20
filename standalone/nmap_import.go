package standalone

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"unicode"
)

const (
	maxNmapXMLBytes                 = 8 << 20
	maxNmapXMLDepth                 = 32
	maxNmapXMLTokens                = 250000
	maxNmapXMLStartElements         = 100000
	maxNmapXMLAttributesPerElement  = 512
	maxNmapXMLAttributeElementBytes = 1 << 20
	maxNmapHosts                    = 1024
	maxNmapPorts                    = 16384
	maxNmapHostAddresses            = 8
	maxNmapHostnames                = 16
	maxNmapHostnameBytes            = 253
	maxNmapRetainedAttributeBytes   = 512
)

// NmapImportResponse contains only bounded, non-persisted host and port
// evidence. Command arguments, scripts, OS guesses, and traces are discarded.
type NmapImportResponse struct {
	Hosts      []NmapHost `json:"hosts"`
	HostCount  int        `json:"hostCount"`
	PortCount  int        `json:"portCount"`
	Complete   bool       `json:"complete"`
	Completion string     `json:"completion"`
}

type NmapHost struct {
	ID        int            `json:"id"`
	Status    NmapHostStatus `json:"status"`
	Addresses []NmapAddress  `json:"addresses"`
	Hostnames []NmapHostname `json:"hostnames"`
	Ports     []NmapPort     `json:"ports"`
}

type NmapHostStatus struct {
	State  string `json:"state"`
	Reason string `json:"reason"`
}

type NmapAddress struct {
	Address string `json:"address"`
	Type    string `json:"type"`
	Vendor  string `json:"vendor"`
}

type NmapHostname struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type NmapPort struct {
	Port     int         `json:"port"`
	Protocol string      `json:"protocol"`
	State    string      `json:"state"`
	Reason   string      `json:"reason"`
	Service  NmapService `json:"service"`
}

type NmapService struct {
	Name       string `json:"name"`
	Product    string `json:"product"`
	Version    string `json:"version"`
	ExtraInfo  string `json:"extrainfo"`
	Tunnel     string `json:"tunnel"`
	Method     string `json:"method"`
	Confidence string `json:"confidence"`
}

// NmapImportHandler returns the streaming POST /api/nmap/import endpoint. The
// caller must enforce ProtoPeek's local-access and CSRF policy.
func NmapImportHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		contentType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || !strings.EqualFold(contentType, "application/xml") {
			http.Error(w, "Request must use application/xml", http.StatusUnsupportedMediaType)
			return
		}
		if r.ContentLength > maxNmapXMLBytes {
			http.Error(w, "Nmap XML body is too large", http.StatusRequestEntityTooLarge)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxNmapXMLBytes)
		result, err := parseNmapXML(r.Context(), r.Body)
		if err != nil {
			var maxBytesError *http.MaxBytesError
			switch {
			case errors.As(err, &maxBytesError):
				http.Error(w, "Nmap XML body is too large", http.StatusRequestEntityTooLarge)
			case errors.Is(err, context.Canceled):
				http.Error(w, "Nmap XML import cancelled", 499)
			default:
				http.Error(w, "Invalid Nmap XML: "+err.Error(), http.StatusBadRequest)
			}
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(result)
	}
}

func parseNmapXML(ctx context.Context, reader io.Reader) (NmapImportResponse, error) {
	response := NmapImportResponse{Hosts: make([]NmapHost, 0), Completion: "missing"}
	decoder := xml.NewDecoder(reader)
	decoder.Strict = true
	decoder.Entity = nil
	decoder.CharsetReader = nil
	path := make([]xml.Name, 0, 8)
	seenRoot := false
	closedRoot := false
	seenDoctype := false
	seenFinished := false
	tokenCount := 0
	startElementCount := 0
	var host *NmapHost
	var port *NmapPort

	for {
		if err := ctx.Err(); err != nil {
			return response, err
		}
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return response, err
		}
		tokenCount++
		if tokenCount > maxNmapXMLTokens {
			return response, fmt.Errorf("XML token count exceeds %d", maxNmapXMLTokens)
		}

		switch value := token.(type) {
		case xml.Directive:
			if seenRoot || seenDoctype || strings.TrimSpace(string(value)) != "DOCTYPE nmaprun" {
				return response, fmt.Errorf("only one bare DOCTYPE nmaprun is allowed before the root")
			}
			seenDoctype = true
		case xml.StartElement:
			if closedRoot {
				return response, fmt.Errorf("content appears after the nmaprun root")
			}
			startElementCount++
			if startElementCount > maxNmapXMLStartElements {
				return response, fmt.Errorf("XML start-element count exceeds %d", maxNmapXMLStartElements)
			}
			if err := validateNmapElementAttributes(value.Attr); err != nil {
				return response, err
			}
			path = append(path, value.Name)
			if len(path) > maxNmapXMLDepth {
				return response, fmt.Errorf("XML depth exceeds %d", maxNmapXMLDepth)
			}
			if !seenRoot {
				if len(path) != 1 || value.Name.Space != "" || value.Name.Local != "nmaprun" {
					return response, fmt.Errorf("root element must be nmaprun")
				}
				var scanner string
				if err := assignAttributes(value.Attr, attributeTarget("scanner", &scanner)); err != nil {
					return response, err
				}
				if scanner != "nmap" {
					return response, fmt.Errorf("nmaprun root must declare scanner=\"nmap\"")
				}
				seenRoot = true
				continue
			}

			switch {
			case pathMatches(path, "nmaprun", "host"):
				if host != nil {
					return response, fmt.Errorf("nested host elements are not allowed")
				}
				if response.HostCount == maxNmapHosts {
					return response, fmt.Errorf("host count exceeds %d", maxNmapHosts)
				}
				host = &NmapHost{
					ID:        response.HostCount + 1,
					Addresses: make([]NmapAddress, 0),
					Hostnames: make([]NmapHostname, 0),
					Ports:     make([]NmapPort, 0),
				}
				response.HostCount++
			case host != nil && pathMatches(path, "nmaprun", "host", "status"):
				if err := assignAttributes(value.Attr,
					attributeTarget("state", &host.Status.State),
					attributeTarget("reason", &host.Status.Reason),
				); err != nil {
					return response, err
				}
			case host != nil && pathMatches(path, "nmaprun", "host", "address"):
				if len(host.Addresses) == maxNmapHostAddresses {
					return response, fmt.Errorf("host address count exceeds %d", maxNmapHostAddresses)
				}
				address := NmapAddress{}
				if err := assignAttributes(value.Attr,
					attributeTarget("addr", &address.Address),
					attributeTarget("addrtype", &address.Type),
					attributeTarget("vendor", &address.Vendor),
				); err != nil {
					return response, err
				}
				if err := validateNmapAddress(&address); err != nil {
					return response, err
				}
				host.Addresses = append(host.Addresses, address)
			case host != nil && pathMatches(path, "nmaprun", "host", "hostnames", "hostname"):
				if len(host.Hostnames) == maxNmapHostnames {
					return response, fmt.Errorf("host hostname count exceeds %d", maxNmapHostnames)
				}
				hostname := NmapHostname{}
				if err := assignAttributes(value.Attr,
					attributeTarget("name", &hostname.Name),
					attributeTarget("type", &hostname.Type),
				); err != nil {
					return response, err
				}
				if len(hostname.Name) > maxNmapHostnameBytes {
					return response, fmt.Errorf("hostname exceeds %d bytes", maxNmapHostnameBytes)
				}
				host.Hostnames = append(host.Hostnames, hostname)
			case host != nil && pathMatches(path, "nmaprun", "host", "ports", "port"):
				if port != nil {
					return response, fmt.Errorf("nested port elements are not allowed")
				}
				if response.PortCount == maxNmapPorts {
					return response, fmt.Errorf("port count exceeds %d", maxNmapPorts)
				}
				var portValue, protocol string
				if err := assignAttributes(value.Attr,
					attributeTarget("portid", &portValue),
					attributeTarget("protocol", &protocol),
				); err != nil {
					return response, err
				}
				protocol = strings.ToLower(protocol)
				switch protocol {
				case "tcp", "udp", "sctp", "ip":
				default:
					return response, fmt.Errorf("port protocol is invalid")
				}
				portNumber, err := strconv.Atoi(portValue)
				maximum := 65535
				if protocol == "ip" {
					maximum = 255
				}
				if err != nil || portNumber < 0 || portNumber > maximum {
					return response, fmt.Errorf("portid %q is invalid for protocol %q", portValue, protocol)
				}
				port = &NmapPort{Port: portNumber, Protocol: protocol}
				response.PortCount++
			case port != nil && pathMatches(path, "nmaprun", "host", "ports", "port", "state"):
				if err := assignAttributes(value.Attr,
					attributeTarget("state", &port.State),
					attributeTarget("reason", &port.Reason),
				); err != nil {
					return response, err
				}
			case port != nil && pathMatches(path, "nmaprun", "host", "ports", "port", "service"):
				if err := assignAttributes(value.Attr,
					attributeTarget("name", &port.Service.Name),
					attributeTarget("product", &port.Service.Product),
					attributeTarget("version", &port.Service.Version),
					attributeTarget("extrainfo", &port.Service.ExtraInfo),
					attributeTarget("tunnel", &port.Service.Tunnel),
					attributeTarget("method", &port.Service.Method),
					attributeTarget("conf", &port.Service.Confidence),
				); err != nil {
					return response, err
				}
			case pathMatches(path, "nmaprun", "runstats", "finished"):
				if seenFinished {
					return response, fmt.Errorf("duplicate runstats completion")
				}
				seenFinished = true
				if err := assignAttributes(value.Attr, attributeTarget("exit", &response.Completion)); err != nil {
					return response, err
				}
				if response.Completion == "" {
					response.Completion = "unknown"
				}
				response.Complete = response.Completion == "success"
			}
		case xml.EndElement:
			if len(path) == 0 || path[len(path)-1] != value.Name {
				return response, fmt.Errorf("unexpected closing element %s", value.Name.Local)
			}
			if pathMatches(path, "nmaprun", "host", "ports", "port") && port != nil {
				host.Ports = append(host.Ports, *port)
				port = nil
			} else if pathMatches(path, "nmaprun", "host") && host != nil {
				response.Hosts = append(response.Hosts, *host)
				host = nil
			} else if pathMatches(path, "nmaprun") {
				closedRoot = true
			}
			path = path[:len(path)-1]
		case xml.CharData:
			if len(path) == 0 && strings.TrimSpace(string(value)) != "" {
				return response, fmt.Errorf("text appears outside the nmaprun root")
			}
		}
	}
	if !seenRoot || !closedRoot {
		return response, fmt.Errorf("root element must be nmaprun")
	}
	if host != nil || port != nil || len(path) != 0 {
		return response, fmt.Errorf("Nmap XML ended before all elements closed")
	}
	return response, nil
}

type nmapAttributeTarget struct {
	name        string
	destination *string
}

func attributeTarget(name string, destination *string) nmapAttributeTarget {
	return nmapAttributeTarget{name: name, destination: destination}
}

func assignAttributes(attributes []xml.Attr, targets ...nmapAttributeTarget) error {
	seen := make(map[string]struct{}, len(targets))
	for _, attribute := range attributes {
		for _, target := range targets {
			if attribute.Name.Space != "" || attribute.Name.Local != target.name {
				continue
			}
			if _, exists := seen[target.name]; exists {
				return fmt.Errorf("attribute %s appears more than once", target.name)
			}
			seen[target.name] = struct{}{}
			if len(attribute.Value) > maxNmapRetainedAttributeBytes {
				return fmt.Errorf("attribute %s exceeds %d bytes", target.name, maxNmapRetainedAttributeBytes)
			}
			*target.destination = sanitizeNmapString(attribute.Value)
		}
	}
	return nil
}

func validateNmapElementAttributes(attributes []xml.Attr) error {
	if len(attributes) > maxNmapXMLAttributesPerElement {
		return fmt.Errorf("element attribute count exceeds %d", maxNmapXMLAttributesPerElement)
	}
	total := 0
	for _, attribute := range attributes {
		total += len(attribute.Name.Space) + len(attribute.Name.Local) + len(attribute.Value)
		if total > maxNmapXMLAttributeElementBytes {
			return fmt.Errorf("element attribute bytes exceed %d", maxNmapXMLAttributeElementBytes)
		}
	}
	return nil
}

func validateNmapAddress(address *NmapAddress) error {
	address.Type = strings.ToLower(address.Type)
	switch address.Type {
	case "ipv4", "ipv6":
		parsed, err := netip.ParseAddr(address.Address)
		if err != nil || parsed.Zone() != "" || address.Type == "ipv4" && !parsed.Is4() || address.Type == "ipv6" && (!parsed.Is6() || parsed.Is4In6()) {
			return fmt.Errorf("%s address is invalid", address.Type)
		}
		address.Address = parsed.Unmap().String()
	case "mac":
		parsed, err := net.ParseMAC(address.Address)
		if err != nil {
			return fmt.Errorf("MAC address is invalid")
		}
		address.Address = parsed.String()
	default:
		return fmt.Errorf("address type is invalid")
	}
	return nil
}

func sanitizeNmapString(value string) string {
	return strings.Map(func(char rune) rune {
		if unicode.IsControl(char) || char == '\u061c' || char == '\u200e' || char == '\u200f' || char >= '\u202a' && char <= '\u202e' || char >= '\u2066' && char <= '\u2069' {
			return -1
		}
		return char
	}, value)
}

func pathMatches(path []xml.Name, expected ...string) bool {
	if len(path) != len(expected) {
		return false
	}
	for index := range path {
		if path[index].Space != "" || path[index].Local != expected[index] {
			return false
		}
	}
	return true
}
