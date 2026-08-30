import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import { marked } from 'marked';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directories
const POSTS_DIR = path.join(__dirname, 'posts');
const DIST_DIR = path.join(__dirname, 'dist');
const CHAPTERS_FILE = path.join(__dirname, 'chapters.json');

// Ensure dist directory exists
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
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
 * Generate left navigation HTML
 */
function generateLeftNav(groupedPosts, currentSlug = null) {
  let html = '<nav class="left-nav">\n';

  // Chapters with posts
  groupedPosts.chapters.forEach((chapter, idx) => {
    html += `  <div class="chapter">\n`;
    html += `    <h3>${idx + 1}. ${chapter.title.toUpperCase()}</h3>\n`;
    html += `    <ul>\n`;
    chapter.posts.forEach(post => {
      const active = post.slug === currentSlug ? ' class="active"' : '';
      html += `      <li${active}><a href="${post.slug}.html">${post.frontmatter.title}</a></li>\n`;
    });
    html += `    </ul>\n`;
    html += `  </div>\n`;
  });

  // Uncategorized posts
  if (groupedPosts.uncategorized.length > 0) {
    const idx = groupedPosts.chapters.length + 1;
    html += `  <div class="chapter">\n`;
    html += `    <h3>${idx}. EXPLORATIONS</h3>\n`;
    html += `    <ul>\n`;
    groupedPosts.uncategorized.forEach(post => {
      const active = post.slug === currentSlug ? ' class="active"' : '';
      html += `      <li${active}><a href="${post.slug}.html">${post.frontmatter.title}</a></li>\n`;
    });
    html += `    </ul>\n`;
    html += `  </div>\n`;
  }

  html += '</nav>';
  return html;
}

/**
 * Generate right navigation (sections) HTML
 */
function generateRightNav(headings) {
  if (headings.length === 0) {
    return '<nav class="right-nav"></nav>';
  }

  let html = '<nav class="right-nav">\n';
  headings.forEach(heading => {
    const indent = heading.level > 2 ? ' class="indent"' : '';
    html += `  <a href="#${heading.id}"${indent}>${heading.text.toUpperCase()} ──</a>\n`;
  });
  html += '</nav>';
  return html;
}

/**
 * Generate full post HTML page
 */
function generatePostPage(post, groupedPosts) {
  const leftNav = generateLeftNav(groupedPosts, post.slug);
  const rightNav = generateRightNav(post.headings);
  const chapterTitle = post.frontmatter.chapter
    ? groupedPosts.chapters.find(c => c.id === post.frontmatter.chapter)?.title || 'Explorations'
    : 'Explorations';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${post.frontmatter.title} - Michael Kleyn</title>
  <link rel="stylesheet" href="../css/style.css">
  <link rel="stylesheet" href="../css/blog.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
</head>
<body class="blog-page">
  <div class="blog-container">
    <header class="blog-header">
      <a href="index.html" class="back-link">&lt;</a>
      <span class="breadcrumb">
        <span class="chapter-name">${chapterTitle.toUpperCase()}</span> /
        <span class="post-name">${post.frontmatter.title.toUpperCase()}</span>
      </span>
    </header>

    <div class="blog-layout">
      ${leftNav}

      <main class="blog-content">
        <article>
          ${post.html}
        </article>
      </main>

      ${rightNav}
    </div>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <script>hljs.highlightAll();</script>
  <script src="../js/blog.js"></script>
</body>
</html>`;
}

/**
 * Generate index page HTML
 */
function generateIndexPage(groupedPosts) {
  const leftNav = generateLeftNav(groupedPosts);

  let mainContent = '<h1>ML Engineering Explorations</h1>\n<div class="divider">-----</div>\n';

  // Chapters
  groupedPosts.chapters.forEach(chapter => {
    mainContent += `<section class="chapter-section">\n`;
    mainContent += `  <h2>${chapter.title.toUpperCase()}</h2>\n`;
    mainContent += `  <ul class="post-list">\n`;
    chapter.posts.forEach(post => {
      mainContent += `    <li>\n`;
      mainContent += `      <a href="${post.slug}.html">${post.frontmatter.title}</a>\n`;
      mainContent += `      <span class="date">${post.frontmatter.date}</span>\n`;
      mainContent += `    </li>\n`;
    });
    mainContent += `  </ul>\n`;
    mainContent += `</section>\n`;
    mainContent += `<div class="divider">-----</div>\n`;
  });

  // Uncategorized
  if (groupedPosts.uncategorized.length > 0) {
    mainContent += `<section class="chapter-section">\n`;
    mainContent += `  <h2>EXPLORATIONS</h2>\n`;
    mainContent += `  <ul class="post-list">\n`;
    groupedPosts.uncategorized.forEach(post => {
      mainContent += `    <li>\n`;
      mainContent += `      <a href="${post.slug}.html">${post.frontmatter.title}</a>\n`;
      mainContent += `      <span class="date">${post.frontmatter.date}</span>\n`;
      mainContent += `    </li>\n`;
    });
    mainContent += `  </ul>\n`;
    mainContent += `</section>\n`;
  }

  // Right nav for index = jump to chapters
  let rightNavHtml = '<nav class="right-nav">\n';
  groupedPosts.chapters.forEach(chapter => {
    rightNavHtml += `  <a href="#${slugify(chapter.title)}">${chapter.title.toUpperCase()} ──</a>\n`;
  });
  if (groupedPosts.uncategorized.length > 0) {
    rightNavHtml += `  <a href="#explorations">EXPLORATIONS ──</a>\n`;
  }
  rightNavHtml += '</nav>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Explorations - Michael Kleyn</title>
  <link rel="stylesheet" href="../css/style.css">
  <link rel="stylesheet" href="../css/blog.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
</head>
<body class="blog-page">
  <div class="blog-container">
    <header class="blog-header">
      <a href="../index.html" class="back-link">&lt;</a>
      <span class="breadcrumb">
        <span class="post-name">MKLEYN.COM / EXPLORATIONS</span>
      </span>
    </header>

    <div class="blog-layout">
      ${leftNav}

      <main class="blog-content">
        ${mainContent}
      </main>

      ${rightNavHtml}
    </div>
  </div>

  <script src="../js/blog.js"></script>
</body>
</html>`;
}

/**
 * Main build function
 */
function build() {
  console.log('Building blog...');

  const posts = getAllPosts();
  const chapters = getChapters();
  const groupedPosts = groupPostsByChapter(posts, chapters);

  console.log(`Found ${posts.length} posts`);

  // Generate individual post pages
  posts.forEach(post => {
    const html = generatePostPage(post, groupedPosts);
    const outputPath = path.join(DIST_DIR, `${post.slug}.html`);
    fs.writeFileSync(outputPath, html);
    console.log(`  Generated: ${post.slug}.html`);
  });

  // Generate index page
  const indexHtml = generateIndexPage(groupedPosts);
  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), indexHtml);
  console.log('  Generated: index.html');

  console.log('Build complete!');
}

// Run build
build();
