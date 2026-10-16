export const TAVERN_ID = 'tavern';

export const MATERIALS = [
  { id: "notebook", name: "Тетрадь", note: "школа, вуз", sw: ["#286448","#FFFEF8","#C12D38"], ink: "#283247",
    fonts: "https://fonts.googleapis.com/css2?family=Bad+Script&family=Golos+Text:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap" },
  { id: "diary-ru", name: "Ежедневник", note: "российский вуз", sw: ["#1f4a3d","#f7f2e4","#9c2a3a"], ink: "#26231f",
    fonts: "https://fonts.googleapis.com/css2?family=Bad+Script&family=Golos+Text:wght@400;500;600;700&family=Literata:wght@400;600;700&family=Playfair+Display:wght@600;700&family=PT+Serif:wght@400;700&family=Caveat:wght@500;700&family=IBM+Plex+Mono:wght@400;600&display=swap" },
  { id: "planner-jp", name: "Школьный планер", note: "японская школа", sw: ["#41666b","#fffdf8","#e496ad"], ink: "#2a3736",
    fonts: "https://fonts.googleapis.com/css2?family=Neucha&family=Nunito:wght@400;500;600;700;800&family=Caveat:wght@500;700&family=IBM+Plex+Mono:wght@400;600&display=swap" },
  { id: "spiral-us", name: "Пружинный планер", note: "американская школа", sw: ["#1c3578","#fdfdf8","#f7bf2e"], ink: "#1b2233",
    fonts: "https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Nunito:wght@400;500;600;700;800&family=Oswald:wght@500;600;700&family=PT+Serif:wght@400;700&family=IBM+Plex+Mono:wght@400;600&display=swap" },
  { id: "rings-us", name: "Органайзер на кольцах", note: "американский колледж", sw: ["#46564c","#fcfbf5","#86502b"], ink: "#1f2c24",
    fonts: "https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Golos+Text:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,600;0,700;1,400&family=Literata:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&family=Bad+Script&family=Playfair+Display:wght@600;700&family=PT+Serif:wght@400;700&display=swap" },
  { id: "leather", name: "Кожаный блокнот", note: "тёмная академия", sw: ["#171514","#252321","#B49A65"], ink: "#E4DCCB",
    fonts: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=IBM+Plex+Mono:wght@400;600&display=swap" },
  { id: "grimoire", name: "Гримуар", note: "магическая академия", sw: ["#211522","#302735","#BDA46B"], ink: "#E8DECB",
    fonts: "https://fonts.googleapis.com/css2?family=Bad+Script&family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&family=PT+Serif:ital,wght@0,400;0,700;1,400&display=swap" },
  { id: "terminal", name: "Терминал", note: "космическая академия", sw: ["#222d39","#15222c","#99d9e8"], ink: "#edf4f6",
    fonts: "https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Exo+2:wght@600;700;800&family=Golos+Text:wght@400;500;600;700&family=PT+Serif:wght@400;700&family=IBM+Plex+Mono:wght@400;600&display=swap" },
  { id: "cadet", name: "Полевой планшет", note: "кадетская академия", sw: ["#4a5b3c","#e8e6da","#c9a227"], ink: "#26301f",
    fonts: "https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@400;500;600;700&family=Neucha&family=Oswald:wght@500;600;700&family=PT+Sans:wght@400;700&display=swap" },
  { id: "hero", name: "Тренировочный блокнот", note: "академия героев", sw: ["#b71c2c","#fffbef","#ffbe0b"], ink: "#1a2140",
    fonts: "https://fonts.googleapis.com/css2?family=Neucha&family=Rubik:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Russo+One&family=Caveat:wght@500;700&family=PT+Serif:wght@400;700&family=IBM+Plex+Mono:wght@400;600&display=swap" },
  { id: "xianxia", name: "Книжка-гармошка", note: "секта бессмертных", sw: ["#722C28","#F4EEDC","#B33A30"], ink: "#292923",
    fonts: "https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=PT+Serif:ital,wght@0,400;0,700;1,400&display=swap" },
  { id: "terminal-space", name: "Терминал: бортовой журнал", note: "космическая академия (надстройка)", sw: ["#34424d","#0f1b23","#ffb54a"], ink: "#e9f0f1",
    fonts: "https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Exo+2:wght@600;700;800&family=Golos+Text:wght@400;500;600;700&family=PT+Serif:wght@400;700&family=IBM+Plex+Mono:wght@400;600&display=swap" },
  { id: TAVERN_ID, name: 'Цвета таверны', note: 'как тема SillyTavern', sw: ['#2a2a2e', '#1c1c20', '#e18a24'], ink: '#dcdcd2', fonts: null, internal: true },
];

export const MATERIAL_IDS = MATERIALS.map((m) => m.id);

export const PICKABLE = MATERIALS.filter((m) => !m.internal);

export const LOOKS = ['diary', 'tavern'];

export const AUTO = 'auto';

export function materialById(id) {
  return MATERIALS.find((m) => m.id === id) || null;
}

export function materialCssPath(id) {
  return `materials/${id}.css`;
}

export function resolveMaterial(ui, preset) {
  const u = ui || {};
  if (u.look === 'tavern') return TAVERN_ID;
  if (typeof u.material === 'string' && u.material !== AUTO && materialById(u.material)) return u.material;
  const own = preset && preset.look && preset.look.material;
  return typeof own === 'string' && materialById(own) ? own : TAVERN_ID;
}

export function lookOf(ui) {
  return ui && ui.look === 'tavern' ? 'tavern' : 'diary';
}
