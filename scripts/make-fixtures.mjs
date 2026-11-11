import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('tests/fixtures', { recursive: true });
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (let i=0;i<6;i++) {
  const page = doc.addPage([600,780]);
  page.drawText(i === 0 ? 'A little space to read' : 'Reading, page ' + (i+1), {x:56,y:700,size:26,font,color:rgb(.17,.28,.2)});
  page.drawText('Hello world. Reading opens a beautiful window.', {x:56,y:640,size:16,font});
  page.drawText('Curiosity brings new ideas and unexpected discoveries.', {x:56,y:610,size:16,font});
  page.drawText('Every sentence is a chance to learn something new.', {x:56,y:580,size:16,font});
  page.drawText('Select these words and keep the thought with you.', {x:56,y:550,size:16,font});
  page.drawText('A final line near the bottom of this page.', {x:56,y:76,size:14,font});
  if (i === 1) page.setRotation(degrees(90));
  if (i === 2) page.setCropBox(30,40,530,700);
  if (i === 3) { page.setCropBox(30,40,530,700); page.setRotation(degrees(270)); }
}
const scan = doc.addPage([600,780]);
scan.drawRectangle({x:60,y:520,width:450,height:120,color:rgb(.88,.92,.85)});
const bytes = await doc.save();
await writeFile('tests/fixtures/reading.pdf', bytes);
await writeFile('public/sample.pdf', bytes);
const other = await PDFDocument.create(); const otherPage=other.addPage([600,780]); otherPage.drawText('A different document with the same name.', {x:60,y:650});
await writeFile('tests/fixtures/different.pdf', await other.save());
await writeFile('tests/fixtures/broken.pdf', 'This is not a valid PDF.');
