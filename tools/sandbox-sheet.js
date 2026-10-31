// Writes .sandbox/Bakehouse Sandbox.xlsx: the sample sheet from tests/harness.js (made-up data, laid out like the real
// accounting sheet). Upload it to Google Drive and open it as a Google Sheet to get a practice sheet for stage 2 of
// TESTING.md. No dependencies: the .xlsx is a small zip written by hand.
//   npm run sandbox:sheet            -> sample data
//   npm run sandbox:sheet -- --blank -> headers only
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { sampleTabs, blankTabs } = require('../tests/harness');

const tabs = process.argv.includes('--blank') ? blankTabs() : sampleTabs();
const out = path.join(__dirname, '..', '.sandbox', 'Bakehouse Sandbox.xlsx');

const xml = s => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s;
const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = i => (i >= 26 ? colName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
// Excel dates count days from 1899-12-30.
const serial = d => Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(1899, 11, 30)) / 86400000);

function sheetXml(rows) {
  const body = rows.map((row, r) => {
    const cells = row.map((v, c) => {
      const ref = colName(c) + (r + 1);
      if (v === '' || v === null || v === undefined) return '';
      if (v instanceof Date || Object.prototype.toString.call(v) === '[object Date]') return `<c r="${ref}" s="1"><v>${serial(v)}</v></c>`;
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  return xml(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`);
}

const names = Object.keys(tabs);
const files = {
  '[Content_Types].xml': xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`),
  '_rels/.rels': xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
  'xl/workbook.xml': xml(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('\n')}
</sheets></workbook>`),
  'xl/_rels/workbook.xml.rels': xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
  // Style 1 is a plain date (number format 14, m/d/yyyy).
  'xl/styles.xml': xml(`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="2"><xf/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs>
</styleSheet>`),
};
names.forEach((n, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(tabs[n]); });

// Minimal zip: every entry stored uncompressed.
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  Object.entries(entries).forEach(([name, text]) => {
    const data = Buffer.from(text, 'utf8');
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  });
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, zip(files));
console.log('Wrote ' + path.relative(process.cwd(), out) + ' (' + names.join(', ') + ')');
