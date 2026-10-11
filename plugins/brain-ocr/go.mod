// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Fady Mondy. Licensed under the GNU AGPL-3.0; see LICENSE at the repo root.

module github.com/togo-framework/brain-ocr

go 1.26

require (
	github.com/togo-framework/brain v0.0.0
	github.com/togo-framework/togo v0.21.0
)

// Dev: resolve the sibling brain module locally (monorepo).
replace github.com/togo-framework/brain => ../brain
