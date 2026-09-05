import { readFileSync } from 'node:fs';
/**
 * Testes das regras do Downwind.
 *
 * `podeEncerrarDownwind` é a regra de vida ou morte da feature: se ela
 * liberar o encerramento com um velejador ainda na água, essa pessoa pode
 * ficar para trás sem ninguém saber. Por isso a cobertura de casos de borda
 * aqui é deliberadamente exaustiva e hostil, no mesmo espírito de
 * lib/chat.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  DownwindParticipante,
  contarSemSinal,
  estadoDeSaidaVelejo,
  estadoSinal,
  podeEncerrarDownwind,
  podeTransicionarDownwind,
  podeTransicionarParticipante,
  progressoDownwind,
  clampAlturaMapaSplitApoio,
  velejadoresPendentes,
} from './downwind';

const velejador = (
  userId: string,
  estado: DownwindParticipante['estado'],
  ehOrganizador = false
): DownwindParticipante => ({ userId, papel: 'velejador', ehOrganizador, estado });

const apoio = (
  userId: string,
  estado: DownwindParticipante['estado'],
  ehOrganizador = false
): DownwindParticipante => ({ userId, papel: 'apoio_terra', ehOrganizador, estado });

describe('podeEncerrarDownwind — regra de vida ou morte', () => {
  it('sem nenhum participante, pode encerrar (nada para esperar)', () => {
    expect(podeEncerrarDownwind([])).toBe(true);
  });

  it(
    'CONTRATO: lista vazia libera o encerramento (.every de [] é true) — ' +
      'a rota chamadora deve garantir que a lista foi de fato carregada do ' +
      'banco antes de confiar neste true, senão uma falha de query vira ' +
      '"encerramento liberado" por acidente',
    () => {
      // Este teste documenta o comportamento fail-open deliberado descrito
      // no comentário de podeEncerrarDownwind em lib/downwind.ts. Ele passa
      // hoje e deve continuar passando — o ponto não é mudar o retorno, é
      // deixar registrado por que ele é perigoso se usado sem essa garantia
      // de camada superior.
      expect(podeEncerrarDownwind([])).toBe(true);
    }
  );

  it('sem nenhum velejador na lista (só apoio, incluindo organizador em terra), pode encerrar', () => {
    const participantes = [apoio('o1', 'confirmado', true), apoio('a1', 'confirmado')];
    expect(podeEncerrarDownwind(participantes)).toBe(true);
  });

  it('todos os velejadores encerrados, pode encerrar', () => {
    const participantes = [velejador('v1', 'encerrado'), velejador('v2', 'encerrado')];
    expect(podeEncerrarDownwind(participantes)).toBe(true);
  });

  it('todos os velejadores desistiram, pode encerrar', () => {
    const participantes = [velejador('v1', 'desistiu'), velejador('v2', 'desistiu')];
    expect(podeEncerrarDownwind(participantes)).toBe(true);
  });

  it('mistura de encerrado e desistiu entre velejadores, pode encerrar', () => {
    const participantes = [velejador('v1', 'encerrado'), velejador('v2', 'desistiu')];
    expect(podeEncerrarDownwind(participantes)).toBe(true);
  });

  it('um único velejador ainda navegando bloqueia, mesmo com todo o resto encerrado', () => {
    const participantes = [
      velejador('v1', 'encerrado'),
      velejador('v2', 'encerrado'),
      velejador('v3', 'navegando'),
    ];
    expect(podeEncerrarDownwind(participantes)).toBe(false);
  });

  it("velejador só 'confirmado' (nunca marcou 'navegando') BLOQUEIA o encerramento", () => {
    // Este é o caso mais perigoso: alguém pode estar na água de verdade sem
    // o app ter registrado a transição para 'navegando' (sinal ruim ao
    // entrar, esqueceu de abrir o app). Tratar 'confirmado' como "não conta"
    // deixaria essa pessoa passar despercebida.
    const participantes = [velejador('v1', 'confirmado')];
    expect(podeEncerrarDownwind(participantes)).toBe(false);
  });

  it('apoio em terra nunca bloqueia, mesmo em qualquer estado, mesmo sendo organizador', () => {
    const estados: DownwindParticipante['estado'][] = [
      'confirmado',
      'navegando',
      'encerrado',
      'desistiu',
    ];
    for (const estado of estados) {
      const participantes = [
        velejador('v1', 'encerrado'),
        apoio('a1', estado),
        apoio('o1', estado, true), // organizador em terra
      ];
      expect(
        podeEncerrarDownwind(participantes),
        `apoio/organizador-em-terra em '${estado}' não deveria bloquear`
      ).toBe(true);
    }
  });

  it('organizador que também veleja BLOQUEIA o encerramento enquanto não encerra', () => {
    // Este é o caso que o modelo anterior (papel: 'organizador' como valor
    // concorrente com 'velejador') deixava passar silenciosamente: o
    // organizador é justamente quem mais puxa o grupo na água, então
    // separá-lo do quórum por ser "organizador" era uma falha grave, não um
    // detalhe. Agora `papel` só descreve onde a pessoa está (água/terra) e
    // `ehOrganizador` é ortogonal — um organizador com papel 'velejador'
    // conta como qualquer outro velejador.
    const participantes = [velejador('o1', 'navegando', true)];
    expect(podeEncerrarDownwind(participantes)).toBe(false);
  });

  it('organizador que também veleja deixa de bloquear assim que encerra ou desiste', () => {
    for (const estado of ['encerrado', 'desistiu'] as const) {
      const participantes = [velejador('o1', estado, true)];
      expect(podeEncerrarDownwind(participantes), estado).toBe(true);
    }
  });

  it('lista grande e hostil: um único navegando entre dezenas de encerrados bloqueia', () => {
    const muitos = Array.from({ length: 50 }, (_, i) => velejador(`v${i}`, 'encerrado'));
    muitos.push(velejador('v-culpado', 'navegando'));
    expect(podeEncerrarDownwind(muitos)).toBe(false);
  });
});

describe('velejadoresPendentes — consistência com podeEncerrarDownwind', () => {
  it('lista vazia de pendentes implica podeEncerrarDownwind true, e vice-versa', () => {
    const casos: DownwindParticipante[][] = [
      [],
      [apoio('o1', 'confirmado', true), apoio('a1', 'navegando')],
      [velejador('v1', 'encerrado'), velejador('v2', 'desistiu')],
      [velejador('v1', 'confirmado')],
      [velejador('v1', 'navegando'), velejador('v2', 'encerrado')],
      [velejador('v1', 'encerrado'), velejador('v2', 'desistiu'), velejador('v3', 'navegando')],
      [velejador('o1', 'navegando', true)],
    ];

    for (const participantes of casos) {
      const pendentes = velejadoresPendentes(participantes);
      const pode = podeEncerrarDownwind(participantes);
      expect(pendentes.length === 0, JSON.stringify(participantes)).toBe(pode);
    }
  });

  it('retorna exatamente os velejadores bloqueantes, não apoio/organizador-em-terra', () => {
    const participantes = [
      velejador('v1', 'navegando'),
      velejador('v2', 'confirmado'),
      velejador('v3', 'encerrado'),
      apoio('a1', 'confirmado'),
      apoio('o1', 'confirmado', true),
    ];
    const pendentes = velejadoresPendentes(participantes);
    expect(pendentes.map((p) => p.userId).sort()).toEqual(['v1', 'v2']);
  });

  it('inclui organizador que veleja quando ele bloqueia', () => {
    const participantes = [velejador('v1', 'encerrado'), velejador('o1', 'navegando', true)];
    const pendentes = velejadoresPendentes(participantes);
    expect(pendentes.map((p) => p.userId)).toEqual(['o1']);
  });

  it('lista vazia devolve lista vazia', () => {
    expect(velejadoresPendentes([])).toEqual([]);
  });
});

describe('estadoSinal', () => {
  const agora = new Date('2026-08-16T12:00:00Z');

  it('ultimaPosicaoEm null é sem_sinal com minutosSemReportar null', () => {
    const r = estadoSinal(null, agora);
    expect(r.estado).toBe('sem_sinal');
    expect(r.minutosSemReportar).toBeNull();
  });

  it('minutosSemReportar null sobrevive a um round-trip de JSON (não vira Infinity nem quebra)', () => {
    // Regressão do bug real: `JSON.stringify({ x: Infinity })` produz
    // `'{"x":null}'`, então se este campo fosse `Infinity` a UI receberia
    // `null` de qualquer forma, sem o tipo avisar o consumidor. Usar `null`
    // no próprio tipo TypeScript torna esse `null` explícito e obrigatório
    // de tratar, em vez de uma surpresa silenciosa do transporte JSON.
    const original = estadoSinal(null, agora);
    const depoisDoRoundTrip = JSON.parse(JSON.stringify(original)) as typeof original;

    expect(depoisDoRoundTrip.minutosSemReportar).toBeNull();
    expect(depoisDoRoundTrip.estado).toBe('sem_sinal');
    expect(depoisDoRoundTrip).toEqual(original);
  });

  it('minutosSemReportar de um valor numérico normal também sobrevive ao round-trip', () => {
    const ultima = new Date(agora.getTime() - 5 * 60_000);
    const original = estadoSinal(ultima, agora);
    const depoisDoRoundTrip = JSON.parse(JSON.stringify(original)) as typeof original;
    expect(depoisDoRoundTrip).toEqual(original);
  });

  it('reportou agora mesmo é ok', () => {
    const r = estadoSinal(agora, agora);
    expect(r.estado).toBe('ok');
    expect(r.minutosSemReportar).toBe(0);
  });

  it('dentro de 3 minutos é ok (ciclos perdidos normais)', () => {
    for (const min of [0.5, 1, 2, 2.99]) {
      const ultima = new Date(agora.getTime() - min * 60_000);
      expect(estadoSinal(ultima, agora).estado, `${min}min`).toBe('ok');
    }
  });

  it('exatamente 3 minutos ainda é ok (fronteira inclusiva)', () => {
    const ultima = new Date(agora.getTime() - 3 * 60_000);
    expect(estadoSinal(ultima, agora).estado).toBe('ok');
  });

  it('logo acima de 3 minutos vira atrasado', () => {
    const ultima = new Date(agora.getTime() - (3 * 60_000 + 1));
    expect(estadoSinal(ultima, agora).estado).toBe('atrasado');
  });

  it('entre 3 e 8 minutos é atrasado', () => {
    for (const min of [3.5, 5, 7.99]) {
      const ultima = new Date(agora.getTime() - min * 60_000);
      expect(estadoSinal(ultima, agora).estado, `${min}min`).toBe('atrasado');
    }
  });

  it('exatamente 8 minutos ainda é atrasado (fronteira inclusiva)', () => {
    const ultima = new Date(agora.getTime() - 8 * 60_000);
    expect(estadoSinal(ultima, agora).estado).toBe('atrasado');
  });

  it('logo acima de 8 minutos vira sem_sinal', () => {
    const ultima = new Date(agora.getTime() - (8 * 60_000 + 1));
    expect(estadoSinal(ultima, agora).estado).toBe('sem_sinal');
  });

  it('muito acima de 8 minutos é sem_sinal', () => {
    for (const min of [10, 30, 120]) {
      const ultima = new Date(agora.getTime() - min * 60_000);
      expect(estadoSinal(ultima, agora).estado, `${min}min`).toBe('sem_sinal');
    }
  });

  it('minutosSemReportar reflete o tempo real decorrido', () => {
    const ultima = new Date(agora.getTime() - 5 * 60_000);
    expect(estadoSinal(ultima, agora).minutosSemReportar).toBeCloseTo(5, 5);
  });

  it('relógio adiantado (posição "no futuro") não produz minutos negativos', () => {
    const futuro = new Date(agora.getTime() + 5 * 60_000);
    const r = estadoSinal(futuro, agora);
    expect(r.minutosSemReportar).toBe(0);
    expect(r.estado).toBe('ok');
  });
});

describe('podeTransicionarDownwind', () => {
  it('fluxo feliz: aberto -> em_andamento -> encerrado', () => {
    expect(podeTransicionarDownwind('aberto', 'em_andamento')).toBe(true);
    expect(podeTransicionarDownwind('em_andamento', 'encerrado')).toBe(true);
  });

  it('cancelado é permitido a partir de aberto e de em_andamento', () => {
    expect(podeTransicionarDownwind('aberto', 'cancelado')).toBe(true);
    expect(podeTransicionarDownwind('em_andamento', 'cancelado')).toBe(true);
  });

  it("encerrado é terminal: não pode ir para nenhum outro estado", () => {
    for (const para of ['aberto', 'em_andamento', 'encerrado', 'cancelado'] as const) {
      expect(podeTransicionarDownwind('encerrado', para), para).toBe(false);
    }
  });

  it('cancelado é terminal: não pode ir para nenhum outro estado', () => {
    for (const para of ['aberto', 'em_andamento', 'encerrado', 'cancelado'] as const) {
      expect(podeTransicionarDownwind('cancelado', para), para).toBe(false);
    }
  });

  it('não pode pular direto de aberto para encerrado', () => {
    expect(podeTransicionarDownwind('aberto', 'encerrado')).toBe(false);
  });

  it('não pode voltar de em_andamento para aberto', () => {
    expect(podeTransicionarDownwind('em_andamento', 'aberto')).toBe(false);
  });

  it('não existe transição para o mesmo estado (não é no-op)', () => {
    for (const estado of ['aberto', 'em_andamento', 'encerrado', 'cancelado'] as const) {
      expect(podeTransicionarDownwind(estado, estado), estado).toBe(false);
    }
  });
});

describe('podeTransicionarParticipante', () => {
  it('fluxo feliz: confirmado -> navegando -> encerrado', () => {
    expect(podeTransicionarParticipante('confirmado', 'navegando')).toBe(true);
    expect(podeTransicionarParticipante('navegando', 'encerrado')).toBe(true);
  });

  it('desistiu é permitido a partir de confirmado e de navegando', () => {
    expect(podeTransicionarParticipante('confirmado', 'desistiu')).toBe(true);
    expect(podeTransicionarParticipante('navegando', 'desistiu')).toBe(true);
  });

  it("desistiu NÃO pode voltar direto para navegando", () => {
    // Regra de segurança: um velejador que já foi contado como fora d'água
    // não pode reaparecer navegando sem passar por uma nova confirmação
    // explícita.
    expect(podeTransicionarParticipante('desistiu', 'navegando')).toBe(false);
  });

  it('desistiu pode voltar para confirmado (reingresso via nova confirmação)', () => {
    expect(podeTransicionarParticipante('desistiu', 'confirmado')).toBe(true);
  });

  it('encerrado é terminal: não pode ir para nenhum outro estado', () => {
    for (const para of ['confirmado', 'navegando', 'encerrado', 'desistiu'] as const) {
      expect(podeTransicionarParticipante('encerrado', para), para).toBe(false);
    }
  });

  it('não pode pular direto de confirmado para encerrado', () => {
    expect(podeTransicionarParticipante('confirmado', 'encerrado')).toBe(false);
  });

  it('não existe transição para o mesmo estado (não é no-op)', () => {
    for (const estado of ['confirmado', 'navegando', 'encerrado', 'desistiu'] as const) {
      expect(podeTransicionarParticipante(estado, estado), estado).toBe(false);
    }
  });
});

describe('estadoDeSaidaVelejo — corrige o bug de participante preso no takeover', () => {
  it('quem está navegando termina a travessia (encerrado)', () => {
    expect(estadoDeSaidaVelejo('navegando')).toBe('encerrado');
  });

  it(
    "quem está 'confirmado' (nunca navegou — TODO apoio_terra, ou velejador " +
      "que ainda não tocou Iniciar) desiste, não encerra",
    () => {
      expect(estadoDeSaidaVelejo('confirmado')).toBe('desistiu');
    }
  );

  it(
    'OBRIGATÓRIO: nos dois estados em que o botão de saída fica visível na UI ' +
      '(confirmado, navegando — os únicos não-terminais), o alvo escolhido é ' +
      'sempre uma transição válida segundo podeTransicionarParticipante',
    () => {
      for (const estado of ['confirmado', 'navegando'] as const) {
        const alvo = estadoDeSaidaVelejo(estado);
        expect(podeTransicionarParticipante(estado, alvo), `${estado} -> ${alvo}`).toBe(true);
      }
    }
  );
});

describe('progressoDownwind', () => {
  const saida = { lat: -3.7, lng: -38.5 };
  const chegada = { lat: -3.6, lng: -38.4 };

  it('na saída, progresso é 0%', () => {
    const r = progressoDownwind(saida, chegada, saida);
    expect(r.percentual).toBeCloseTo(0, 5);
    expect(r.distanciaPercorridaKm).toBeCloseTo(0, 5);
  });

  it('na chegada, progresso é 100%', () => {
    const r = progressoDownwind(saida, chegada, chegada);
    expect(r.percentual).toBeCloseTo(100, 5);
    expect(r.distanciaRestanteKm).toBeCloseTo(0, 5);
  });

  it('a meio caminho (ponto médio), progresso é aproximadamente 50%', () => {
    const meio = { lat: (saida.lat + chegada.lat) / 2, lng: (saida.lng + chegada.lng) / 2 };
    const r = progressoDownwind(saida, chegada, meio);
    expect(r.percentual).toBeGreaterThan(45);
    expect(r.percentual).toBeLessThan(55);
  });

  it('saida igual a chegada: não divide por zero, resolve para 100%', () => {
    const r = progressoDownwind(saida, saida, saida);
    expect(r.distanciaTotalKm).toBe(0);
    expect(r.percentual).toBe(100);
    expect(Number.isFinite(r.percentual)).toBe(true);
  });

  it('saida igual a chegada, mas posição atual em outro lugar: ainda 100%, sem NaN/Infinity', () => {
    const outroLugar = { lat: -3.65, lng: -38.45 };
    const r = progressoDownwind(saida, saida, outroLugar);
    expect(r.percentual).toBe(100);
    expect(Number.isFinite(r.percentual)).toBe(true);
  });

  it('posição além da chegada satura o percentual em 100, não ultrapassa', () => {
    // Ponto na mesma direção do trajeto, porém além da chegada.
    const alemDaChegada = {
      lat: chegada.lat + (chegada.lat - saida.lat),
      lng: chegada.lng + (chegada.lng - saida.lng),
    };
    const r = progressoDownwind(saida, chegada, alemDaChegada);
    expect(r.percentual).toBe(100);
    expect(r.percentual).toBeLessThanOrEqual(100);
  });

  it('distanciaTotalKm e distanciaPercorridaKm nunca são negativas', () => {
    const r = progressoDownwind(saida, chegada, { lat: -10, lng: -50 });
    expect(r.distanciaTotalKm).toBeGreaterThanOrEqual(0);
    expect(r.distanciaPercorridaKm).toBeGreaterThanOrEqual(0);
    expect(r.distanciaRestanteKm).toBeGreaterThanOrEqual(0);
  });
});

describe('clampAlturaMapaSplitApoio — arraste do split mapa/chat do motorista', () => {
  it('valor dentro da faixa passa inalterado', () => {
    expect(clampAlturaMapaSplitApoio(50)).toBe(50);
    expect(clampAlturaMapaSplitApoio(20)).toBe(20);
    expect(clampAlturaMapaSplitApoio(80)).toBe(80);
  });

  it('arraste solto além do limite trava na borda, não desaparece o painel', () => {
    expect(clampAlturaMapaSplitApoio(-40)).toBe(20);
    expect(clampAlturaMapaSplitApoio(150)).toBe(80);
  });

  it('valor não-finito (NaN de um gesto interrompido) cai no meio, não trava a UI', () => {
    expect(clampAlturaMapaSplitApoio(NaN)).toBe(50);
    expect(clampAlturaMapaSplitApoio(Infinity)).toBe(50);
  });
});

/**
 * Guarda de código-fonte: cancelar também resume a travessia.
 *
 * POR QUE ESTE TESTE LÊ O ARQUIVO
 *
 * Encerrar exige quórum (`podeEncerrarDownwindComoUsuario` recusa com 409
 * enquanto houver velejador na água), então CANCELAR é o único caminho que
 * tira do ar um downwind com gente ainda em `navegando`. E o cancelamento não
 * chamava `resumirEPurgar`: distância, velocidade máxima e trilha de TODOS os
 * participantes ficavam NULL, e a purga preguiçosa apaga
 * `downwind_posicoes` de downwind cancelado depois de 7 dias.
 *
 * Uma chamada de função ausente num `if` não aparece em tipo, lint, teste de
 * unidade nem build — o código compila e responde 200. O que se perde só
 * aparece uma semana depois, no banco.
 */
