from pathlib import Path

# Keep paused DEV completely absent now that old shop CSS no longer supplies the hide rule.
p=Path('v27.css');s=p.read_text()
needle=':root{--v27-gold:'
idx=s.index(needle)
line="#twDevToggle,.dev-v18-tools,.dev-v18-editor,.dev-v18-strip,.dev19-float,.dev19-inspector,.dev19-bottom,.dev21-inspector,.dev21-toolbar,.dev21-selection,.dev21-marquee,.dev21-context,.dev22-toolbar,.dev22-inspector,.dev22-selection,.dev22-context,.dev22-canvas,.dev23-ui{display:none!important}\n"
if '#twDevToggle' not in s:
    s=s[:idx]+line+s[idx:]
p.write_text(s)

# Keep blank comparison labs stable until the user actually starts/saves one.
for name in ['backend/Code.gs','backend/Code-v17.gs']:
    p=Path(name);s=p.read_text()
    old="""function sanitizeCompareLab_(value){
  const v=value&&typeof value==='object'?value:{};
  return {id:cleanText_(v.id,80)||Utilities.getUuid(),titleA:cleanText_(v.titleA,120)||'Scenario A',titleB:cleanText_(v.titleB,120)||'Scenario B',rowsA:(Array.isArray(v.rowsA)?v.rowsA:[]).slice(0,30).map(sanitizeCompareRow_),rowsB:(Array.isArray(v.rowsB)?v.rowsB:[]).slice(0,30).map(sanitizeCompareRow_),updatedAt:new Date().toISOString()};
}"""
    new="""function sanitizeCompareLab_(value){
  const v=value&&typeof value==='object'?value:{};
  if(!Object.keys(v).length)return {};
  return {id:cleanText_(v.id,80)||Utilities.getUuid(),titleA:cleanText_(v.titleA,120)||'Scenario A',titleB:cleanText_(v.titleB,120)||'Scenario B',rowsA:(Array.isArray(v.rowsA)?v.rowsA:[]).slice(0,30).map(sanitizeCompareRow_),rowsB:(Array.isArray(v.rowsB)?v.rowsB:[]).slice(0,30).map(sanitizeCompareRow_),updatedAt:cleanText_(v.updatedAt,40)||new Date().toISOString()};
}"""
    if old in s:s=s.replace(old,new,1)
    p.write_text(s)
print('v27 final fixes applied')
