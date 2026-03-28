package app

import "embed"

//go:embed all:dist
var embedded embed.FS

func Files() embed.FS {
	return embedded
}
