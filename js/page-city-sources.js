// /city/sources — where every reading on the city board comes from, as plain
// links in the board's own order. The list is built by the Worker from the
// same config the board reads (src/api/city.js, buildSources) and travels in
// the board's snapshot, so this page reads that first, like the board does,
// and asks the site itself only when there is none.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Only web addresses become links: the list is built from config, but a link is still only ever http(s) or this site.
const href = (u) => (/^(https?:\/\/|\/(?!\/))/.test(u || '') ? esc(u) : null);

const CDN = document.querySelector('meta[name="cdn-base"]')?.content || '';

async function read() {
  if (/^https:/.test(CDN)) {
    try {
      const res = await fetch(`${CDN}/city/now.json`, { cache: 'no-cache' });
      if (res.ok) {
        const p = await res.json();
        if (p?.sources) return p.sources;
      }
    } catch { /* fall through to the site */ }
  }
  const res = await fetch('/api/city', { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(res.status);
  return (await res.json()).sources;
}

function render(sections) {
  $('sources').innerHTML = sections.map(({ section, items }) => `
    <h2>${esc(section)}</h2>
    <ul>${items.map((it) => {
      const links = [
        href(it.page) && `<a href="${href(it.page)}">page</a>`,
        href(it.data) && `<a href="${href(it.data)}">${esc(it.dataLabel || 'data')}</a>`,
      ].filter(Boolean).join('');
      return `<li>${esc(it.name)} <span class="by">· ${esc(it.by)}</span><span class="links">${links}</span></li>`;
    }).join('')}</ul>`).join('');
}

read().then((sections) => {
  if (!sections) { $('sources').innerHTML = '<p class="note">This site has no city board configured.</p>'; return; }
  render(sections);
}).catch(() => {
  $('sources').innerHTML = '<p class="note">Can’t reach the list right now. Try again in a minute.</p>';
});
