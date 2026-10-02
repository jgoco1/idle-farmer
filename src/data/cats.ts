// The farm cats (GDD §12.2): purely cosmetic. Every farm starts with a brown tabby asleep by the
// farmhouse door; the others are adopted in the Shop's Decor tab and take turns in the same spot.
// They never give charm, gold or anything else.

import type { CatId } from './ids';
import type { CatDef } from './types';

const cat = (id: CatId, name: string, price: number, description: string): CatDef => ({
  id,
  name,
  description,
  price,
  sprite: `obj_${id}_sleep`,
});

export const CATS: Readonly<Record<CatId, CatDef>> = {
  cat_tabby: cat('cat_tabby', 'Brown Tabby', 0, 'Standard issue: every farm comes with one.'),
  cat_orange: cat('cat_orange', 'Orange Tabby', 2_000, 'A marmalade cat who naps in any patch of sun.'),
  cat_black: cat('cat_black', 'Black Cat', 2_000, 'Sleek as a shadow, and lucky for the mice.'),
  cat_silver: cat('cat_silver', 'Silver Tabby', 4_000, 'Grey stripes like a rainy morning.'),
  cat_tuxedo: cat('cat_tuxedo', 'Tuxedo Cat', 4_000, 'Always dressed for dinner.'),
  cat_siamese: cat('cat_siamese', 'Siamese', 8_000, 'Cream coat, dark points, and a lot to say.'),
  cat_calico: cat('cat_calico', 'Calico', 8_000, 'A patchwork of white, ginger and black.'),
};
