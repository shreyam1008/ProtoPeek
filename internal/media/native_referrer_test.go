package media

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestNativeDownloadNeverDisclosesPageReferrer(t *testing.T) {
	for _, mode := range []string{"same-origin", "cross-origin", "cross-origin-redirect"} {
		t.Run(mode, func(t *testing.T) {
			s := testService(t)
			referrers := make(chan string, 10)
			destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				referrers <- r.Header.Get("Referer")
				w.Header().Set("Content-Type", "image/png")
				io.WriteString(w, "fixture-image")
			}))
			defer destination.Close()
			page := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				referrers <- r.Header.Get("Referer")
				switch r.URL.Path {
				case "/page":
					mediaURL := "/image.png"
					if mode == "cross-origin" {
						mediaURL = destination.URL + "/image.png"
					} else if mode == "cross-origin-redirect" {
						mediaURL = "/redirect?credential=media-secret"
					}
					w.Header().Set("Content-Type", "text/html")
					fmt.Fprintf(w, `<img src=%q>`, mediaURL)
				case "/redirect":
					http.Redirect(w, r, destination.URL+"/image.png", http.StatusFound)
				default:
					w.Header().Set("Content-Type", "image/png")
					io.WriteString(w, "fixture-image")
				}
			}))
			defer page.Close()
			job, err := s.Add(Request{URL: page.URL + "/page?token=page-secret", Engine: "native-go", Format: "images", Directory: t.TempDir(), Start: 1, End: 1})
			if err != nil {
				t.Fatal(err)
			}
			done := awaitJob(t, s, job.ID, "completed")
			matches, err := filepath.Glob(filepath.Join(done.Directory, "001.*"))
			if err != nil || len(matches) != 1 {
				t.Fatalf("missing downloaded fixture: %v %v", matches, err)
			}
			if data, err := os.ReadFile(matches[0]); err != nil || string(data) != "fixture-image" {
				t.Fatalf("wrong downloaded fixture: %q %v", data, err)
			}
			close(referrers)
			for header := range referrers {
				if header != "" {
					t.Fatalf("source URL disclosed in Referer: %q", header)
				}
			}
		})
	}
}

func TestNativeRedirectNeverSendsReferrerOnTLSDowngrade(t *testing.T) {
	observed := make(chan string, 1)
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		observed <- r.Header.Get("Referer")
		io.WriteString(w, "fixture")
	}))
	defer destination.Close()
	source := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination.URL+"/image", http.StatusFound)
	}))
	defer source.Close()
	client := mediaHTTP()
	client.Transport = source.Client().Transport
	response, err := client.Get(source.URL + "/private/page?token=secret")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if data, err := io.ReadAll(response.Body); err != nil || string(data) != "fixture" {
		t.Fatalf("redirect fixture failed: %q %v", data, err)
	}
	if header := <-observed; header != "" {
		t.Fatalf("TLS source disclosed to HTTP destination: %q", header)
	}
}
