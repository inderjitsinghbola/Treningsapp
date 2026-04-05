const fs = require(`fs`);
const files = [`src/App.jsx`];
files.forEach(file => {
  let c = fs.readFileSync(file, `utf8`);
  const dot = `.`;
  const dots = dot + dot + dot;
  c = c
    .replace(/\u201c/g, `\u0022`)
    .replace(/\u201d/g, `\u0022`)
    .replace(/\u2018/g, `\u0027`)
    .replace(/\u2019/g, `\u0027`)
    .replace(/\u2026/g, dots);
  fs.writeFileSync(file, c);
  console.log(`Fixed: ` + file);
});
