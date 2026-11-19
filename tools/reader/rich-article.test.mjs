import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractArticle} from '../../src/rich-article.mjs';
test('preserves semantic articles, full responsive images, relative links and code',async()=>{
 const r=await extractArticle(`<nav>Navigation</nav><article><h2>A heading</h2><p>Hello <em>world</em> &amp; friends.</p><figure><img src="tiny.jpg" srcset="small.jpg 400w, /full.jpg 1800w" onerror="evil()"><figcaption>A caption</figcaption></figure><a href="../source">Source</a><ul><li>One</li></ul><pre><code>a &lt; b;\n  indented</code></pre><table><tr><td colspan="2">Cell</td></tr></table></article>`,'https://example.org/blog/post');
 assert.match(r.html,/<h2>A heading<\/h2>/);assert.match(r.html,/<em>world<\/em>/);assert.match(r.html,/src="https:\/\/example.org\/full.jpg"/);assert.match(r.html,/<figcaption>A caption/);assert.match(r.html,/href="https:\/\/example.org\/source"/);assert.match(r.html,/a &lt; b;\n  indented/);assert.doesNotMatch(r.html,/onerror|Navigation/);
});
test('drops executable HTML, local assets, styles, handlers and unsafe URLs',async()=>{
 const r=await extractArticle(`<article><script>alert(1)</script><style>body{display:none}</style><svg onload="evil()"><script>x</script></svg><iframe src="http://localhost:8787"></iframe><p style="color:red" onclick="evil()">Safe</p><a href="javascript:alert(1)">link</a><img src="http://127.0.0.1/private"><img src="data:image/svg+xml,bad"><img src="https://example.org/a.jpg" width="1"><img src="https://example.org/b.jpg" onerror="evil()"></article>`,'https://example.org/');
 assert.doesNotMatch(r.html,/script|style|onclick|onerror|iframe|svg|javascript|127\.0|data:|a\.jpg/);assert.match(r.html,/<p>Safe<\/p>/);assert.match(r.html,/b\.jpg/);
});
test('handles malformed HTML and nested article structure without emitting attributes',async()=>{
 const r=await extractArticle('<body><main><article><p>A <strong>bold</strong> paragraph</p><img src="/pic.jpg" title="&quot; onload=&quot;evil()"></article></main></body>','https://example.org/');
 assert.match(r.html,/<strong>bold<\/strong>/);assert.doesNotMatch(r.html,/onload/);
});
test('deduplicates responsive captions and chooses full picture sources',async()=>{
 const r=await extractArticle('<article><h1>Headline supplied by reader</h1><picture><source srcset="/full.jpg 1600w"><img src="/small.jpg"></picture><figure><figcaption>Same caption</figcaption><figcaption>Same caption</figcaption></figure></article>','https://example.org/');
 assert.match(r.html,/full\.jpg/);assert.doesNotMatch(r.html,/small\.jpg|<h1>/);assert.equal(r.html.match(/<figcaption>/g).length,1);
});
