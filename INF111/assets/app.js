/* ============================================================
   app.js — INF111 Programmation orientée objet
   Améliorations :
   - Détection et mise en forme des blocs de code Java
   - Coloration syntaxique Java (sans dépendance externe)
   - Mise en valeur des images avec légendes
   ============================================================ */

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const state = { sections: [], modules: null };

async function fetchJson(urls) {
  for (const u of urls) {
    try { const r = await fetch(u,{cache:'no-store'}); if(r.ok) return r.json(); } catch(e){}
  }
  return null;
}

async function loadManifests(){
  const sections = await fetchJson(['assets/sections.json','sections.json']) || [];
  const modules  = await fetchJson(['assets/modules.json','modules.json']) || {modules:[]};
  state.sections = sections;
  state.modules  = modules;
}

function renderSidebar(){
  const root = document.getElementById('sidebar-list');
  if (!root) return;
  root.innerHTML = '';
  state.sections.forEach((mod, modIdx0) => {
    const modLi = document.createElement('li');
    const modA  = document.createElement('a');
    modA.textContent = mod.title;
    modA.href = mod.href;
    modA.addEventListener('click', (e) => {
      e.preventDefault();
      location.hash = new URL(modA.href, location.href).hash;
      loadContent();
      document.getElementById('sidebar')?.classList.remove('open');
    });
    modLi.appendChild(modA);
    if (Array.isArray(mod.children) && mod.children.length) {
      const ul = document.createElement('ul');
      mod.children.forEach((sec, secIdx0) => {
        const li = document.createElement('li');
        const a  = document.createElement('a');
        a.textContent = `${modIdx0+1}.${secIdx0+1} ${sec.title}`;
        a.href = sec.href;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          location.hash = new URL(a.href, location.href).hash;
          loadContent();
          document.getElementById('sidebar')?.classList.remove('open');
        });
        li.appendChild(a);
        ul.appendChild(li);
      });
      modLi.appendChild(ul);
    }
    root.appendChild(modLi);
  });
  highlightActive();
}

function highlightActive(){
  const hash = location.hash;
  $$('#sidebar-list a').forEach(a => a.classList.toggle('active', a.getAttribute('href').endsWith(hash)));
}

function sanitizeFragment(html){
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  doc.querySelectorAll('script, style, link[rel="stylesheet"]').forEach(el=>el.remove());
  return doc.body.firstElementChild ? doc.body.firstElementChild.innerHTML : html;
}

function parseHash(){
  const raw = (location.hash||'').slice(1);
  if (!raw) return {moduleId:null,pageSlug:null,sectionSlug:null};
  const parts = raw.split('--');
  return {moduleId:parts[0]||null, pageSlug:parts[1]||null, sectionSlug:parts[2]||null};
}

async function resolvePageFromHash(){
  const {moduleId, pageSlug} = parseHash();
  const mods = state.modules.modules || [];
  let m = mods.find(x => x.id===moduleId || (typeof x.href==='string' && x.href.endsWith('#'+moduleId)));
  if (!m) m = mods[0];
  if (!m) return null;
  if (pageSlug) { const p=(m.pages||[]).find(p=>p.slug===pageSlug); if(p) return p.href; }
  const page = (m.pages||[])[0];
  return page ? page.href : null;
}

function nextFrame(){ return new Promise(r=>requestAnimationFrame(()=>r())); }

/* ── Coloration syntaxique Java ── */
const JAVA_KW = new Set([
  'abstract','assert','boolean','break','byte','case','catch','char','class',
  'const','continue','default','do','double','else','enum','extends','final',
  'finally','float','for','goto','if','implements','import','instanceof','int',
  'interface','long','native','new','package','private','protected','public',
  'return','short','static','strictfp','super','switch','synchronized','this',
  'throw','throws','transient','try','void','volatile','while','true','false','null',
  'var','record','sealed','permits','yield'
]);

