import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  VISIBILIDADE_PADRAO,
  apareceNaAgendaPublica,
  normalizarVisibilidade,
  podeNotificarSeguidores,
  podeVerEvento,
  textoDoAviso,
} from './downwindVisibilidade';

describe('normalizarVisibilidade', () => {
  it('aceita os dois valores do schema, com espaço e caixa variada', () => {
    expect(normalizarVisibilidade('privado')).toBe('privado');
    expect(normalizarVisibilidade('comunidade')).toBe('comunidade');
    expect(normalizarVisibilidade('  COMUNIDADE ')).toBe('comunidade');
  });

  it('devolve null para qualquer coisa que não seja exatamente um dos dois', () => {
    // O ponto: nada vira 'comunidade' por aproximação. Um cliente antigo
    // mandando 'publico' tem que ser recusado, não interpretado — publicar a
    // localização de um grupo por adivinhação é o defeito que este módulo
    // existe para impedir.
    for (const ruim of ['publico', 'aberto', 'public', '', '   ', 'priv', null, undefined, 3, {}]) {
      expect(normalizarVisibilidade(ruim)).toBeNull();
    }
  });
});

describe('padrão de visibilidade', () => {
  it('é privado — ausência de escolha nunca publica localização', () => {
    // Este teste protege uma decisão, não um comportamento acidental: ver o
    // bloco "SOBRE O PADRÃO SER 'privado'" no módulo. Se alguém trocar para
    // 'comunidade' achando que conserta o relato do dono, reprova aqui.
    expect(VISIBILIDADE_PADRAO).toBe('privado');
  });
});

describe('apareceNaAgendaPublica', () => {
  it('só comunidade entra na agenda de todo mundo', () => {
    expect(apareceNaAgendaPublica('comunidade')).toBe(true);
    expect(apareceNaAgendaPublica('privado')).toBe(false);
  });
});

describe('podeNotificarSeguidores', () => {
  const base = {
    visibilidade: 'comunidade' as const,
    ehOrganizador: true,
    statusDownwind: 'aberto',
    notificadoEm: null,
  };

  it('libera o organizador de um downwind de comunidade ainda aberto', () => {
    expect(podeNotificarSeguidores(base).permitido).toBe(true);
  });

  it('recusa quem não organiza', () => {
    const v = podeNotificarSeguidores({ ...base, ehOrganizador: false });
    expect(v.permitido).toBe(false);
    expect(v.motivo).toMatch(/organizador/i);
  });

  it('recusa downwind fechado — é o vazamento que a opção existe para impedir', () => {
    const v = podeNotificarSeguidores({ ...base, visibilidade: 'privado' });
    expect(v.permitido).toBe(false);
    expect(v.motivo).toMatch(/fechado/i);
  });

  it('recusa quando a travessia não está mais aberta', () => {
    for (const status of ['em_andamento', 'encerrado', 'cancelado']) {
      expect(podeNotificarSeguidores({ ...base, statusDownwind: status }).permitido).toBe(false);
    }
  });

  it('recusa o segundo disparo', () => {
    // Push repetido faz o usuário desligar TODAS as notificações do app,
    // inclusive as de SOS. Por isso a trava é dura, não um intervalo.
    const v = podeNotificarSeguidores({ ...base, notificadoEm: '2026-09-02T12:00:00.000Z' });
    expect(v.permitido).toBe(false);
    expect(v.motivo).toMatch(/já foi avisada/i);
  });

  it('devolve motivo vazio só quando permite', () => {
    expect(podeNotificarSeguidores(base).motivo).toBe('');
    expect(podeNotificarSeguidores({ ...base, ehOrganizador: false }).motivo).not.toBe('');
  });
});