describe('cancelar um downwind em andamento resume antes de sumir', () => {
  const ROTA = 'app/api/downwind/[id]/status/route.ts';

  /** Comentários fora: citar a função num comentário não é chamá-la. */
  const semComentarios = (texto: string) =>
    texto
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .map((linha) => linha.replace(/\/\/.*$/, ''))
      .join('\n');

  const trechoDoCancelamento = () => {
    const src = semComentarios(readFileSync(ROTA, 'utf8'));
    const i = src.indexOf("if (para === 'cancelado')");
    expect(i, 'ramo de cancelamento não encontrado').toBeGreaterThan(-1);
    const fim = src.indexOf("if (para === 'encerrado')", i);
    return src.slice(i, fim > i ? fim : src.indexOf('// para ===', i));
  };

  it('o ramo de cancelamento chama resumirEPurgar', () => {
    expect(trechoDoCancelamento()).toContain('resumirEPurgar(id)');
  });

  it('e só quando já havia travessia — downwind aberto não tem o que resumir', () => {
    expect(trechoDoCancelamento()).toMatch(/status === 'em_andamento'/);
  });
});

describe('contarSemSinal — o alarme não pode gritar por quem nem começou', () => {
  const agora = new Date('2026-09-05T12:00:00Z');
  const recente = new Date('2026-09-05T11:59:00Z').toISOString();
  const antigo = new Date('2026-09-05T11:00:00Z').toISOString();

  it('não conta quem confirmou e ainda não entrou na água', () => {
    // O caso real: dez confirmam na véspera, quatro entram às 8h, e a faixa
    // anunciava "6 sem sinal" sobre gente tomando café.
    const conta = contarSemSinal(
      [
        { estado: 'confirmado', registradoEm: null },
        { estado: 'confirmado', registradoEm: null },
        { estado: 'navegando', registradoEm: recente },
      ],
      agora
    );
    expect(conta).toBe(0);
  });

  it('não conta o apoio em terra, que nunca reporta posição', () => {
    expect(contarSemSinal([{ estado: 'confirmado', registradoEm: null }], agora)).toBe(0);
  });

  it('não conta quem já saiu da água', () => {
    for (const estado of ['encerrado', 'desistiu']) {
      expect(contarSemSinal([{ estado, registradoEm: antigo }], agora), estado).toBe(0);
    }
  });

  it('CONTA quem estava reportando e parou — é para isso que o alarme existe', () => {
    expect(contarSemSinal([{ estado: 'navegando', registradoEm: antigo }], agora)).toBe(1);
  });

  it('CONTA quem tocou Iniciar e nunca reportou — o GPS não subiu', () => {
    // Dizer "estou na água" e não mandar posição nenhuma é alarmante de
    // verdade, ao contrário de nem ter começado.
    expect(contarSemSinal([{ estado: 'navegando', registradoEm: null }], agora)).toBe(1);
  });

  it('não conta quem reportou agora há pouco', () => {
    expect(contarSemSinal([{ estado: 'navegando', registradoEm: recente }], agora)).toBe(0);
  });
});
