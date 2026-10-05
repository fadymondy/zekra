module github.com/togo-framework/brain-ocr

go 1.26

require (
	github.com/togo-framework/brain v0.0.0
	github.com/togo-framework/togo v0.21.0
)

// Dev: resolve the sibling brain module locally (monorepo).
replace github.com/togo-framework/brain => ../brain
