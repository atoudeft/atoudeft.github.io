/* ============================================================
   app.js — INF111 Programmation orientée objet
   ============================================================ */

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const state = { sections: [], modules: null };

/* ── Fetch helpers ── */
async function fetchJson(urls) {
  for (const u of urls) {
    try { const r = await fetch(u,{cache:'no-store'}); if(r.ok) return r.json(); } catch(e){}
  }
  return null;
}
async function loadManifests(){
  state.sections = await fetchJson(['assets/sections.json','sections.json']) || [];
  state.modules  = await fetchJson(['assets/modules.json','modules.json']) || {modules:[]};
}

/* ── Sidebar ── */
function renderSidebar(){
  const root = document.getElementById('sidebar-list');
  if (!root) return;
  root.innerHTML = '';
  state.sections.forEach((mod, mi) => {
    const li = document.createElement('li');
    const a  = document.createElement('a');
    a.textContent = mod.title;
    a.href = mod.href;
    a.addEventListener('click', e => {
      e.preventDefault();
      location.hash = new URL(a.href, location.href).hash;
      loadContent();
      document.getElementById('sidebar')?.classList.remove('open');
    });
    li.appendChild(a);
    if (Array.isArray(mod.children) && mod.children.length) {
      const ul = document.createElement('ul');
      mod.children.forEach((sec, si) => {
        const sli = document.createElement('li');
        const sa  = document.createElement('a');
        sa.textContent = `${mi+1}.${si+1} ${sec.title}`;
        sa.href = sec.href;
        sa.addEventListener('click', e => {
          e.preventDefault();
          location.hash = new URL(sa.href, location.href).hash;
          loadContent();
          document.getElementById('sidebar')?.classList.remove('open');
        });
        sli.appendChild(sa);
        ul.appendChild(sli);
      });
      li.appendChild(ul);
    }
    root.appendChild(li);
  });
  highlightActive();
}

function highlightActive(){
  const hash = location.hash;
  $$('#sidebar-list a').forEach(a =>
    a.classList.toggle('active', a.getAttribute('href').endsWith(hash)));
}

/* ── Routing ── */
function sanitizeFragment(html){
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  doc.querySelectorAll('script,style,link[rel="stylesheet"]').forEach(el=>el.remove());
  return doc.body.firstElementChild?.innerHTML ?? html;
}
function parseHash(){
  const raw = (location.hash||'').slice(1);
  if (!raw) return {moduleId:null,pageSlug:null,sectionSlug:null};
  const [moduleId=null, pageSlug=null, sectionSlug=null] = raw.split('--');
  return {moduleId, pageSlug, sectionSlug};
}
async function resolvePageFromHash(){
  const {moduleId, pageSlug} = parseHash();
  const mods = state.modules.modules || [];
  let m = mods.find(x => x.id===moduleId || x.href?.endsWith('#'+moduleId)) ?? mods[0];
  if (!m) return null;
  if (pageSlug) { const p = m.pages?.find(p=>p.slug===pageSlug); if(p) return p.href; }
  return m.pages?.[0]?.href ?? null;
}
const nextFrame = () => new Promise(r => requestAnimationFrame(()=>r()));

/* ============================================================
   COLORATION SYNTAXIQUE JAVA
   ============================================================ */
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
  while (i < raw.length){
    if (raw[i]==='/' && raw[i+1]==='/'){
      let end = raw.indexOf('\n',i); if(end===-1) end=raw.length;
      toks.push(`<span class="jcmt">${escH(raw.slice(i,end))}</span>`);
      out+=`\x00T${toks.length-1}\x00`; i=end; continue;
    }
    if (raw[i]==='/' && raw[i+1]==='*'){
      let end=raw.indexOf('*/',i+2); if(end===-1) end=raw.length-2;
      toks.push(`<span class="jcmt">${escH(raw.slice(i,end+2))}</span>`);
      out+=`\x00T${toks.length-1}\x00`; i=end+2; continue;
    }
    if (raw[i]==='"'){
      let j=i+1;
      while(j<raw.length && !(raw[j]==='"' && raw[j-1]!=='\\')) j++;
      toks.push(`<span class="jstr">${escH(raw.slice(i,j+1))}</span>`);
      out+=`\x00T${toks.length-1}\x00`; i=j+1; continue;
    }
    if (raw[i]==="'" && i+2<raw.length && raw[i+2]==="'"){
      toks.push(`<span class="jstr">${escH(raw.slice(i,i+3))}</span>`);
      out+=`\x00T${toks.length-1}\x00`; i+=3; continue;
    }
    out+=raw[i]; i++;
  }
  out = out.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, m => {
    if (JAVA_KW.has(m)) return `<span class="jkw">${m}</span>`;
    if (/^[A-Z][a-zA-Z0-9_]+$/.test(m)) return `<span class="jtype">${m}</span>`;
    return m;
  });
  out = out.replace(/(@[A-Za-z]+)/g, '<span class="jann">$1</span>');
  out = out.replace(/\b(\d+\.?\d*[LlFfDd]?)\b/g,'<span class="jnum">$1</span>');
  toks.forEach((tok,idx) => { out=out.replace(new RegExp(`\x00T${idx}\x00`), tok); });
  return out;
}

