package cli

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/shreyam1008/ProtoPeek/internal/selfupdate"
)

func updateCommand(args []string, stdout, stderr io.Writer) int {
	f := flag.NewFlagSet("update", flag.ContinueOnError)
	f.SetOutput(stderr)
	check := f.Bool("check", false, "Check only; do not download or replace executables.")
	channel := f.String("channel", "", "Release channel: stable, nightly or edge (default: installed channel).")
	f.Usage = func() {
		fmt.Fprintln(stderr, "Usage: protopeek update [--check] [--channel stable|nightly|edge]\n       pp update [--check] [--channel stable|nightly|edge]\n\nDirect installs update both commands with SHA-256 verification. Managed installs\nshow their package-manager commands. Running servers keep their current version\nuntil restarted; wait for transfers to finish before stopping them.")
		f.PrintDefaults()
	}
	if err := f.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 2
	}
	if f.NArg() != 0 {
		f.Usage()
		return 2
	}
	if *channel != "" && *channel != "stable" && *channel != "edge" && *channel != "nightly" {
		fmt.Fprintln(stderr, "Channel must be stable, nightly or edge.")
		return 2
	}
	e := selfupdate.New(Version)
	i := e.Snapshot().Installation
	fmt.Fprintf(stdout, "ProtoPeek %s · %s/%s · %s installation\n", i.Version, i.OS, i.Arch, i.Manager)
	if !*check && !i.CanUpdate {
		fmt.Fprintln(stderr, i.Reason)
		for _, c := range i.Commands {
			fmt.Fprintln(stdout, c)
		}
		return 1
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	fmt.Fprintln(stdout, "Checking GitHub releases…")
	p, err := e.Check(ctx, *channel)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	fmt.Fprintf(stdout, "Latest %s: %s\n%s\n", p.Channel, p.Version, p.URL)
	if !p.Available {
		fmt.Fprintln(stdout, "Already up to date.")
		return 0
	}
	if *check {
		fmt.Fprintln(stdout, "Update available. Run this command without --check to install.")
		if !i.CanUpdate {
			fmt.Fprintln(stdout, i.Reason)
			for _, c := range i.Commands {
				fmt.Fprintln(stdout, c)
			}
		}
		return 0
	}
	if p.Channel != "stable" {
		fmt.Fprintf(stdout, "%s is a prerelease; it may be less stable. Source: %s\n", p.Channel, p.Revision)
	}
	fmt.Fprintln(stdout, "Downloading and verifying the archive. Ctrl+C cancels before installation.\nExisting servers continue running. Restart them after active transfers finish.")
	if err = e.Apply(ctx, p.ID); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	fmt.Fprintln(stdout, "Updated protopeek and its owned pp alias. Launch again to use the new version.")
	if notice := e.Snapshot().Notice; notice != "" {
		fmt.Fprintln(stdout, notice)
	}
	return 0
}
