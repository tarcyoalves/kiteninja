/**
 * Mede vazamento horizontal do painel admin num viewport de celular.
 *
 * POR QUE ESTA FERRAMENTA EXISTE
 *
 * O dono relatou o painel "meio solto, com scrolls laterais". Nenhuma
 * verificação do projeto consegue ver isso: tsc, lint, vitest e a varredura de
 * SQL não renderizam nada, e o Vitest roda em `environment: 'node'`, sem DOM.
 * Layout quebrado atravessa o pipeline inteiro verde.
 *
 * Este script abre o painel de verdade num Chromium a 390px de largura, com
 * dados adversariais (e-mail sem espaço, título de uma palavra só, URL longa
 * colada num chamado, nome de admin comprido) e mede
 * `scrollWidth > clientWidth`. Foi assim que a barra de abas apareceu ocupando
 * 474px numa tela de 390 — a causa principal do relato.
 *
 * COMO RODAR (precisa de servidor e do Playwright, que NÃO é dependência do
 * projeto de propósito — carregá-lo em todo deploy da Vercel não se paga):
 *
 *   npm i -D playwright
 *   npx next dev -p 3111
 *   # criar uma rota temporária que renderize <AdminDashboard adminName="..." />
 *   node scripts/medir-overflow.mjs http://localhost:3111
 *
 * As chamadas de /api/admin sao interceptadas aqui, entao nao precisa de banco
 * nem de sessao de admin.
 *
 * Sai com codigo 1 se qualquer aba vazar — da para usar em CI se um dia
 * houver um ambiente com navegador.
 */
import { chromium } from 'playwright';

const USUARIOS = {
  total: 3,
  stats: { totalUsers: 3, activeUsers: 2, onlineNow: 1, activeToday: 2, activeWeek: 3, totalSessions: 12, totalPosts: 4, totalMessages: 88 },
  users: [{
    id: '1', name: 'Jefferson Pontes de Albuquerque Filho',
    email: 'jefferson.pontes.albuquerque.filho@umprovedormuitolongo.com.br',
    role: 'rider', riderId: '0042', riderLevel: 'Avançado', countryFlag: '🇧🇷',
    homeSpot: 'Barra de Pernambuquinho', isOnline: true, isActive: true,
    lastSeenAt: new Date().toISOString(),
    lastUserAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    avatarUrl: null, totalSessions: 12, totalPosts: 4, totalMessages: 88,
  }],
};
const CHAMADOS = { chamados: [{
  id: 'c1', autorNome: 'Maria Aparecida dos Santos Nascimento', autorAvatarUrl: null,
  tipo: 'bug', titulo: 'Erroaoabriromapaquandoonomeeumapalavraunicagigantesca',
  descricao: 'Acontece nesta URL: https://kiteninja.vercel.app/dw-live/8f3c1a2b-4d5e-6f70-8192-a3b4c5d6e7f8?debug=true&trace=abcdefghijklmnop',
  tela: '/dw-live/8f3c1a2b-4d5e-6f70-8192-a3b4c5d6e7f8', status: 'aberto', parecer: null,
  createdAt: new Date().toISOString(),
}]};
const CONVITES = { invites: [{ id: 'i1', email: 'convidado.com.email.bem.comprido@exemplo.com.br', note: 'Amigo do Jefferson', expiresAt: new Date(Date.now()+864e5).toISOString(), usedAt: null, usedByName: null, status: 'aberto' }] };
const VIDEOS = { config: { modo: 'rodizio', videos: [{ id: 'v1', url: 'https://x/y.mp4', titulo: 'NomeDeArquivoAbsurdamenteLongoSemEspacoNenhumParaQuebrar.mp4', inicioSeg: 0, fimSeg: 8, ativo: true, nomeArquivo: 'a.mp4', posterUrl: null, duracaoSeg: 30 }] }, maxBytes: 52428800, maxTrechoSeg: 15 };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

await page.route('**/api/admin/users**', r => r.fulfill({ json: USUARIOS }));
await page.route('**/api/admin/chamados**', r => r.fulfill({ json: CHAMADOS }));
await page.route('**/api/admin/invites**', r => r.fulfill({ json: CONVITES }));
await page.route('**/api/admin/intro-video**', r => r.fulfill({ json: VIDEOS }));

const base = process.argv[2];
await page.goto(`${base}/preview-admin-tmp`, { waitUntil: 'networkidle' });

const abas = [['convites','Convites'],['usuarios','Monitoramento'],['abertura','Abertura'],['chamados','Chamados']];
let houveFalha = false;
for (const [slug, rotulo] of abas) {
  await page.getByRole('button', { name: rotulo, exact: false }).first().click();
  await page.waitForTimeout(700);
  const m = await page.evaluate(() => {
    const d = document.documentElement;
    const alvos = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 1 || r.left < -1) {
        alvos.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 70), right: Math.round(r.right) });
      }
    }
    const rolavel = document.querySelector('.app-scroll');
    return {
      docScrollW: d.scrollWidth, docClientW: d.clientWidth,
      scrollW: rolavel ? rolavel.scrollWidth : 0, clientW: rolavel ? rolavel.clientWidth : 0,
      vazando: alvos.slice(0, 4),
    };
  });
  const vaza = m.scrollW > m.clientW + 1 || m.docScrollW > m.docClientW + 1;
  if (vaza) houveFalha = true;
  console.log(`${vaza ? 'VAZA ' : 'ok   '} ${rotulo.padEnd(15)} doc=${m.docScrollW}/${m.docClientW}  scroll=${m.scrollW}/${m.clientW}`);
  if (vaza) for (const a of m.vazando) console.log(`        ${a.tag} right=${a.right} :: ${a.cls}`);
  await page.screenshot({ path: `/tmp/claude-0/-home-user-kiteninja/d15e2ecb-66ac-59a1-888b-051f74a097f4/scratchpad/admin-${slug}.png`, fullPage: true });
}
await browser.close();
process.exit(houveFalha ? 1 : 0);