describe('textoDoAviso', () => {
  it('põe trajeto e horário no corpo — é o que decide se a pessoa vai', () => {
    const { titulo, corpo } = textoDoAviso({
      nomeDownwind: 'Galinhos / Pernambuquinho',
      organizador: 'Jefferson',
      trajeto: 'Galinhos → Barra de Pernambuquinho',
      quando: '05/09 08:19',
    });
    expect(titulo).toContain('Galinhos / Pernambuquinho');
    expect(corpo).toContain('Jefferson');
    expect(corpo).toContain('Galinhos → Barra de Pernambuquinho');
    expect(corpo).toContain('05/09 08:19');
  });

  it('não deixa separador solto quando falta trajeto ou horário', () => {
    const so = textoDoAviso({
      nomeDownwind: 'Teste',
      organizador: 'Ana',
      trajeto: null,
      quando: null,
    });
    expect(so.corpo).toBe('Organizado por Ana');
    expect(so.corpo).not.toContain('•');

    const meio = textoDoAviso({
      nomeDownwind: 'Teste',
      organizador: 'Ana',
      trajeto: 'Ponta do Mel → Galinhos',
      quando: null,
    });
    expect(meio.corpo).toBe('Ana • Ponta do Mel → Galinhos');
    expect(meio.corpo).not.toMatch(/•\s*$/);
  });

  it('trata string vazia como ausência, não como parte a exibir', () => {
    const { corpo } = textoDoAviso({
      nomeDownwind: 'Teste',
      organizador: 'Ana',
      trajeto: '   ',
      quando: '',
    });
    expect(corpo).toBe('Organizado por Ana');
  });
});

/**
 * Guarda de código-fonte: a rota AINDA pergunta a visibilidade?
 *
 * O bug original não foi uma regra errada — foi uma coluna que o INSERT
 * simplesmente não mencionava. Nenhum teste de unidade, lint, tipo ou build
 * consegue ver isso: o SQL era válido, o TypeScript compilava, a rota
 * respondia 200. O downwind nascia fechado e sumia, em silêncio.
 *
 * A varredura de esquema (scripts/verify-sql.ts) também não pega, porque ela
 * troca todo `${...}` por NULL antes de validar — ou seja, ela prova que a
 * coluna EXISTE, não que a rota a preenche.
 *
 * Por isso este teste lê o arquivo. É feio de propósito: o custo de voltar a
 * errar aqui é o dono criar um downwind que ninguém vê.
 */
describe('as rotas de criação preenchem a visibilidade', () => {
  const ROTAS = [
    'app/api/events/route.ts',
    'app/api/downwind/route.ts',
  ];

  for (const rota of ROTAS) {
    it(`${rota} passa visibilidade no INSERT de downwinds`, () => {
      const src = readFileSync(rota, 'utf8');
      const insert = src.match(/INSERT INTO downwinds[\s\S]{0,600}?RETURNING/);
      expect(insert, `nenhum INSERT INTO downwinds em ${rota}`).not.toBeNull();
      const corpo = insert![0];
      expect(corpo).toContain('visibilidade');
      // A lista de colunas e a de VALUES têm que casar: mencionar a coluna e
      // esquecer o valor é justamente o erro que o Postgres não reclama, se
      // sobrar uma posição.
      expect(corpo).toMatch(/\$\{visibilidade\}/);
    });

    it(`${rota} valida o valor em vez de confiar na string do cliente`, () => {
      const src = readFileSync(rota, 'utf8');
      expect(src).toContain('normalizarVisibilidade');
    });
  }
});

describe('podeVerEvento', () => {
  const base = {
    visibilidadeDoDownwind: null as 'privado' | 'comunidade' | null,
    souCriadorDoDownwind: false,
    souParticipanteDoDownwind: false,
  };

  it('evento comum (sem downwind) é de todo mundo', () => {
    expect(podeVerEvento(base)).toBe(true);
  });

  it('downwind de comunidade é de todo mundo', () => {
    expect(podeVerEvento({ ...base, visibilidadeDoDownwind: 'comunidade' })).toBe(true);
  });

  it('downwind fechado: estranho não vê', () => {
    // É o caso que importa: sem isto, quem tivesse o id do evento veria quem
    // vai estar naquele downwind, onde e quando.
    expect(podeVerEvento({ ...base, visibilidadeDoDownwind: 'privado' })).toBe(false);
  });

  it('downwind fechado: criador e participante veem', () => {
    expect(
      podeVerEvento({ ...base, visibilidadeDoDownwind: 'privado', souCriadorDoDownwind: true })
    ).toBe(true);
    expect(
      podeVerEvento({ ...base, visibilidadeDoDownwind: 'privado', souParticipanteDoDownwind: true })
    ).toBe(true);
  });
});

