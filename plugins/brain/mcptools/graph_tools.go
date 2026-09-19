package mcptools

import "net/url"

// graphToolDefs are the notes-graph tools. Names mirror fadymondy.com's
// (note_related, notes_graph_*) so agents move between the two unchanged.
var graphToolDefs = []map[string]any{
	{
		"name": "note_related",
		"description": "What a note is connected to in the brain graph: the entities it links/tags, the other notes " +
			"that name the same things, and the typed edges around them.",
		"inputSchema": obj(prop{"id": prop{"type": "string", "description": "note id"}}, "id"),
	},
	{
		"name":        "notes_graph_ontology",
		"description": "A brain's graph vocabulary: entity types and edge types (relations), with how many use each.",
		"inputSchema": obj(prop{"namespace": prop{"type": "string"}}, "namespace"),
	},
	{
		"name": "notes_graph_neighbors",
		"description": "The live edges around one entity (both directions). `entity` is an entity id, a note id, " +
			"or a name (then namespace is required).",
		"inputSchema": obj(prop{
			"namespace": prop{"type": "string", "description": "needed when entity is a name"},
			"entity":    prop{"type": "string"},
			"relations": prop{"type": "array", "items": prop{"type": "string"}, "description": "only these relations"},
			"limit":     prop{"type": "integer", "description": "default 200, max 500"},
		}, "entity"),
	},
	{
		"name":        "notes_graph_path",
		"description": "Shortest path between two entities (ids, note ids or names) over live edges: how are they related?",
		"inputSchema": obj(prop{
			"namespace": prop{"type": "string", "description": "needed when from/to are names"},
			"from":      prop{"type": "string"},
			"to":        prop{"type": "string"},
			"max_depth": prop{"type": "integer", "description": "default 4, max 6"},
		}, "from", "to"),
	},
	{
		"name":        "entity_get",
		"description": "One graph entity: its type, summary, note id (if it is a note), live edges and up to 20 linked memories.",
		"inputSchema": obj(prop{"id": prop{"type": "string"}}, "id"),
	},
	{
		"name":        "entity_create",
		"description": "Add a node to a brain's graph. entity_type must exist in the ontology unless create_type is true.",
		"inputSchema": obj(prop{
			"namespace":   prop{"type": "string"},
			"name":        prop{"type": "string"},
			"entity_type": prop{"type": "string", "description": "default concept"},
			"summary":     prop{"type": "string"},
			"create_type": prop{"type": "boolean"},
		}, "namespace", "name"),
	},
	{
		"name": "entity_update",
		"description": "Rename / retype / re-summarize an entity, or merge keys into its metadata. For a note's entity, " +
			"name and type change the note's title and category (a new note version).",
		"inputSchema": obj(prop{
			"id":          prop{"type": "string"},
			"name":        prop{"type": "string"},
			"entity_type": prop{"type": "string"},
			"summary":     prop{"type": "string"},
			"metadata":    prop{"type": "object"},
			"create_type": prop{"type": "boolean"},
		}, "id"),
	},
	{
		"name":        "edge_create",
		"description": "Draw a typed edge src → relation → dst between two entities. relation must exist unless create_type is true.",
		"inputSchema": obj(prop{
			"namespace":   prop{"type": "string"},
			"src_id":      prop{"type": "string"},
			"dst_id":      prop{"type": "string"},
			"relation":    prop{"type": "string"},
			"fact":        prop{"type": "string", "description": "the relationship as a sentence"},
			"weight":      prop{"type": "number"},
			"create_type": prop{"type": "boolean"},
		}, "namespace", "src_id", "dst_id", "relation"),
	},
	{
		"name": "edge_update",
		"description": "Change an edge's fact/weight in place, or retype it (the old edge is closed and a new one opened). " +
			"Edges derived from a note's [[wikilinks]] cannot be retyped; edit the note.",
		"inputSchema": obj(prop{
			"id":          prop{"type": "string"},
			"relation":    prop{"type": "string"},
			"fact":        prop{"type": "string"},
			"weight":      prop{"type": "number"},
			"create_type": prop{"type": "boolean"},
		}, "id"),
	},
	{
		"name":        "edge_delete",
		"description": "Close an edge (it stays in history with valid_to set). Wikilink edges are removed by editing the note.",
		"inputSchema": obj(prop{"id": prop{"type": "string"}}, "id"),
	},
}

func init() {
	for k, v := range map[string]Access{
		"note_related": AccessRead, "notes_graph_ontology": AccessRead, "notes_graph_neighbors": AccessRead,
		"notes_graph_path": AccessRead, "entity_get": AccessRead,
		"entity_create": AccessWrite, "entity_update": AccessWrite,
		"edge_create": AccessWrite, "edge_update": AccessWrite, "edge_delete": AccessWrite,
	} {
		toolAccess[k] = v
	}
}

// callGraph dispatches the graph tools; ok=false for any other name.
func callGraph(name string, args map[string]any, post, patch func(string, map[string]any), get func(string, url.Values), del func(string)) bool {
	id := url.PathEscape(str(args["id"]))
	switch name {
	case "note_related":
		get("/api/notes/"+id+"/related", nil)
	case "notes_graph_ontology":
		get("/api/brain/ontology", url.Values{"namespace": {str(args["namespace"])}})
	case "notes_graph_neighbors":
		post("/api/brain/entities/neighbors", map[string]any{"namespace": args["namespace"], "entity": args["entity"],
			"relations": args["relations"], "limit": args["limit"]})
	case "notes_graph_path":
		post("/api/brain/entities/path", map[string]any{"namespace": args["namespace"], "from": args["from"],
			"to": args["to"], "max_depth": args["max_depth"]})
	case "entity_get":
		get("/api/brain/entities/"+id, nil)
	case "entity_create":
		post("/api/brain/entities", map[string]any{"namespace": args["namespace"], "name": args["name"],
			"entity_type": args["entity_type"], "summary": args["summary"], "create_type": args["create_type"]})
	case "entity_update":
		patch("/api/brain/entities/"+id, map[string]any{"name": args["name"], "entity_type": args["entity_type"],
			"summary": args["summary"], "metadata": args["metadata"], "create_type": args["create_type"]})
	case "edge_create":
		post("/api/brain/edges", map[string]any{"namespace": args["namespace"], "src_id": args["src_id"],
			"dst_id": args["dst_id"], "relation": args["relation"], "fact": args["fact"], "weight": args["weight"],
			"create_type": args["create_type"]})
	case "edge_update":
		patch("/api/brain/edges/"+id, map[string]any{"relation": args["relation"], "fact": args["fact"],
			"weight": args["weight"], "create_type": args["create_type"]})
	case "edge_delete":
		del("/api/brain/edges/" + id)
	default:
		return false
	}
	return true
}
