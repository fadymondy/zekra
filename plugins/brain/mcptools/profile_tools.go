package mcptools

import "net/url"

// profileToolDefs manage a brain's profile (display name, description, colour,
// icon, default note category). The namespace id never changes. Images are
// uploaded from the console (multipart), not over MCP.
var profileToolDefs = []map[string]any{
	{
		"name": "brain_profile_get",
		"description": "A brain's profile/settings: display name, description, color (palette key or #hex), icon/emoji, " +
			"image and cover URLs, visibility, default note category. Returns defaults for a brain never configured, " +
			"plus `edit` = full | limited | none for the caller.",
		"inputSchema": obj(prop{"namespace": prop{"type": "string"}}, "namespace"),
	},
	{
		"name": "brain_profile_update",
		"description": "Update a brain's profile. Owners/admins may change every field; editors only description and color. " +
			"The namespace id is immutable (display_name is the rename). Omitted fields are unchanged; \"\" resets to the default.",
		"inputSchema": obj(prop{
			"namespace":             prop{"type": "string"},
			"display_name":          prop{"type": "string", "description": "shown name, max 80 chars"},
			"description":           prop{"type": "string", "description": "markdown-ish, max 2000 chars"},
			"color":                 prop{"type": "string", "description": "#rrggbb or a palette key (slate, red, orange, amber, lime, green, teal, cyan, blue, indigo, violet, pink)"},
			"icon":                  prop{"type": "string", "description": "an emoji or icon name, max 32 chars"},
			"visibility":            prop{"type": "string", "enum": []string{"private", "internal"}, "description": "advisory label; access is membership"},
			"default_note_category": prop{"type": "string", "description": "category new notes get when none is given"},
			"image_url":             prop{"type": "string", "description": "external http(s) avatar URL (\"\" removes)"},
			"cover_url":             prop{"type": "string", "description": "external http(s) cover URL (\"\" removes)"},
		}, "namespace"),
	},
}

func init() {
	graphToolDefs = append(graphToolDefs, profileToolDefs...)
	toolAccess["brain_profile_get"] = AccessRead
	toolAccess["brain_profile_update"] = AccessWrite
}

// callProfile dispatches the profile tools; ok=false for any other name.
func callProfile(name string, args map[string]any, patch func(string, map[string]any), get func(string, url.Values)) bool {
	switch name {
	case "brain_profile_get":
		get("/api/brain/profile", url.Values{"namespace": {str(args["namespace"])}})
	case "brain_profile_update":
		patch("/api/brain/profile", map[string]any{
			"namespace": args["namespace"], "displayName": args["display_name"], "description": args["description"],
			"color": args["color"], "icon": args["icon"], "visibility": args["visibility"],
			"defaultNoteCategory": args["default_note_category"], "imageUrl": args["image_url"], "coverUrl": args["cover_url"],
		})
	default:
		return false
	}
	return true
}
