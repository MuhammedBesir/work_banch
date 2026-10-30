// design/tokens.json → src/styles/tokens.css
// Tasarım sistemindeki token dosyası tek kaynaktır; CSS her derlemede yeniden üretilir.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tokens = JSON.parse(readFileSync(root + "design/tokens.json", "utf8"));
const themes = tokens.color.themes.map((t) => t.id);
const [primary] = themes;

const valueFor = (value, theme) =>
  typeof value === "string" ? value : value[theme] ?? value[primary];

const byName = new Map();
for (const family of Object.keys(tokens)) {
  for (const t of tokens[family]?.tokens ?? []) byName.set(t.name, t);
}

function resolve(name, theme, seen = new Set()) {
  if (seen.has(name)) throw new Error(`Döngüsel token: ${name}`);
  seen.add(name);
  const v = valueFor(byName.get(name).value, theme);
  const alias = /^\{(.+)\}$/.exec(v);
  return alias ? resolve(alias[1], theme, seen) : v;
}

const themed = ["color", "shadow"];
const lines = [`/* ${tokens.name} — generated from design/tokens.json; elle düzenleme */`];

const block = (selector, theme) => {
  const out = [];
  for (const fam of themed) for (const t of tokens[fam].tokens) out.push(`  --${t.name}: ${resolve(t.name, theme)};`);
  return `${selector} {\n${out.join("\n")}\n}`;
};

const constant = [];
for (const [k, v] of Object.entries(tokens.type.families)) constant.push(`  --font-${k}: ${v};`);
for (const fam of Object.keys(tokens)) {
  if (["name", "version", "type", ...themed].includes(fam)) continue;
  for (const t of tokens[fam].tokens ?? []) constant.push(`  --${t.name}: ${resolve(t.name, primary)};`);
}

lines.push(`:root {\n${constant.join("\n")}\n}`);
lines.push(block(`:root, [data-theme="${primary}"]`, primary));
for (const theme of themes.slice(1)) lines.push(block(`[data-theme="${theme}"]`, theme));

writeFileSync(root + "src/styles/tokens.css", lines.join("\n\n") + "\n");
console.log("tokens.css yazıldı");
