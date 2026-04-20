# Media Workflow Reference

Use `curriculum_search_media` to find media by keyword, or `curriculum_browse_media` to browse by folder. Both tools are self-documented — see their parameter descriptions for usage.

## Inserting Media Blocks

After finding media via search/browse, use the returned `id` in the appropriate block type:

### Image
```json
{
  "type": "image",
  "imageId": "<media-id>",
  "alt": "Description of image",
  "caption": "Optional caption",
  "widthPct": 80,
  "alignment": "CENTER"
}
```

### Video
```json
{
  "type": "video",
  "provider": "bunny",
  "videoId": "<media-id>",
  "title": "Video title"
}
```

### PDF
```json
{
  "type": "pdf",
  "pdfId": "<media-id>",
  "title": "Document title",
  "pageStart": 1,
  "pageEnd": 10,
  "allowDownloadForAllPages": false
}
```