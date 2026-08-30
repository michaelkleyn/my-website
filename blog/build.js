import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { marked } from 'marked';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directories
const POSTS_DIR = path.join(__dirname, 'posts');
const CHAPTERS_FILE = path.join(__dirname, 'chapters.json');

/** Front matter: a `---` block of `key: value` lines (quotes optional; bare numbers become numbers). */
function matter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(src);
  if (!m) return { data: {}, content: src };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else if (v !== '' && !Number.isNaN(Number(v))) v = Number(v);
    data[k] = v;
  }
  return { data, content: src.slice(m[0].length) };
}

/**
 * Extract headings from markdown content for right-nav
 *
 * @param {string} content - Raw markdown content (after frontmatter removed)
 * @returns {Array<{id: string, text: string, level: number}>}
 */
function extractHeadings(content) {
  const headings = [];
  // Match lines starting with ## or ### (skip # as that's usually the title)
  const regex = /^(#{2,3})\s+(.+)$/gm;

  let match;
  while ((match = regex.exec(content)) !== null) {
    const level = match[1].length; // Number of # symbols
    const text = match[2].trim();
    const id = slugify(text);

    headings.push({ id, text, level });
  }

  return headings;
}

/**
 * Convert heading text to URL-friendly slug
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .trim();
}

/**
 * Configure marked to add IDs to headings via postprocess
 */
marked.use({
  hooks: {
    postprocess(html) {
      // Add id attributes to h2 and h3 tags
      return html.replace(/<h([23])>([^<]+)<\/h[23]>/g, (match, level, text) => {
        const id = slugify(text);
        return `<h${level} id="${id}">${text}</h${level}>`;
      });
    }
  }
});

/**
 * Read and parse all posts
 */
function getAllPosts() {
  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));

  return files.map(filename => {
    const filepath = path.join(POSTS_DIR, filename);
    const fileContent = fs.readFileSync(filepath, 'utf-8');
    const { data: frontmatter, content } = matter(fileContent);

    const slug = filename.replace('.md', '');
    const headings = extractHeadings(content);
    const html = marked(content);

    return {
      slug,
      filename,
      frontmatter: {
        title: frontmatter.title || slug,
        date: frontmatter.date || new Date().toISOString().split('T')[0],
        chapter: frontmatter.chapter || null,
        order: frontmatter.order || 999,
      },
      headings,
      html,
    };
  }).sort((a, b) => {
    // Sort by date descending
    return new Date(b.frontmatter.date) - new Date(a.frontmatter.date);
  });
}

/**
 * Load chapters configuration
 */
function getChapters() {
  if (!fs.existsSync(CHAPTERS_FILE)) return [];
  const content = fs.readFileSync(CHAPTERS_FILE, 'utf-8');
  return JSON.parse(content);
}

/**
 * Group posts by chapter
 */
function groupPostsByChapter(posts, chapters) {
  const chapterMap = new Map();
  const uncategorized = [];

  // Initialize chapters
  chapters.forEach(ch => {
    chapterMap.set(ch.id, { ...ch, posts: [] });
  });

  // Assign posts to chapters
  posts.forEach(post => {
    if (post.frontmatter.chapter && chapterMap.has(post.frontmatter.chapter)) {
      chapterMap.get(post.frontmatter.chapter).posts.push(post);
    } else {
      uncategorized.push(post);
    }
  });

  // Sort posts within chapters by order
  chapterMap.forEach(chapter => {
    chapter.posts.sort((a, b) => a.frontmatter.order - b.frontmatter.order);
  });

  // Convert to array and sort by chapter order
  const sortedChapters = Array.from(chapterMap.values())
    .filter(ch => ch.posts.length > 0)
    .sort((a, b) => a.order - b.order);

  return { chapters: sortedChapters, uncategorized };
}

/**
 * Main build function
 */
const CONTENT_DIR = path.join(__dirname, '..', 'content');
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const niceDate = (d) => { const t = new Date(d); return isNaN(t) ? String(d) : t.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); };

/** A post as a fragment for the journal site's reading card (content/blog/<slug>.html) */
function generatePostFragment(post) {
  return `<article class="post" data-slug="${post.slug}">
  <header class="post-head">
    <h1>${escapeHtml(post.frontmatter.title)}</h1>
    <p class="post-date">${escapeHtml(niceDate(post.frontmatter.date))}</p>
  </header>
  <div class="post-body">
${post.html}
  </div>
</article>
`;
}

/** The /blog spread (content/pages/blog.html): the list of posts, newest first, grouped by chapter when there are chapters */
function generateBlogSpread(groupedPosts, posts) {
  const items = posts.map((p) => `  <li><a href="/blog/${p.slug}">${escapeHtml(p.frontmatter.title)}</a> <span class="small">· ${escapeHtml(niceDate(p.frontmatter.date))}</span></li>`).join('\n');
  return `<section data-node="body" class="blog-page">
<h1>Blog</h1>
<p class="lede">Notes from the workbench.</p>
<ul class="posts">
${items}
</ul>
</section>
`;
}

function build() {
  console.log('Building blog...');

  const posts = getAllPosts();
  const chapters = getChapters();
  const groupedPosts = groupPostsByChapter(posts, chapters);

  console.log(`Found ${posts.length} posts`);

  // Fragments for the journal site
  fs.mkdirSync(path.join(CONTENT_DIR, 'blog'), { recursive: true });
  fs.mkdirSync(path.join(CONTENT_DIR, 'pages'), { recursive: true });
  posts.forEach((post) => {
    fs.writeFileSync(path.join(CONTENT_DIR, 'blog', `${post.slug}.html`), generatePostFragment(post));
    console.log(`  Fragment: content/blog/${post.slug}.html`);
  });
  fs.writeFileSync(path.join(CONTENT_DIR, 'blog', 'index.json'), JSON.stringify(posts.map((p) => ({ slug: p.slug, title: p.frontmatter.title, date: p.frontmatter.date, chapter: p.frontmatter.chapter, headings: p.headings })), null, 2) + '\n');
  fs.writeFileSync(path.join(CONTENT_DIR, 'pages', 'blog.html'), generateBlogSpread(groupedPosts, posts));
  console.log('  Spread: content/pages/blog.html');

  console.log('Build complete!');
}

// Run build
build();
