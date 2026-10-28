// tsc does not copy the SVG icons n8n loads with `icon: 'file:grades.svg'`: copy them next to the compiled files.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

for (const dir of ['credentials', 'nodes/Grades', 'nodes/GradesTrigger']) {
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.svg'))) {
    const target = join('dist', dir, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(dir, file), target);
  }
}
console.log('icons copied');
