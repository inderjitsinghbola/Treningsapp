const fs = require(`fs`);

const files = [`src/App.jsx`].filter(f => {
  try { fs.accessSync(f); return true; } catch { return false; }
});

files.forEach(file => {
  let c = fs.readFileSync(file, `utf8`);
  const dot = `.`;
  const dots = dot + dot + dot;
  c = c
    .replace(/\u201c/g, `\u0022`)
    .replace(/\u201d/g, `\u0022`)
    .replace(/\u2018/g, `\u0060`)
    .replace(/\u2019/g, `\u0060`)
    .replace(/\u2026/g, dots)
    .replace(/\u2013/g, `-`)
    .replace(/\u2014/g, `--`)
    .replace(/\u00a0/g, ` `);
  fs.writeFileSync(file, c);
  console.log(`Fixed: ` + file);
});
