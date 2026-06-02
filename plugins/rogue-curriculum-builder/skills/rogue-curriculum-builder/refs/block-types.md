# Block Types Reference

## Rich Text Block

Type value: `"richText"` (use in the `type` field)

| Field | Type | Required | Default |
|-------|------|----------|---------|
| type | `"richText"` | Yes | — |
| slate | `SlateNode[]` | Yes | — |
| color | `string` | No | `"#ffffff"` |
| lineHeight | `number` | No | `1.5` |

### Slate Structure

The `slate` field is an array of Slate.js element nodes. Each element has a `type` and `children`.

**Element Types:**
- `heading-1`, `heading-2`, `heading-3` — Headings
- `body-1`, `body-2`, `body-3` — Body text (body-1 is default)
- `bulleted-list` — Unordered list container
- `numbered-list` — Ordered list container (has `listStyleType` and `startNumber`)
- `list-item` — List item (only inside list containers)

**Text Marks (combinable on any text node):**
- `bold: true` — Bold text
- `italic: true` — Italic text
- `underline: true` — Underlined text
- `strikethrough: true` — Strikethrough text
- `code: true` — Inline code
- `smallCaps: true` — Small caps
- `color: "#hex"` — Custom text color

### Examples

**Paragraph with bold:**
```json
{ "type": "body-1", "children": [
  { "text": "This is " },
  { "text": "bold text", "bold": true },
  { "text": " in a paragraph." }
]}
```

**Heading:**
```json
{ "type": "heading-1", "children": [{ "text": "Main Title" }] }
```

**Bulleted list:**
```json
{ "type": "bulleted-list", "children": [
  { "type": "list-item", "children": [{ "text": "First item" }] },
  { "type": "list-item", "children": [{ "text": "Second item" }] }
]}
```

**Numbered list:**
```json
{ "type": "numbered-list", "listStyleType": "decimal", "startNumber": 1, "children": [
  { "type": "list-item", "children": [{ "text": "Step one" }] },
  { "type": "list-item", "children": [{ "text": "Step two" }] }
]}
```

**Mixed formatting:**
```json
{ "type": "body-1", "children": [
  { "text": "Run " },
  { "text": "npm install", "code": true },
  { "text": " to install " },
  { "text": "all", "bold": true, "italic": true },
  { "text": " dependencies." }
]}
```

**Complete rich text block:**
```json
{
  "type": "richText",
  "color": "#ffffff",
  "lineHeight": 1.5,
  "slate": [
    { "type": "heading-1", "children": [{ "text": "Network Configuration" }] },
    { "type": "body-1", "children": [
      { "text": "Configure the network using " },
      { "text": "JSON", "code": true },
      { "text": " format:" }
    ]},
    { "type": "numbered-list", "listStyleType": "decimal", "startNumber": 1, "children": [
      { "type": "list-item", "children": [{ "text": "Set the IP address" }] },
      { "type": "list-item", "children": [{ "text": "Configure DNS" }] }
    ]}
  ]
}
```

## Code Block

Type value: `"code"`

| Field | Type | Required |
|-------|------|----------|
| type | `"code"` | Yes |
| codeLanguage | enum | Yes |
| code | `string` | Yes |

Languages: `JAVASCRIPT`, `PYTHON`, `JAVA`, `CSHARP`, `CPP`, `HTML`, `CSS`, `SQL`, `BASH`, `POWERSHELL`, `JSON`, `XML`, `YAML`

## Divider Block

Type value: `"divider"`

| Field | Type | Default |
|-------|------|---------|
| type | `"divider"` | — |
| color | `string` | `"#444444"` |
| thickness | `number` | `1` |

## Callout Block

Type value: `"callout"`

| Field | Type | Required |
|-------|------|----------|
| type | `"callout"` | Yes |
| variant | enum | Yes |
| title | `string` | Yes |
| content | `string` | Yes |

Variants: `DANGER`, `INFO`, `SUCCESS`, `WARNING`

## Image Block

Type value: `"image"`

| Field | Type | Required |
|-------|------|----------|
| type | `"image"` | Yes |
| imageId | `string` | Yes (from media library) |
| alt | `string` | No (default `""`) |
| caption | `string` | No (default `""`) |
| widthPct | `number` | No (default `100`) |
| alignment | enum | No |

Alignments: `LEFT`, `CENTER`, `RIGHT`

## Video Block

Type value: `"video"`

| Field | Type | Required |
|-------|------|----------|
| type | `"video"` | Yes |
| provider | `"bunny"` | Yes |
| videoId | `string` | Yes (from media library) |
| title | `string` | No |
| description | `string` | No |

## PDF Block

Type value: `"pdf"`

| Field | Type | Required |
|-------|------|----------|
| type | `"pdf"` | Yes |
| pdfId | `string` | Yes (from media library) |
| title | `string` | No |
| pageStart | `number` | No |
| pageEnd | `number` | No |
| allowDownloadForPageRange | `boolean` | No |
| allowDownloadForAllPages | `boolean` | No |

