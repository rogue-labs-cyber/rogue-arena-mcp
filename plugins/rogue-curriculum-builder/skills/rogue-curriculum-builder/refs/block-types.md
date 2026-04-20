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

## Question Block

Type value: `"question"`

| Field | Type | Required |
|-------|------|----------|
| type | `"question"` | Yes |
| questionNumber | `number` | Yes |
| questionText | `string` | Yes |
| questionType | enum | Yes |
| answers | `Array` | For MULTIPLE type |
| requireAnswer | `boolean` | No |

Question types: `SHORT`, `LONG`, `MULTIPLE`, `FILE_UPLOAD`

For MULTIPLE type, `answers` is: `[{ text: string, correct: boolean }]`

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