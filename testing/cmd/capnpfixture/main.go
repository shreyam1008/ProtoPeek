package main

import (
	"flag"
	"log"
	"net"

	"github.com/shreyam1008/ProtoPeek/testing/capnpfixture"
)

func main() {
	address := flag.String("listen", "127.0.0.1:43115", "local QA listener")
	flag.Parse()
	listener, err := net.Listen("tcp", *address)
	if err != nil {
		log.Fatal(err)
	}
	defer listener.Close()
	log.Printf("Cap'n Proto QA peer on %s", listener.Addr())
	for {
		socket, err := listener.Accept()
		if err != nil {
			log.Fatal(err)
		}
		go capnpfixture.ServeConnection(socket)
	}
}
