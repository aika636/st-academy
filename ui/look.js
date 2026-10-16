import {
  materialById, materialCssPath, resolveMaterial, lookOf,
} from '../materials/index.mjs';

const IDS = {
  base: 'academy_diary_css',
  guard: 'academy_guard_css',
  material: 'academy_material_css',
  fonts: 'academy_fonts_css',
};

const ROOT = new URL('../', import.meta.url);

const hrefOf = (path) => new URL(path, ROOT).href;

function ensureLink(id, href) {
  if (typeof document === 'undefined' || !document.head || !document.createElement) return null;
  let link = document.getElementById ? document.getElementById(id) : null;
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('id', id);
    link.setAttribute('href', href);
    document.head.append(link);
    return link;
  }
  if (link.getAttribute && link.getAttribute('href') !== href) link.setAttribute('href', href);
  return link;
}

function dropLink(id) {
  const link = typeof document !== 'undefined' && document.getElementById ? document.getElementById(id) : null;
  if (link && link.remove) link.remove();
}

export function ensureLook(settings, preset) {
  const ui = (settings && settings.ui) || {};
  const id = resolveMaterial(ui, preset);
  ensureLink(IDS.base, hrefOf('diary.css'));
  ensureLink(IDS.material, hrefOf(materialCssPath(id)));
  ensureLink(IDS.guard, hrefOf('guard.css'));
  if ((materialById(id) || {}).fonts) ensureLink(IDS.fonts, hrefOf(`fonts/${id}.css`));
  else dropLink(IDS.fonts);
  return { mat: id, look: lookOf(ui) };
}

export function applyLook(panel, settings, preset) {
  const { mat, look } = ensureLook(settings, preset);
  if (panel) {
    panel.dataset.mat = mat;
    panel.dataset.look = look;
  }
  return mat;
}