/**
 * Guarda de código-fonte: criar downwind ABERTO não exige cargo.
 *
 * O relato: "tentei criar um dw com um usuário comum e só permite criar
 * privado". A causa era `requireDownwindOrganizer()` no ramo `comunidade` —
 * admin, moderador, instrutor ou a liberação pontual. Combinar uma travessia
 * com os amigos não é ato administrativo.
 *
 * O teste lê o arquivo porque é uma regra de PERMISSÃO em duas rotas
 * diferentes: nada em tipo, lint ou teste de unidade acusa alguém devolvendo a
 * trava para uma delas, e a que sobrasse fechada voltaria a produzir o mesmo
 * relato — só que pela outra porta.
 *
 * E confere o par: sem o cargo, quem segura volume é o limite de criação.
 * Tirar um sem pôr o outro abriria criação pública sem teto.
 */
describe('qualquer velejador cria downwind aberto', () => {
  const PORTAS = [
    'app/api/downwind/route.ts',
    'app/api/events/route.ts',
  ];

  const semComentarios = (texto: string) =>
    texto
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .map((linha) => linha.replace(/\/\/.*$/, ''))
      .join('\n');

  for (const porta of PORTAS) {
    it(`${porta} não exige cargo de organizador`, () => {
      const src = semComentarios(readFileSync(porta, 'utf8'));
      expect(src).not.toContain('requireDownwindOrganizer');
    });

    it(`${porta} mantém o limite de criação, que é o que segura abuso agora`, () => {
      const src = semComentarios(readFileSync(porta, 'utf8'));
      expect(src).toContain('rateLimiters.downwindCriar');
    });
  }
});

/**
 * Guarda de código-fonte: o aviso chega a quem NÃO tem push.
 *
 * O relato foi "avisar aos amigos sobre o dw não funcionou". A rota existia,
 * respondia 200 e estava correta — só que o aviso era **exclusivamente** push.
 * Push exige assinatura do navegador: permissão concedida, service worker
 * vivo, e no iPhone o app instalado na tela inicial. Quem não tem nada disso —
 * a maioria — não recebia absolutamente nada: nem notificação, nem badge, nem
 * rastro.
 *
 * A tabela `notifications` e o sininho já existiam. Só este aviso é que não
 * passava por lá.
 *
 * O teste lê o arquivo porque nada em tipo, lint ou teste de unidade distingue
 * "avisou" de "tentou avisar por um canal que a pessoa não tem".
 */
describe('o aviso de downwind novo não depende só de push', () => {
  const ROTA = 'app/api/downwind/[id]/notificar/route.ts';

  const semComentarios = (texto: string) =>
    texto
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .map((linha) => linha.replace(/\/\/.*$/, ''))
      .join('\n');

  const src = () => semComentarios(readFileSync(ROTA, 'utf8'));

  it('grava notificação dentro do app, não só push', () => {
    expect(src()).toMatch(/INSERT INTO notifications/);
    expect(src()).toContain("'downwind_novo'");
  });

  it('continua mandando push também — os dois canais, não a troca de um pelo outro', () => {
    expect(src()).toContain('sendPushToUsers');
  });

  it('não queima a chance única quando não há ninguém para avisar', () => {
    /*
     * A ordem é o bug: marcar `notificado_em` ANTES de saber se existe
     * destinatário travava o botão para sempre sem ninguém ter sido avisado —
     * e a tela dizia que deu certo. Quem acabou de entrar no app não tem
     * seguidores, então esse era o caminho mais provável do relato.
     */
    const corpo = src();
    const buscaSeguidores = corpo.indexOf('FROM user_follows');
    const marca = corpo.indexOf('SET notificado_em');
    expect(buscaSeguidores, 'busca de seguidores não encontrada').toBeGreaterThan(-1);
    expect(marca, 'marca de notificado_em não encontrada').toBeGreaterThan(-1);
    expect(buscaSeguidores).toBeLessThan(marca);
  });
});