## File Download Block

Type value: `"fileDownload"`

| Field | Type | Required |
|-------|------|----------|
| type | `"fileDownload"` | Yes |
| files | `Array` | Yes |

`files` is `[{ mediaId: string, displayName?: string, caption?: string }]` — one or more downloadable artifacts the student should grab locally (config files, sample payloads, lab packets, scripts). Each entry references an existing item in the media library; pick IDs via `curriculum_search_media` / `curriculum_browse_media`, or upload net-new files with `curriculum_upload_media`.

## Question Block

Type value: `"question"`

| Field | Type | Required |
|-------|------|----------|
| type | `"question"` | Yes |
| questionNumber | `number` | Yes |
| questionText | `string` | Yes |
| questionType | enum | Yes |
| answers | `Array` | For MULTIPLE / MULTI_SELECT types |
| pairs | `Array` | For MATCHING |
| distractors | `string[]` | For MATCHING (optional noise values on right side) |
| items | `Array` | For ORDERING |
| image | `ImageRef` | For DIAGRAM_SELECTION |
| regions | `Array` | For DIAGRAM_SELECTION |
| showHotspots | `boolean` | For DIAGRAM_SELECTION (default `false`) |
| requireAnswer | `boolean` | No |

Question types: `SHORT`, `LONG`, `MULTIPLE`, `MULTI_SELECT`, `MATCHING`, `ORDERING`, `DIAGRAM_SELECTION`, `FILE_UPLOAD`

For MULTIPLE / MULTI_SELECT types, `answers` is: `[{ text: string, correct: boolean }]`.
- `MULTIPLE` enforces exactly one `correct: true`. Binary scoring.
- `MULTI_SELECT` allows one or more `correct: true`. Students earn partial credit via Jaccard similarity (`|chosen ∩ correct| / |chosen ∪ correct|`).

For MATCHING, `pairs` is: `[{ id: string, leftText: string, rightText: string }]`.
- Each pair links one left term to its right counterpart. Aim for 4–8 pairs.
- Students earn partial credit via `correctPairs / totalPairs`.
- Optional `distractors: string[]` — right-side noise values that match no left term. Students must reject them. Keep to ~2–3 max.

For ORDERING, `items` is: `[{ id: string, text: string }]`.
- Array order is the canonical correct order students must reproduce.
- Students earn partial credit via `correctPositions / totalPositions` (each item placed in its canonical slot counts).

For DIAGRAM_SELECTION, `image` is `{ kind: "inline", base64: string, mimeType: "image/png" | "image/jpeg" }` and `regions` is `[{ id: string, label: string, shape: "rect", coords: { x, y, w, h }, isCorrect: boolean }]`.
- The image must be PNG or JPEG, &le;500KB raw. SVG is rejected at every layer for security.
- Region `coords` are normalized to the 0..1 range.
- Students click the hotspots they think are correct. Grading uses Jaccard similarity on selected region IDs (`|chosen ∩ correct| / |chosen ∪ correct|`).
- `showHotspots: true` renders visible region outlines (pick-from-image mode, easier). Leave unset/false for blind hotspot hunting (harder).

### MULTI_SELECT example via `curriculum_manage_questions`

Use for "select all that apply" questions. Create the empty shell, then add each option separately:

```json
// 1. Create
{
  "chapterID": "abc-123",
  "action": "create",
  "questionType": "multi_select",
  "questionText": "Which of these are enumeration tools? (Select all that apply.)",
  "requireAnswer": true
}
// Returns: { questionID: "..." }

// 2. Add correct option
{
  "chapterID": "abc-123",
  "action": "addOption",
  "blockId": "...",
  "text": "BloodHound",
  "correct": true
}

// 3. Add incorrect option
{
  "chapterID": "abc-123",
  "action": "addOption",
  "blockId": "...",
  "text": "Rubeus",
  "correct": false
}

// 4. Repeat addOption for each option. At least one must have correct: true.
// Grading: Jaccard — |chosen ∩ correct| / |chosen ∪ correct|.
```

### MATCHING example via `curriculum_manage_questions`

Use when content pairs naturally (term/definition, tool/purpose). Create the empty shell, then add each pair separately:

```json
// 1. Create
{
  "chapterID": "abc-123",
  "action": "create",
  "questionType": "matching",
  "questionText": "Match each enumeration tool with what it primarily enumerates.",
  "requireAnswer": true
}
// Returns: { questionID: "..." }

// 2. Add a pair
{
  "chapterID": "abc-123",
  "action": "addPair",
  "blockId": "...",
  "leftText": "enum4linux",
  "rightText": "SMB shares & users"
}

// 3. Add additional pairs
{
  "chapterID": "abc-123",
  "action": "addPair",
  "blockId": "...",
  "leftText": "nmap --script smb-enum-shares",
  "rightText": "SMB share enumeration"
}

// 4. Update a pair if you need to fix wording
{
  "chapterID": "abc-123",
  "action": "updatePair",
  "blockId": "...",
  "pairId": "<pair-uuid>",
  "leftText": "enum4linux -a",
  "rightText": "SMB shares, users, and groups"
}

// Grading: correctPairs / totalPairs. Each leftID matched with the rightID
// belonging to the same pair counts as one correct match.
```

