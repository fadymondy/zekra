import { Packer as DocxPacker } from "docx";

/*
web/lib/notes/export/docx.ts ends with `Packer.toBuffer(doc)`. That asks JSZip
for a Node "nodebuffer", which a browser (our WebView) does not have. Rather
than fork the exporter, the build aliases `docx` to this module for that one
file (scripts/build-editor.mjs), so the SAME exporter runs here and its
"buffer" comes back as a base64 string — exactly what the bridge carries.
*/

export * from "docx";

export class Packer extends DocxPacker {
  static override toBuffer(...args: Parameters<typeof DocxPacker.toBase64String>): ReturnType<typeof DocxPacker.toBuffer> {
    return DocxPacker.toBase64String(...args) as unknown as ReturnType<typeof DocxPacker.toBuffer>;
  }
}
