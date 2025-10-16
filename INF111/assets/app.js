/* Utils */
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/* État */
const state = { sections: [], modules: null };

/* Fetch JSON helper (no-store pour éviter cache en dev) */
async function fetchJson(urls) {
  for (const u of urls) {
    try {
      const r = await fetch(u, {cache:'no-store'});
      if (r.ok) return r.json();
    } catch(e) {}
  }
  return null;
}

/* Charge les manifests */
async function loadManifests(){
  const sections = await fetchJson(['assets/sections.json','sections.json']) || [];
  const modules = await fetchJson(['assets/modules.json','modules.json']) || { modules: [] };
  state.sections = sections;
  state.modules = modules;
}

/* Construit le menu gauche */
function renderSidebar(){
  const root = document.getElementById('sidebar-list');
  if (!root) return;
  root.innerHTML = '';

  // on part de l'ordre de state.sections (modules)
  state.sections.forEach((mod, modIdx0) => {
    const modLi = document.createElement('li');

    // Lien du MODULE (on garde le titre tel quel ; si tu veux "1. ", dé-commente la ligne marquée)
    const modA = document.createElement('a');
    // modA.textContent = `${modIdx0+1}. ${mod.title}`; // ← active si tu veux numéroter aussi les modules
    modA.textContent = mod.title;
    modA.href = mod.href;
    modA.addEventListener('click', (e) => {
      e.preventDefault();
      const url = new URL(modA.href, location.href);
      location.hash = url.hash;
      loadContent();
      const sidebar = document.getElementById('sidebar');
      if (sidebar && sidebar.classList.contains('open')) sidebar.classList.remove('open');
    });
    modLi.appendChild(modA);

    // SECTIONS (Titre2) numérotées  <moduleIndex>.<sectionIndex>
    if (Array.isArray(mod.children) && mod.children.length) {
      const ul = document.createElement('ul');
      mod.children.forEach((sec, secIdx0) => {
        const li = document.createElement('li');
        const a  = document.createElement('a');
        a.textContent = `${modIdx0+1}.${secIdx0+1} ${sec.title}`;
        a.href = sec.href;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          const url = new URL(a.href, location.href);
          location.hash = url.hash;
          loadContent();
          const sidebar = document.getElementById('sidebar');
          if (sidebar && sidebar.classList.contains('open')) sidebar.classList.remove('open');
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



/* Met en surbrillance l’élément actif */
function highlightActive(){
  const hash = location.hash;
  $$('#sidebar-list a').forEach(a => a.classList.toggle('active', a.getAttribute('href').endsWith(hash)));
}

/* Sanitize du fragment HTML des pages */
function sanitizeFragment(html){
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  doc.querySelectorAll('script, style, link[rel="stylesheet"]').forEach(el=>el.remove());
  return doc.body.firstElementChild ? doc.body.firstElementChild.innerHTML : html;
}

/* Parse hash #module--page--section */
function parseHash(){
  const raw = (location.hash || '').slice(1);
  if (!raw) return { moduleId:null, pageSlug:null, sectionSlug:null };
  const parts = raw.split('--');
  return { moduleId: parts[0]||null, pageSlug: parts[1]||null, sectionSlug: parts[2]||null };
}

/* Résout l’URL de la page à charger depuis le hash */
async function resolvePageFromHash(){
  const { moduleId, pageSlug } = parseHash();
  const mods = state.modules.modules || [];
  let m = mods.find(x => x.id === moduleId || (typeof x.href==='string' && x.href.endsWith('#'+moduleId)));
  if (!m) m = mods[0];
  if (!m) return null;

  if (pageSlug) {
    const p = (m.pages || []).find(p => p.slug === pageSlug);
    if (p) return p.href;
  }
  const page = (m.pages || [])[0];
  return page ? page.href : null;
}

/* Attente d’un rafraîchissement de frame */
function nextFrame(){ return new Promise(r => requestAnimationFrame(()=>r())); }

/* Charge le contenu dans main#content */
async function loadContent(){
  const tgt = document.getElementById('content');
  if (!tgt) return;
  const href = await resolvePageFromHash();
  if (!href){ tgt.innerHTML = '<p style="opacity:.7">Aucun contenu</p>'; return; }
  const r = await fetch(href, {cache:'no-store'});
  if (!r.ok){ tgt.innerHTML = `<p>Impossible de charger ${href}</p>`; return; }
  const html = await r.text();
  tgt.innerHTML = sanitizeFragment(html);

  // === Numérotation des H2 correspondant aux sections du menu ===
  try {
    // 1) Identifier le module courant + construire un index { sectionSlug -> N }
    const { moduleId } = parseHash();
    const modIndex = state.sections.findIndex(m => {
      try {
        const u = new URL(m.href, location.href);
        return u.hash.slice(1).split('--')[0] === moduleId;
      } catch { return false; }
    });
    const modNum = modIndex >= 0 ? modIndex + 1 : 0;

    const secNumberBySlug = new Map();
    if (modIndex >= 0 && Array.isArray(state.sections[modIndex].children)) {
      state.sections[modIndex].children.forEach((sec, i) => {
        // href type: #module--page--section
        try {
          const u = new URL(sec.href, location.href);
          const parts = u.hash.slice(1).split('--');
          const sectionSlug = parts[2]; // "section"
          if (sectionSlug) secNumberBySlug.set(sectionSlug, i + 1);
        } catch {}
      });
    }

    // 2) Préfixer les titres de sections présents dans la page (H2 avec id="sec-<slug>")
    tgt.querySelectorAll('h2[id^="sec-"]').forEach(h2 => {
      const slug = h2.id.replace(/^sec-/, '');
      const secNum = secNumberBySlug.get(slug);
      if (modNum && secNum && !h2.dataset.numbered) {
        const label = `${modNum}.${secNum} `;
        // évite de dupliquer au rechargement
        if (!h2.firstElementChild || !h2.firstElementChild.classList.contains('sec-num')) {
          const span = document.createElement('span');
          span.className = 'sec-num';
          span.textContent = label;
          h2.prepend(span);
        }
        h2.dataset.numbered = 'true';
      }
    });
  } catch {}

  const { sectionSlug } = parseHash();
  await nextFrame();
  if (sectionSlug) {
    const el = document.getElementById(`sec-${sectionSlug}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    window.scrollTo({top:0, behavior:'instant'});
  }

  highlightActive();
}


/* Toggle mobile: un seul mécanisme basé sur .open */
function initSidebarToggle(){
  const el  = document.getElementById('sidebar');
  const btn = document.getElementById('openSidebar') || document.querySelector('.mobile-toggle');
  if (!btn || !el) return;

  // helper pour garder ARIA en phase avec l'état visuel
  function syncAria() {
    if (!btn) return;
    const isOpen = el.classList.contains('open');
    btn.setAttribute('aria-expanded', String(isOpen));
    // si tu n'as pas mis ces attributs en HTML, on les ajoute au besoin :
    if (!btn.hasAttribute('aria-controls')) btn.setAttribute('aria-controls', 'sidebar');
  }

  btn.addEventListener('click', (e)=> {
    e.stopPropagation();
    el.classList.toggle('open');
    syncAria();
  });

  // Fermer en cliquant dans le contenu en mobile
  document.getElementById('content')?.addEventListener('click', () => {
    if (el.classList.contains('open')) el.classList.remove('open');
  });

  // Fermer à l’échappement
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { 
      el.classList.remove('open');
      syncAria();
    }
  });
}

/* Boot */
(async function boot(){
  initSidebarToggle();
  await loadManifests();
  renderSidebar();
  await loadContent();
  window.addEventListener('hashchange', loadContent);
})();
