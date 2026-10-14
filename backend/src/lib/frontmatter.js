/**
 * Tolerant parser for the roadmap .md files in this repo.
 * Those files are YAML-ish key/value documents (sometimes with --- markers)
 * holding frontmatter such as title, description, order and a `question:`
 * block with the "What is X?" markdown article.
 */

function stripQuotes(value) {
  const v = value.trim();
  if (
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2) ||
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2)
  ) {
    return v.slice(1, -1);
  }
  return v.replace(/\s+#.*$/, '').trim();
}

export function parseFrontmatter(raw) {
  let text = raw.replace(/^\uFEFF/, '');
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end !== -1) text = text.slice(text.indexOf('\n') + 1, end);
  }

  const lines = text.split(/\r?\n/);
  const top = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const m = /^([A-Za-z_][\w.-]*):\s*(.*)$/.exec(line);
    if (!m) {
      i += 1;
      continue;
    }
    const key = m[1];
    const inline = m[2].trim();

    if (inline === '' || inline === '|' || inline === '|-' || inline === '>' || inline === '>-') {
      // nested object or block scalar: collect deeper indented lines
      const block = [];
      i += 1;
      while (i < lines.length && (lines[i].trim() === '' || /^\s/.test(lines[i]))) {
        block.push(lines[i]);
        i += 1;
      }
      top[key] = { __block: block };
    } else {
      top[key] = stripQuotes(inline);
      i += 1;
    }
  }
  return top;
}

/** Pull a scalar key out of a nested block gathered by parseFrontmatter. */
function blockScalar(blockLines, key) {
  if (!blockLines) return null;
  const start = blockLines.findIndex((l) => new RegExp(`^\\s+${key}:\\s*`).test(l));
  if (start === -1) return null;

  const m = new RegExp(`^\\s+${key}:\\s*(.*)$`).exec(blockLines[start]);
  let value = (m[1] || '').trim();

  if (value === '' || value === '|' || value === '|-' || value === '>' || value === '>-') {
    const collected = [];
    let j = start + 1;
    while (j < blockLines.length && (blockLines[j].trim() === '' || /^\s{2,}/.test(blockLines[j]))) {
      collected.push(blockLines[j]);
      j += 1;
    }
    // drop trailing blank lines
    while (collected.length && collected[collected.length - 1].trim() === '') collected.pop();
    if (!collected.length) return null;
    // dedent by the indentation of the first non-empty line
    const indent = /^\s*/.exec(collected[0])[0].length;
    return collected.map((l) => l.slice(indent)).join('\n').trim();
  }
  return stripQuotes(value);
}

/** Returns the fields we care about from a roadmap/best-practice .md file. */
export function readRoadmapMeta(raw) {
  const fm = parseFrontmatter(raw);
  const questionBlock = fm.question && fm.question.__block ? fm.question.__block : null;

  return {
    jsonUrl: typeof fm.jsonUrl === 'string' ? fm.jsonUrl : null,
    pdfUrl: typeof fm.pdfUrl === 'string' ? fm.pdfUrl : null,
    order: fm.order !== undefined ? Number(fm.order) || 0 : null,
    briefTitle: typeof fm.briefTitle === 'string' ? fm.briefTitle : null,
    briefDescription: typeof fm.briefDescription === 'string' ? fm.briefDescription : null,
    title: typeof fm.title === 'string' ? fm.title : null,
    description: typeof fm.description === 'string' ? fm.description : null,
    hasTopics: fm.hasTopics === 'true' || fm.hasTopics === true,
    isForkable: fm.isForkable === 'true' || fm.isForkable === true,
    questionTitle: blockScalar(questionBlock, 'title'),
    articleMd: blockScalar(questionBlock, 'description'),
  };
}
