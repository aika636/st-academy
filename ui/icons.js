export const LAUNCHER_ICONS = {
  diary: {
    name: 'Ежедневник',
    note: 'с закладкой',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">'
      + '<rect x="5" y="3" width="15" height="18" rx="3" fill="currentColor" opacity=".12"/>'
      + '<rect x="5" y="3" width="15" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>'
      + '<path d="M3 7h4M3 12h4M3 17h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
      + '<path d="M13 4v7l2-1.5 2 1.5V4" fill="currentColor"/>'
      + '<path d="M10 16h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
      + '</svg>',
  },
  quill: {
    name: 'Перо',
    note: 'над строкой',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="M20 3C14 2 8 8 9 14C15 16 22 9 20 3Z" fill="currentColor" opacity=".18"/>'
      + '<path d="M20 3C14 2 8 8 9 14C15 16 22 9 20 3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'
      + '<path d="M4 21 17 8M12 21h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
      + '</svg>',
  },
  crest: {
    name: 'Герб',
    note: 'с книгой',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="M12 2 21 5v6c0 5-4 9-9 11-5-2-9-6-9-11V5Z" fill="currentColor" opacity=".12"/>'
      + '<path d="M12 2 21 5v6c0 5-4 9-9 11-5-2-9-6-9-11V5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'
      + '<path d="M6.5 8Q9 7 12 9q3-2 5.5-1v6Q15 13 12 15q-3-2-5.5-1Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'
      + '<path d="M12 9v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
      + '</svg>',
  },
};

export const LAUNCHER_ICON_IDS = Object.keys(LAUNCHER_ICONS);
export const DEFAULT_LAUNCHER_ICON = 'diary';

export function launcherIconOf(ui) {
  const id = ui && ui.launcherIcon;
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(LAUNCHER_ICONS, id) ? id : DEFAULT_LAUNCHER_ICON;
}
