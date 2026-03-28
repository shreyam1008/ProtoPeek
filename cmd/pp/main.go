package main

import "github.com/shreyam1008/ProtoPeek/internal/cli"

var version = "dev build <no version set>"

func main() {
	cli.Version = version
	cli.Run()
}
