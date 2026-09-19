package brain

import (
	"os"
	"strings"
)

// Zekra was formerly CaBrain: honour the legacy CABRAIN_* env names so existing
// deployments and client configs keep working. A ZEKRA_* value always wins.
func init() {
	for _, kv := range os.Environ() {
		k, v, ok := strings.Cut(kv, "=")
		if !ok || !strings.HasPrefix(k, "CABRAIN_") {
			continue
		}
		nk := "ZEKRA_" + strings.TrimPrefix(k, "CABRAIN_")
		if _, set := os.LookupEnv(nk); !set {
			os.Setenv(nk, v)
		}
	}
}
