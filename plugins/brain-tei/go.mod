// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Fady Mondy. Licensed under the GNU AGPL-3.0; see LICENSE at the repo root.

module github.com/togo-framework/brain-tei

go 1.26

require (
	github.com/togo-framework/brain v0.0.0
	github.com/togo-framework/togo v0.21.0
)

require github.com/go-chi/chi/v5 v5.3.0 // indirect

// Dev: resolve the sibling brain module locally (monorepo). Removed when consuming
// the published github.com/togo-framework/brain.
replace github.com/togo-framework/brain => ../brain
