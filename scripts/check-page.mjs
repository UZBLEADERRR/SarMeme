/**
 * Dashboard sahifasidagi JavaScript'ni sintaksis bo'yicha tekshiradi.
 *
 * Nega kerak: `src/web/page.ts` — bu TypeScript template literal ichiga
 * joylashtirilgan HTML va JavaScript. TypeScript kompilyatori uning ICHINI
 * tekshirmaydi: qochirilmagan apostrof (`\'` o'rniga `\\'` kerak) yoki
 * tasodifiy `${` butun sahifani buzadi, lekin build muvaffaqiyatli o'tadi
 * va xato faqat brauzerda — bo'sh sahifa ko'rinishida namoyon bo'ladi.
 *
 * Aynan shunday xato bir marta Railway'ga chiqib ketgan. Bu tekshiruv
 * shuning takrorlanmasligi uchun.
 */
import { writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { PAGE } = await import('../dist/web/page.js');

const match = PAGE.match(/<script>([\s\S]*?)<\/script>/);
if (!match) {
  console.error('check-page: sahifada <script> bloki topilmadi');
  process.exit(1);
}

const tmp = join(tmpdir(), `sarmeme-page-${process.pid}.js`);
writeFileSync(tmp, match[1]);

try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  console.log('check-page: dashboard JS sintaksisi toza');
} catch (err) {
  console.error('\ncheck-page: DASHBOARD JS BUZUQ — sahifa brauzerda bo\'sh chiqadi\n');
  console.error(String(err.stderr ?? err));
  console.error(
    'Maslahat: page.ts template literal ichida apostrof `\\\\\'` bo\'lishi kerak,\n' +
      '`\\\'` emas. `${` ham qochirilishi shart.\n',
  );
  process.exit(1);
} finally {
  try {
    unlinkSync(tmp);
  } catch {
    // vaqtinchalik fayl o'chmasa muhim emas
  }
}
