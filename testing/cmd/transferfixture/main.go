// transferfixture serves deterministic files without allocating them in memory.
// Local manual QA: go run ./testing/cmd/transferfixture
package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"
)

func main() {
	server := &http.Server{Addr: "127.0.0.1:43112", ReadHeaderTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if r.URL.Path != "/download.bin" && r.URL.Path != "/no-range.bin" {
			http.NotFound(w, r)
			return
		}
		mib, _ := strconv.ParseInt(r.URL.Query().Get("mib"), 10, 64)
		if mib < 1 || mib > 128 {
			mib = 32
		}
		size := mib << 20
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("ETag", fmt.Sprintf("\"protopeek-P-%d\"", size))
		reader := &repeatedByteReader{size: size}
		if r.URL.Path == "/no-range.bin" {
			w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
			w.Header().Set("Accept-Ranges", "none")
			if r.Method == http.MethodGet {
				_, _ = io.CopyN(w, reader, size)
			}
			return
		}
		http.ServeContent(w, r, "download.bin", time.Unix(1700000000, 0), reader)
	})}
	log.Println("Transfer fixture: http://127.0.0.1:43112/download.bin?mib=32 (byte P, 1..128 MiB); /no-range.bin ignores ranges")
	log.Fatal(server.ListenAndServe())
}

type repeatedByteReader struct{ size, position int64 }

func (r *repeatedByteReader) Read(buffer []byte) (int, error) {
	if r.position >= r.size {
		return 0, io.EOF
	}
	n := min(int64(len(buffer)), r.size-r.position)
	for i := int64(0); i < n; i++ {
		buffer[i] = 'P'
	}
	r.position += n
	return int(n), nil
}
func (r *repeatedByteReader) Seek(offset int64, whence int) (int64, error) {
	switch whence {
	case io.SeekCurrent:
		offset += r.position
	case io.SeekEnd:
		offset += r.size
	case io.SeekStart:
	default:
		return 0, fmt.Errorf("invalid seek origin")
	}
	if offset < 0 {
		return 0, fmt.Errorf("negative seek")
	}
	r.position = offset
	return offset, nil
}
