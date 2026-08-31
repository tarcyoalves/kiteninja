import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Trava para a classe de defeito mais cara já encontrada nesta base:
 * **um valor exposto num contexto e que nenhuma tela consome.**
 *
 * Ela já apareceu QUATRO vezes — `statusTrackingNativo`,
 * `zerarNotificacoesNaoLidas`, `latestIncomingDm` e, agora,
 * `downwinds` (a lista que não existia e cuja falta deixou um velejador sem
 * ver o downwind que ele mesmo criou).
 *
 * O que torna essa classe perigosa é que **nada a acusa**: o campo tem tipo,
 * é preenchido, é devolvido no `value` do provider. Build, typecheck, teste e
 * lint passam todos verdes. O único sintoma é a funcionalidade não existir na
 * tela — e ninguém descobre até um usuário reclamar.
 *
 * A regra que este teste aplica é a mesma que a revisão humana deveria: **ao
 * expor algo num contexto, mostre na mesma mudança quem consome.** Sem
 * consumidor, o valor é uma promessa que a interface não cumpre.
 */

const RAIZ = join(__dirname, '..');
const PASTAS_DE_CONSUMO = ['views', 'components', 'app', 'lib', 'context'];

function listarArquivos(dir: string, out: string[] = []): string[] {
  let entradas: string[];
  try {
    entradas = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entradas) {
    if (e === 'node_modules' || e === '.next') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) listarArquivos(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * Os campos declarados na interface do contexto.
 *
 * Lê a interface em vez do objeto `value` de propósito: é a interface que
 * promete o campo a quem consome, e é ela que fica desatualizada quando
 * alguém expõe algo e esquece de ligar na tela.
 */
function camposDaInterface(fonte: string, nomeInterface: string): string[] {
  const inicio = fonte.indexOf(`interface ${nomeInterface}`);
  if (inicio === -1) return [];
  const abre = fonte.indexOf('{', inicio);

  let profundidade = 0;
  let fim = abre;
  for (let i = abre; i < fonte.length; i++) {
    if (fonte[i] === '{') profundidade++;
    else if (fonte[i] === '}') {
      profundidade--;
      if (profundidade === 0) {
        fim = i;
        break;
      }
    }
  }

  const corpo = fonte.slice(abre + 1, fim);
  const campos: string[] = [];
  for (const linha of corpo.split('\n')) {
    // Só o primeiro nível: um campo é `nome:` ou `nome?:` na coluna 2.
    const m = /^ {2}([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:/.exec(linha);
    if (m) campos.push(m[1]);
  }
  return campos;
}

const ARQUIVOS = PASTAS_DE_CONSUMO.flatMap((p) => listarArquivos(join(RAIZ, p)));

/**
 * Os nomes tirados de um `const { ... } = useKiteData()` em cada arquivo.
 *
 * A primeira versão deste teste só procurava a palavra em qualquer lugar do
 * projeto, e isso o tornava inútil: um campo chamado `downwinds` "passava"
 * porque a palavra aparecia como nome de prop num componente que ninguém
 * tinha ligado ao contexto. O teste dava verde com o defeito presente — o
 * mesmo pecado dos testes que ele existe para substituir.
 *
 * Consumir de verdade é DESESTRUTURAR DO HOOK. É isso que se procura aqui.
 */
function nomesDesestruturadosDoHook(fonte: string, hook: string): Set<string> {
  const nomes = new Set<string>();
  const re = new RegExp(`(?:const|let)\\s*\\{([^}]*)\\}\\s*=\\s*${hook}\\s*\\(`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(fonte))) {
    for (const parte of m[1].split(',')) {
      // `campo: apelido` conta como uso do campo, não do apelido.
      const nome = parte.split(':')[0].trim();
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(nome)) nomes.add(nome);
    }
  }
  return nomes;
}

function temConsumidorForaDoContexto(
  campo: string,
  arquivoDoContexto: string,
  hook: string
): boolean {
  for (const arquivo of ARQUIVOS) {
    if (arquivo === arquivoDoContexto) continue;
    if (nomesDesestruturadosDoHook(readFileSync(arquivo, 'utf8'), hook).has(campo)) return true;
  }
  return false;
}

const CONTEXTOS: { arquivo: string; interfaceName: string; hook: string }[] = [
  {
    arquivo: join(RAIZ, 'context', 'KiteDataContext.tsx'),
    interfaceName: 'KiteDataContextType',
    hook: 'useKiteData',
  },
];

describe('valor exposto em contexto tem quem o consuma', () => {
  for (const { arquivo, interfaceName, hook } of CONTEXTOS) {
    const fonte = readFileSync(arquivo, 'utf8');
    const campos = camposDaInterface(fonte, interfaceName);

    it(`${interfaceName} foi lida (o teste não pode passar por não achar nada)`, () => {
      expect(campos.length).toBeGreaterThan(10);
    });

    it(`todo campo de ${interfaceName} é usado por alguma tela`, () => {
      const orfaos = campos.filter((c) => !temConsumidorForaDoContexto(c, arquivo, hook));
      expect(orfaos, `expostos e nunca consumidos: ${orfaos.join(', ')}`).toEqual([]);
    });
  }
});
