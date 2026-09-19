package mcptools

// noteToolDefs are the note tools (Phase 1). Notes are markdown documents in a
// brain; saving one indexes it into the brain's memories, so memory_recall finds
// note content too.
var noteToolDefs = []map[string]any{
	{
		"name": "note_create",
		"description": "Create a markdown note in a brain. The note is chunked and indexed into the brain's " +
			"memories (source_kind=note), so memory_recall finds it. Returns the note with its id and version.",
		"inputSchema": obj(prop{
			"namespace": prop{"type": "string", "description": "the brain to create the note in"},
			"title":     prop{"type": "string"},
			"body":      prop{"type": "string", "description": "markdown"},
			"tags":      prop{"type": "array", "items": prop{"type": "string"}},
			"pinned":    prop{"type": "boolean"},
		}, "namespace", "title"),
	},
	{
		"name": "note_update",
		"description": "Update a note: any of title, body (replaces the whole body), tags, pinned, archived. " +
			"Pass the version you read to avoid overwriting someone else's edit (a mismatch returns the current copy).",
		"inputSchema": obj(prop{
			"id":       prop{"type": "string"},
			"title":    prop{"type": "string"},
			"body":     prop{"type": "string", "description": "markdown; replaces the body"},
			"tags":     prop{"type": "array", "items": prop{"type": "string"}},
			"pinned":   prop{"type": "boolean"},
			"archived": prop{"type": "boolean"},
			"version":  prop{"type": "integer", "description": "optional optimistic-concurrency check"},
		}, "id"),
	},
	{
		"name":        "note_append",
		"description": "Append markdown to the end of a note (as a new paragraph). Safer than note_update for adding to a running log.",
		"inputSchema": obj(prop{
			"id":   prop{"type": "string"},
			"text": prop{"type": "string", "description": "markdown to append"},
		}, "id", "text"),
	},
	{
		"name":        "note_get",
		"description": "Fetch one note by id, with its full markdown body, tags and version.",
		"inputSchema": obj(prop{"id": prop{"type": "string"}}, "id"),
	},
	{
		"name": "note_search",
		"description": "Find notes whose title or body contains the query text (optionally in one brain / with a tag). " +
			"For meaning-based search across notes and every other memory, use memory_recall.",
		"inputSchema": obj(prop{
			"query":     prop{"type": "string"},
			"namespace": prop{"type": "string", "description": "optional; default = every brain you can read"},
			"tag":       prop{"type": "string"},
			"limit":     prop{"type": "integer", "description": "default 20, max 200"},
		}, "query"),
	},
	{
		"name":        "note_list",
		"description": "List notes, newest first (pinned first). Paginate with the returned nextCursor.",
		"inputSchema": obj(prop{
			"namespace": prop{"type": "string", "description": "optional; default = every brain you can read"},
			"tag":       prop{"type": "string"},
			"archived":  prop{"type": "boolean", "description": "include archived notes"},
			"limit":     prop{"type": "integer", "description": "default 50, max 200"},
			"cursor":    prop{"type": "string"},
		}),
	},
	{
		"name":        "note_delete",
		"description": "Delete a note. It is tombstoned (restorable from the console) and its memories are invalidated, never hard-deleted.",
		"inputSchema": obj(prop{"id": prop{"type": "string"}}, "id"),
	},
}
