package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nhex-team/connection/node-agent/internal/runtime"
)

func main() {
	cfg := runtime.DefaultConfig()

	if host, err := os.Hostname(); err == nil {
		cfg.DisplayName = host
	}

	flag.StringVar(&cfg.DataDir, "data-dir", cfg.DataDir, "")
	flag.StringVar(&cfg.DisplayName, "name", cfg.DisplayName, "")
	flag.StringVar(&cfg.Version, "version", cfg.Version, "")
	flag.StringVar(&cfg.ServiceName, "service", cfg.ServiceName, "")
	flag.IntVar(&cfg.ListenPort, "p2p-port", cfg.ListenPort, "")
	flag.StringVar(&cfg.HTTPAddr, "http", cfg.HTTPAddr, "")
	flag.Parse()

	// Bootstrap peers from env NHEX_BOOTSTRAP=http://host:port[,http://host2:port]
	if v := os.Getenv("NHEX_BOOTSTRAP"); v != "" {
		var out []string
		cur := ""
		for _, ch := range v {
			if ch == ',' || ch == ';' || ch == ' ' {
				if cur != "" {
					out = append(out, cur)
					cur = ""
				}
				continue
			}
			cur += string(ch)
		}
		if cur != "" {
			out = append(out, cur)
		}
		cfg.BootstrapHTTP = out
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	rt, err := runtime.Start(ctx, cfg)
	if err != nil {
		fmt.Fprintln(os.Stderr, "node-agent: failed to start:", err)
		var ne *net.OpError
		if errors.As(err, &ne) {
			fmt.Fprintln(os.Stderr, "hint: try another http port, example: go run . -http 127.0.0.1:9877")
		}
		os.Exit(1)
	}

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = rt.Close(shutdownCtx)
}