function escH(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function highlightJava(raw){
  const toks = [];
  let out = '';
  let i = 0;

  while (i < raw.length) {
    // Commentaire //
    if (raw[i]==='/' && raw[i+1]==='/') {
      let end = raw.indexOf('\n', i); if(end===-1) end=raw.length;
      toks.push(`<span style="color:var(--jcmt)">${escH(raw.slice(i,end))}</span>`);
      out += `\x00T${toks.length-1}\x00`; i=end; continue;
    }
    // Commentaire /* */
    if (raw[i]==='/' && raw[i+1]==='*') {
      let end = raw.indexOf('*/', i+2); if(end===-1) end=raw.length-2;
      toks.push(`<span style="color:var(--jcmt)">${escH(raw.slice(i,end+2))}</span>`);
      out += `\x00T${toks.length-1}\x00`; i=end+2; continue;
    }
    // String
    if (raw[i]==='"') {
      let j=i+1;
      while(j<raw.length && !(raw[j]==='"' && raw[j-1]!=='\\')) j++;
      toks.push(`<span style="color:var(--jstr)">${escH(raw.slice(i,j+1))}</span>`);
      out += `\x00T${toks.length-1}\x00`; i=j+1; continue;
    }
    out += raw[i]; i++;
  }

  // Mots-clés et identifiants
  out = out.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (m) => {
    if (JAVA_KW.has(m))              return `<span style="color:var(--jkw)">${m}</span>`;
    if (/^[A-Z][a-zA-Z0-9_]+$/.test(m)) return `<span style="color:var(--jtype)">${m}</span>`;
    return m;
  });
  // Annotations
  out = out.replace(/(@[A-Za-z]+)/g, '<span style="color:var(--jann)">$1</span>');
  // Nombres
  out = out.replace(/\b(\d+\.?\d*[LlFfDd]?)\b/g, '<span style="color:var(--jnum)">$1</span>');
  // Restore tokens
  toks.forEach((tok,idx) => { out = out.replace(new RegExp(`\x00T${idx}\x00`), tok); });
  return out;
}