/* ============================================================
   DÉTECTION DES BLOCS DE CODE JAVA — ALGORITHME AMÉLIORÉ
   
   Stratégie :
   1. Chaque <p> reçoit un score "code" basé sur des signaux forts/faibles
   2. Une ligne de prose COURTE (<= 80 chars, pas de verbe) entourée de
      lignes code est "absorbée" dans le bloc (connector line)
   3. Les blocs avec score moyen >= seuil sont transformés en code
   ============================================================ */

/* Nettoie le HTML d'un <p> → texte brut */
function pToPlain(p){
  return p.innerHTML
    .replace(/<a\s[^>]*id="[^"]*"[^>]*><\/a>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/* Signaux FORTS : présence = c'est du code avec certitude */
const STRONG_SIG = [
  /\bpublic\b/, /\bprivate\b/, /\bprotected\b/,
  /\bclass\b/,  /\bvoid\b/,    /\bstatic\b/,
  /\breturn\b/, /\bnew\b/,     /\bextends\b/, /\bimplements\b/,
  /\bimport\b/, /\bpackage\b/, /\binterface\b/,
  /\bfor\s*\(/, /\bwhile\s*\(/, /\bif\s*\(/, /\belse\s*\{/,
  /\/\//,       /^\s*[{}]\s*$/, /;\s*$/,
  /\b(int|double|float|long|byte|char|boolean)\b.*[=;(]/,
  /\.\w+\s*\(/,
  /* class names moved to WEAK to avoid false positives in prose */
  /\binstanceof\b/, /\bsuper\s*\(/, /\bthis\s*\./,
  /\btry\s*\{/, /\bcatch\s*\(/, /\bthrow\b/,
  /\bString\s*\[/, /\bint\s*\[/, /\bdouble\s*\[/,
  /@Override/, /@SuppressWarnings/,
];

/* Signaux FAIBLES : présence seule ne suffit pas, mais renforcent le score */
const WEAK_SIG = [
  /^[A-Za-z<>\[\]]+\s+\w+\s*\(.*\)\s*$/,   /* signature de méthode */
  /^[a-zA-Z_]\w*\s*=\s*\S/,                  /* affectation: x = ... */
  /^[A-Z]\w+\s+[a-z]\w{1,}[;,=(\[{]/,  /* CapType varName; déclaration */
  /^[a-z]\w*\.[a-z]\w*/,                     /* obj.attribute */
  /[A-Za-z]\w*\s*\[\s*\]/,                   /* array brackets with identifier */
  /<[A-Z]\w*>/,                              /* generics <Type> */
  /\([A-Za-z]\w*\s+\w+\)/,                  /* (Type param) in signature */
  /^\+\s*\"/,                                /* string concat continuation */
  /\b(ArrayList|Vector|HashMap|Scanner|Iterator|ListIterator)\b.*[;(<.=]/,  /* class name in code context */
];

/* Score d'une ligne : 2 = fort, 1 = faible, 0 = prose */
function lineScore(text){
  if (!text || text.length === 0) return 0;
  if (text.length > 200) return 0;
  // Très long avec mots courants = prose certaine
  const words = text.split(/\s+/).length;
  if (words > 18 && !/[{};]/.test(text)) return 0;
  if (STRONG_SIG.some(re => re.test(text))) return 2;
  if (WEAK_SIG.some(re => re.test(text)))   return 1;
  return 0;
}

/* Teste si une ligne est un "connecteur" (prose courte intercalée) */
function isConnector(text){
  if (!text || text.length > 90) return false;
  // Typiquement: "Et à l'instanciation :", "On peut insérer dans v2 des entiers :"
  // Caractéristiques: se termine par ":", est courte, pas de signaux code
  if (lineScore(text) > 0) return false;
  if (/:\s*$/.test(text) && text.split(/\s+/).length <= 14) return true;
  // "Remarque : ..." court
  if (/^Remarque\b/.test(text) && text.length < 40) return true;
  return false;
}

/* Regroupe les <p> en blocs code/prose en tenant compte des connecteurs */
function groupParagraphs(container){
  const children = Array.from(container.children);
  const scored = children.map(el => {
    if (el.tagName !== 'P') return { el, score: -1, text: '' }; // not a <p>
    const text = pToPlain(el);
    return { el, score: lineScore(text), text };
  });

  const result = [];
  let i = 0;

  while (i < scored.length){
    const item = scored[i];

    // Non-<p> element: pass through
    if (item.score === -1){ result.push({type:'other', els:[item.el]}); i++; continue; }

    // Potential code block: score >= 1
    if (item.score >= 1){
      const block = [item];
      i++;

      while (i < scored.length){
        const cur = scored[i];
        if (cur.score === -1) break; // hit a non-<p>, end block

        if (cur.score >= 1){
          // Direct code line: absorb
          block.push(cur); i++;
        } else if (isConnector(cur.text)){
          // Connector prose: peek ahead to see if code follows
          const next = scored[i+1];
          if (next && next.score >= 1){
            // Absorb connector + next code line
            block.push(cur);  // connector (will be shown as comment-like)
            i++;
          } else {
            break; // connector at end of block = stop
          }
        } else {
          break; // real prose: end of block
        }
      }

      // Only make a java-block if we have at least 1 strong signal in the group
      const hasStrong = block.some(b => b.score === 2);
      if (hasStrong){
        result.push({type:'code', els: block.map(b=>b.el), texts: block.map(b=>b.text)});
      } else {
        // Weak-only group: pass through as-is
        block.forEach(b => result.push({type:'other', els:[b.el]}));
      }
    } else {
      result.push({type:'other', els:[item.el]}); i++;
    }
  }

  return result;
}

/* Reconstruit le DOM avec les blocs Java */
function buildJavaBlock(texts){
  // Joindre les lignes; les connecteurs (score=0 dans le bloc) deviennent des commentaires légers
  const raw = texts.join('\n');

  const div = document.createElement('div');
  div.className = 'java-block';

  const hdr = document.createElement('div');
  hdr.className = 'java-block__header';
  hdr.innerHTML = `
    <div class="java-block__dots"><span></span><span></span><span></span></div>
    <span class="java-block__lang">Java</span>
    <button class="java-block__copy">Copier</button>`;
  div.appendChild(hdr);

  const pre  = document.createElement('pre');
  const code = document.createElement('code');
  code.innerHTML = highlightJava(raw);
  pre.appendChild(code);
  div.appendChild(pre);

  hdr.querySelector('.java-block__copy').addEventListener('click', () => {
    const btn = hdr.querySelector('.java-block__copy');
    navigator.clipboard.writeText(code.innerText).then(() => {
      btn.textContent = '✓ Copié'; btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copier'; btn.classList.remove('copied'); }, 2000);
    });
  });

  return div;
}

function enhanceCodeBlocks(container){
  const groups = groupParagraphs(container);
  container.innerHTML = '';
  const frag = document.createDocumentFragment();
  groups.forEach(g => {
    if (g.type === 'code'){
      frag.appendChild(buildJavaBlock(g.texts));
    } else {
      g.els.forEach(el => frag.appendChild(el));
    }
  });
  container.appendChild(frag);
}

/* ── Tableaux contenant du code Java ── */
function enhanceCodeTables(container){
  $$('table', container).forEach(table => {
    const allText = $$('td', table).map(td => td.innerText).join('\n');
    const strongCount = STRONG_SIG.filter(re => re.test(allText)).length;
    if (strongCount < 2) return;
    table.classList.add('code-table');
    $$('td', table).forEach(td => {
      const lines = $$('p', td).map(p => pToPlain(p)).filter(l => l);
      if (!lines.length) return;
      const pre  = document.createElement('pre');
      const code = document.createElement('code');
      pre.style.cssText='margin:0;padding:0;background:transparent;border:0;font-family:inherit;font-size:inherit;color:inherit;white-space:pre-wrap';
      code.innerHTML = highlightJava(lines.join('\n'));
      pre.appendChild(code);
      td.innerHTML = '';
      td.appendChild(pre);
    });
  });
}

/* ── Images ── */
function enhanceImages(container){
  $$('img', container).forEach(img => {
    const parent = img.parentElement;
    if (!parent || parent.tagName === 'FIGURE') return;

    // Caption: next <p> that looks like "Figure N. ..."
    const next = parent.nextElementSibling;
    let caption = null;
    if (next && next.tagName === 'P'){
      const txt = next.textContent.trim();
      if (/^(Figure|Fig\.?)\s*\d+/i.test(txt) || (txt.length > 4 && txt.length < 140)){
        caption = txt;
        next.style.display = 'none';
      }
    }

    const figure = document.createElement('figure');
    figure.className = 'img-figure';
    parent.replaceWith(figure);
    figure.appendChild(img);

    if (caption){
      const fc = document.createElement('figcaption');
      fc.textContent = caption;
      figure.appendChild(fc);
    }
  });
}

/* ── Numérotation des H2 ── */
function numberHeadings(tgt){
  try {
    const {moduleId} = parseHash();
    const modIdx = state.sections.findIndex(m => {
      try { return new URL(m.href,location.href).hash.slice(1).split('--')[0]===moduleId; }
      catch { return false; }
    });
    const modNum = modIdx >= 0 ? modIdx+1 : 0;
    const secBySlug = new Map();
    if (modIdx >= 0 && Array.isArray(state.sections[modIdx].children)){
      state.sections[modIdx].children.forEach((sec,i) => {
        try {
          const slug = new URL(sec.href,location.href).hash.slice(1).split('--')[2];
          if (slug) secBySlug.set(slug, i+1);
        } catch {}
      });
    }
    tgt.querySelectorAll('h2[id^="sec-"]').forEach(h2 => {
      const slug = h2.id.replace(/^sec-/,'');
      const sn   = secBySlug.get(slug);
      if (modNum && sn && !h2.dataset.numbered){
        if (!h2.firstElementChild?.classList.contains('sec-num')){
          const sp = document.createElement('span');
          sp.className = 'sec-num';
          sp.textContent = `${modNum}.${sn} `;
          h2.prepend(sp);
        }
        h2.dataset.numbered = 'true';
      }
    });
  } catch {}
}

/* ── Chargement du contenu ── */
async function loadContent(){
  const tgt = document.getElementById('content');
  if (!tgt) return;
  const href = await resolvePageFromHash();
  if (!href){ tgt.innerHTML='<p style="opacity:.6;padding:2rem">Aucun contenu pour ce module.</p>'; return; }
  const r = await fetch(href, {cache:'no-store'});
  if (!r.ok){ tgt.innerHTML=`<p>Erreur lors du chargement de ${href}</p>`; return; }
  tgt.innerHTML = sanitizeFragment(await r.text());

  enhanceCodeTables(tgt);
  enhanceCodeBlocks(tgt);
  enhanceImages(tgt);
  numberHeadings(tgt);

  const {sectionSlug} = parseHash();
  await nextFrame();
  if (sectionSlug){
    document.getElementById(`sec-${sectionSlug}`)
      ?.scrollIntoView({behavior:'smooth', block:'start'});
  } else {
    window.scrollTo({top:0, behavior:'instant'});
  }
  highlightActive();
}

/* ── Mobile sidebar ── */
function initSidebarToggle(){
  const el  = document.getElementById('sidebar');
  const btn = document.getElementById('openSidebar') || document.querySelector('.mobile-toggle');
  if (!btn || !el) return;
  const syncAria = () => btn.setAttribute('aria-expanded', String(el.classList.contains('open')));
  btn.addEventListener('click', e => { e.stopPropagation(); el.classList.toggle('open'); syncAria(); });
  document.getElementById('content')?.addEventListener('click', () => {
    if (el.classList.contains('open')) el.classList.remove('open');
  });
  document.addEventListener('keydown', e => {
    if (e.key==='Escape'){ el.classList.remove('open'); syncAria(); }
  });
}

/* ── Boot ── */
(async function boot(){
  initSidebarToggle();
  await loadManifests();
  renderSidebar();
  await loadContent();
  window.addEventListener('hashchange', loadContent);
})();
