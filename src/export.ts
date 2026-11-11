import { PDFDocument, PDFHexString, rgb, BlendMode } from 'pdf-lib';
import { colors, type Highlight } from './storage';

export async function exportAnnotatedPdf(bytes: Uint8Array, marks: Highlight[]) {
  const output = await PDFDocument.load(bytes);
  for (const mark of marks) {
    const hex = colors[mark.color];
    const color = [parseInt(hex.slice(1,3),16)/255, parseInt(hex.slice(3,5),16)/255, parseInt(hex.slice(5,7),16)/255] as const;
    for (const region of mark.regions) {
      const [x1,y1,x2,y2] = region.rect;
      output.getPage(region.pageIndex).drawRectangle({ x:x1,y:y1,width:x2-x1,height:y2-y1, color:rgb(...color), opacity:.38, blendMode:BlendMode.Multiply, borderWidth:0 });
    }
    if (mark.note?.trim()) {
      // A standard PDF Text annotation preserves Unicode comments in other viewers.
      // Keep annotations on each selected page; retain all original annotations.
      const pageIndices = new Set(mark.regions.map(region => region.pageIndex));
      for (const index of pageIndices) {
        const region = mark.regions.find(region => region.pageIndex === index)!;
        const page = output.getPage(index);
        const crop = page.getCropBox();
        const x = Math.max(crop.x, Math.min(region.rect[2] + 4, crop.x + crop.width - 22));
        const y = Math.max(crop.y, Math.min(region.rect[3] - 22, crop.y + crop.height - 22));
        const annotation = output.context.obj({
          Type:'Annot', Subtype:'Text', Rect:[x,y,x+22,y+22],
          Contents:PDFHexString.fromText(mark.note),
          T:PDFHexString.fromText('Leaf 메모'),
          Subj:PDFHexString.fromText(mark.quote || '선택한 문장 메모'),
          NM:PDFHexString.fromText('leaf-' + mark.id + '-' + index),
          Name:'Comment', C:[...color], Open:false, F:4, P:page.ref,
        });
        page.node.addAnnot(output.context.register(annotation));
      }
    }
  }
  return output.save();
}