/* ── Détection blocs Java ── */
const JAVA_SIG = [
  /\bpublic\b/,/\bprivate\b/,/\bprotected\b/,/\bclass\b/,/\bvoid\b/,
  /\breturn\b/,/\bnew\b/,/\bint\b/,/\bdouble\b/,/\bString\b/,
  /\bstatic\b/,/\bfor\s*\(/,/\bwhile\s*\(/,/\bif\s*\(/,
  /\/\//,/\{/,/\}/,/;$/,/\.\w+\(/,/extends\b/,/implements\b/,
  /\bimport\b/,/\bpackage\b/
];

function looksLikeCode(html){
  const text = html.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim();
  if (!text || text.length > 200) return false;
  const words = text.split(/\s+/).length;
  if (words > 15 && !/[{};]/.test(text)) return false;
  return JAVA_SIG.filter(re=>re.test(text)).length >= 1;
}

function pToText(p){
  return p.innerHTML
    .replace(/<a[^>]*id="[^"]*"[^>]*><\/a>/g,'')
    .replace(/&nbsp;/g,' ')
    .replace(/<\/?(?:strong|em|b|i|span)[^>]*>/g,'')
    .replace(/<[^>]+>/g,'')
    .trim();
}

function buildJavaBlock(pElements){
  const raw = pElements.map(pToText).join('\n');
  const div = document.createElement('div');
  div.className = 'java-block';

  const pre  = document.createElement('pre');
  const code = document.createElement('code');
  code.innerHTML = highlightJava(raw);
  pre.appendChild(code);

  // Header avec dots + label Java + bouton copier
  const hdr = document.createElement('div');
  hdr.className = 'java-block__header';
  hdr.innerHTML = `
    <div class="java-block__dots"><span></span><span></span><span></span></div>
    <span class="java-block__lang">Java</span>
    <button class="java-block__copy">Copier</button>`;

  hdr.querySelector('.java-block__copy').addEventListener('click', ()=>{
    const btn = hdr.querySelector('.java-block__copy');
    navigator.clipboard.writeText(code.innerText).then(()=>{
      btn.textContent = '✓ Copié'; btn.classList.add('copied');
      setTimeout(()=>{ btn.textContent='Copier'; btn.classList.remove('copied'); }, 2000);
    });
  });

  div.appendChild(hdr);
  div.appendChild(pre);
  return div;
}

function enhanceCodeBlocks(container){
  const children = Array.from(container.children);
  const out = document.createDocumentFragment();
  let i = 0;

  while (i < children.length) {
    const el = children[i];
    if (el.tagName === 'P' && looksLikeCode(el.innerHTML)) {
      const group = [];
      while (i < children.length && children[i].tagName === 'P' && looksLikeCode(children[i].innerHTML)){
        group.push(children[i]); i++;
      }
      out.appendChild(buildJavaBlock(group));
    } else {
      out.appendChild(el); i++;
    }
  }
  container.appendChild(out);
}

/* ── Tableaux de code (heritage, polymorphisme) ── */
function enhanceCodeTables(container){
  $$('table', container).forEach(table=>{
    const allText = $$('td', table).map(td=>td.innerText).join('\n');
    if (JAVA_SIG.filter(re=>re.test(allText)).length < 3) return;
    table.classList.add('code-table');
    $$('td', table).forEach(td=>{
      const lines = $$('p', td).map(pToText).filter(l=>l);
      if (!lines.length) return;
      const pre  = document.createElement('pre');
      const code = document.createElement('code');
      pre.style.cssText = 'margin:0;padding:0;background:transparent;border:0;font-family:inherit;font-size:inherit;color:inherit;white-space:pre-wrap';
      code.innerHTML = highlightJava(lines.join('\n'));
      pre.appendChild(code);
      td.innerHTML = '';
      td.appendChild(pre);
    });
  });
}

/* ── Amélioration images ── */
function enhanceImages(container){
  $$('img', container).forEach(img=>{
    const parent = img.parentElement;
    if (!parent || parent.classList.contains('img-figure')) return;

    const next = parent.nextElementSibling;
    let caption = null;
    if (next && next.tagName==='P') {
      const txt = next.textContent.trim();
      if (/^(Figure|Fig\.?)\s*\d+/i.test(txt) || (txt.length>5 && txt.length<140 && /^[A-ZÀÂÉÈÊËÎÏÔÙÛÜ0-9]/.test(txt))) {
        caption = txt;
        next.style.display = 'none';
      }
    }

    const figure = document.createElement('figure');
    figure.className = 'img-figure';
    parent.replaceWith(figure);
    figure.appendChild(img);

    if (caption) {
      const fc = document.createElement('figcaption');
      fc.textContent = caption;
      figure.appendChild(fc);
    }
  });
}

/* ── Numérotation titres ── */
function numberHeadings(tgt){
  try {
    const {moduleId} = parseHash();
    const modIndex = state.sections.findIndex(m=>{
      try { return new URL(m.href,location.href).hash.slice(1).split('--')[0]===moduleId; } catch{return false;}
    });
    const modNum = modIndex>=0 ? modIndex+1 : 0;
    const secBySlug = new Map();
    if (modIndex>=0 && Array.isArray(state.sections[modIndex].children)) {
      state.sections[modIndex].children.forEach((sec,i)=>{
        try {
          const parts = new URL(sec.href,location.href).hash.slice(1).split('--');
          if (parts[2]) secBySlug.set(parts[2], i+1);
        } catch {}
      });
    }
    tgt.querySelectorAll('h2[id^="sec-"]').forEach(h2=>{
      const slug = h2.id.replace(/^sec-/,'');
      const sn   = secBySlug.get(slug);
      if (modNum && sn && !h2.dataset.numbered) {
        if (!h2.firstElementChild?.classList.contains('sec-num')) {
          const sp=document.createElement('span'); sp.className='sec-num';
          sp.textContent=`${modNum}.${sn} `; h2.prepend(sp);
        }
        h2.dataset.numbered='true';
      }
    });
  } catch {}
}

/* ── Charge le contenu ── */
async function loadContent(){
  const tgt = document.getElementById('content');
  if (!tgt) return;
  const href = await resolvePageFromHash();
  if (!href){ tgt.innerHTML='<p style="opacity:.7;padding:2rem">Aucun contenu pour ce module.</p>'; return; }
  const r = await fetch(href,{cache:'no-store'});
  if (!r.ok){ tgt.innerHTML=`<p>Impossible de charger ${href}</p>`; return; }
  tgt.innerHTML = sanitizeFragment(await r.text());

  enhanceCodeTables(tgt);
  enhanceCodeBlocks(tgt);
  enhanceImages(tgt);
  numberHeadings(tgt);

  const {sectionSlug} = parseHash();
  await nextFrame();
  if (sectionSlug) {
    document.getElementById(`sec-${sectionSlug}`)?.scrollIntoView({behavior:'smooth',block:'start'});
  } else {
    window.scrollTo({top:0,behavior:'instant'});
  }
  highlightActive();
}

/* ── Toggle mobile ── */
function initSidebarToggle(){
  const el  = document.getElementById('sidebar');
  const btn = document.getElementById('openSidebar') || document.querySelector('.mobile-toggle');
  if (!btn || !el) return;
  const syncAria = ()=> btn.setAttribute('aria-expanded', String(el.classList.contains('open')));
  btn.addEventListener('click', e=>{ e.stopPropagation(); el.classList.toggle('open'); syncAria(); });
  document.getElementById('content')?.addEventListener('click', ()=>{ if(el.classList.contains('open')) el.classList.remove('open'); });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape'){el.classList.remove('open'); syncAria();} });
}

/* ── Boot ── */
(async function boot(){
  initSidebarToggle();
  await loadManifests();
  renderSidebar();
  await loadContent();
  window.addEventListener('hashchange', loadContent);
})();