### ORDERING example via `curriculum_manage_questions`

Use for sequential steps (kill chain, command pipeline, recipe). Create the empty shell, then add each item in the canonical correct order:

```json
// 1. Create
{
  "chapterID": "abc-123",
  "action": "create",
  "questionType": "ordering",
  "questionText": "Place the Cyber Kill Chain phases in order.",
  "requireAnswer": true
}
// Returns: { questionID: "..." }

// 2. Add items in canonical order (the order added IS the correct order)
{
  "chapterID": "abc-123",
  "action": "addItem",
  "blockId": "...",
  "itemText": "Reconnaissance"
}
// Returns: { itemId: "<item-uuid>" }

// 3. Repeat addItem for Weaponization, Delivery, Exploitation, ...

// 4. Reorder all items at once by passing the full itemIds[] array
{
  "chapterID": "abc-123",
  "action": "reorderItems",
  "blockId": "...",
  "itemIds": ["<id-recon>", "<id-weapon>", "<id-deliver>", "<id-exploit>"]
}

// 5. Update an item label
{
  "chapterID": "abc-123",
  "action": "updateItem",
  "blockId": "...",
  "itemId": "<item-uuid>",
  "itemText": "Reconnaissance & footprinting"
}

// Grading: correctPositions / totalPositions. Each item placed in its
// canonical slot counts.
```

### DIAGRAM_SELECTION example via `curriculum_manage_questions`

Use for "click the X on this diagram" questions. Best for network diagrams, kill-chain visuals, ICS topology callouts. The image is attached inline as base64 on the question entity; only PNG and JPEG are accepted (SVG is rejected for security). Maximum image size is 500KB raw (~670KB base64). Regions are rectangles in normalized 0..1 coordinates.

```json
// Create (image + at least one correct region inline)
{
  "chapterID": "abc-123",
  "action": "create",
  "questionType": "diagram_selection",
  "questionText": "Click each subnet that holds an internet-facing host.",
  "requireAnswer": true,
  "imageBase64": "<base64 of PNG or JPEG, <=500KB raw>",
  "mimeType": "image/png",
  "regions": [
    {
      "id": "r1",
      "label": "DMZ",
      "shape": "rect",
      "coords": { "x": 0.10, "y": 0.20, "w": 0.18, "h": 0.12 },
      "isCorrect": true
    },
    {
      "id": "r2",
      "label": "Internal LAN",
      "shape": "rect",
      "coords": { "x": 0.40, "y": 0.45, "w": 0.20, "h": 0.15 },
      "isCorrect": false
    }
  ]
}

// Add a new hotspot to an existing diagram question
{
  "chapterID": "abc-123",
  "action": "addRegion",
  "blockId": "...",
  "label": "Public Internet",
  "shape": "rect",
  "coords": { "x": 0.7, "y": 0.5, "w": 0.15, "h": 0.15 },
  "isCorrect": false
}

// Update an existing hotspot label or correctness
{
  "chapterID": "abc-123",
  "action": "updateRegion",
  "blockId": "...",
  "regionId": "<region-uuid>",
  "label": "Perimeter Firewall",
  "isCorrect": true
}

// Delete a hotspot
{
  "chapterID": "abc-123",
  "action": "deleteRegion",
  "blockId": "...",
  "regionId": "<region-uuid>"
}

// Replace the diagram image (PNG or JPEG only)
{
  "chapterID": "abc-123",
  "action": "updateImage",
  "blockId": "...",
  "imageBase64": "<base64 of new PNG or JPEG, <=500KB raw>",
  "mimeType": "image/jpeg"
}

// Grading: Jaccard similarity on selected region IDs
// = |chosen ∩ correct| / |chosen ∪ correct|.
// Only PNG and JPEG mime types are accepted. SVG is rejected by the bridge
// validator with a clear error message. Image must be <=500KB raw.
```

## Tabbed Widget Block

Type value: `"tabbedWidget"`

| Field | Type | Required |
|-------|------|----------|
| type | `"tabbedWidget"` | Yes |
| tabName1 | `string` | Yes |
| tabName2 | `string` | Yes |
| defaultTab | `number` | No (default `0`) |
| tabs | `Block[][]` | Yes |

`tabs` is an array of 2 arrays — each containing blocks for that tab.

## Column Layout Block

Type value: `"columns"`

| Field | Type | Required |
|-------|------|----------|
| type | `"columns"` | Yes |
| layoutType | enum | Yes |
| columns | `Block[][]` | Yes |

Layout types: `TWO_COLUMN`, `THREE_COLUMN`

`columns` is an array of 2 or 3 arrays — each containing blocks for that column.