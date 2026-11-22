/**
 * 从生成的 Markdown 文档构建知识图谱数据 public/graph-data.json。
 * 概念来源：frontmatter 的 concepts / tags，以及 data/concepts.json 词典在正文中的命中。
 * 纯本地构建期生成，无外部 API。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';

const ROOT = process.cwd();
const DOCS_DIR = path.join(ROOT, 'src/content/docs');
const CONCEPTS_FILE = path.join(ROOT, 'data/concepts.json');
const OUT_FILE = path.join(ROOT, 'public/graph-data.json');

function normalizeConcepts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === 'string' ? { name: item, aliases: [] } : item))
    .filter((item) => item && typeof item.name === 'string' && item.name.trim())
    .map((item) => ({
      name: item.name.trim(),
      aliases: Array.isArray(item.aliases) ? item.aliases.filter((a) => typeof a === 'string') : [],
    }));
}

function collectConcepts(body, dictionary, declared) {
  const found = new Set(declared.map((c) => (typeof c === 'string' ? c.trim() : '')).filter(Boolean));
  const lower = body.toLowerCase();

  for (const entry of dictionary) {
    const terms = [entry.name, ...entry.aliases].filter((term) => term && term.length >= 2);
    if (terms.some((term) => lower.includes(term.toLowerCase()))) found.add(entry.name);
  }
  return [...found];
}

async function main() {
  const dictionary = normalizeConcepts(JSON.parse(await readFile(CONCEPTS_FILE, 'utf8')));
  const files = await fg(['**/*.md'], { cwd: DOCS_DIR, absolute: true, onlyFiles: true });

  const documents = [];
  for (const file of files) {
    const parsed = matter(await readFile(file, 'utf8'));
    const id = path.basename(file, '.md');
    const concepts = collectConcepts(
      parsed.content,
      dictionary,
      [...(parsed.data.concepts || []), ...(parsed.data.tags || [])]
    );
    documents.push({
      id: `doc:${id}`,
      url: `/docs/${encodeURIComponent(id)}/`,
      label: parsed.data.title || id,
      category: parsed.data.category || '未分类',
      type: 'doc',
      concepts,
    });
  }

  const nodes = new Map();
  const docConceptEdges = [];
  const conceptPairs = new Map();
  const docPairs = new Map();

  const pairKey = (a, b) => (a < b ? `${a}::${b}` : `${b}::${a}`);

  for (const doc of documents) {
    nodes.set(doc.id, {
      id: doc.id,
      label: doc.label,
      type: 'doc',
      category: doc.category,
      url: doc.url,
    });

    for (const concept of doc.concepts) {
      const conceptId = `concept:${concept}`;
      if (!nodes.has(conceptId)) {
        nodes.set(conceptId, { id: conceptId, label: concept, type: 'concept', category: '概念' });
      }
      docConceptEdges.push({ source: doc.id, target: conceptId, weight: 1, kind: 'doc-concept' });
    }

    for (let i = 0; i < doc.concepts.length; i++) {
      for (let j = i + 1; j < doc.concepts.length; j++) {
        const key = pairKey(doc.concepts[i], doc.concepts[j]);
        conceptPairs.set(key, (conceptPairs.get(key) || 0) + 1);
      }
    }
  }

  for (let i = 0; i < documents.length; i++) {
    for (let j = i + 1; j < documents.length; j++) {
      const shared = documents[i].concepts.filter((c) => documents[j].concepts.includes(c));
      if (shared.length >= 2) {
        docPairs.set(pairKey(documents[i].id, documents[j].id), {
          source: documents[i].id,
          target: documents[j].id,
          weight: shared.length,
          kind: 'doc-doc',
          shared,
        });
      }
    }
  }

  const edges = [...docConceptEdges];

  for (const [key, weight] of conceptPairs) {
    if (weight < 2) continue;
    const [a, b] = key.split('::');
    edges.push({
      source: `concept:${a}`,
      target: `concept:${b}`,
      weight,
      kind: 'concept-concept',
    });
  }

  for (const pair of docPairs.values()) edges.push(pair);

  const degree = new Map();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  }
  for (const node of nodes.values()) node.degree = degree.get(node.id) || 0;

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(
    OUT_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), nodes: [...nodes.values()], edges }, null, 2),
    'utf8'
  );

  console.log(`[graph] ${nodes.size} 个节点，${edges.length} 条边 -> public/graph-data.json`);
}

main().catch((error) => {
  console.error('[graph] 失败：', error);
  process.exitCode = 1;
});
