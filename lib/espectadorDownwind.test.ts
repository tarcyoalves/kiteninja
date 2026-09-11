import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { podeEncerrarDownwind, transmitePosicao, velejadoresPendentes } from './downwind';
import {
  apareceNoMapa,
  apoioValido,
  podeIniciarDownwind,
  podeReportarPosicao,
  podeVerPosicoes,
  podeVerReplayAoVivo,
} from './downwindAcesso';
import { determinarAtividadeAtual, mapaMostraDownwind, souParticipanteDaAgua } from './activity';

const semComentarios = (texto: string) =>
  texto
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((linha) => linha.replace(/\/\/.*$/, ''))
    .join('\n');

const espectador = {
  papel: 'espectador' as const,
  estado: 'confirmado' as const,
  ehOrganizador: false,
  apoioUserId: null,
};

/**
 * "Criei um dw porém quero opção de apenas visualizar os velejadores, no caso
 * de eu não poder ir ao evento."
 *
 * Antes só existiam dois lugares para estar: na água ou no carro de apoio.
 * Quem cria o downwind entra como VELEJADOR — então o organizador que não
 * podia ir ficava contado como gente na água, de casa, e o quórum de
 * encerramento esperava por ele: o grupo inteiro chegava na praia e não
 * conseguia fechar o downwind.
 *
 * O espectador é o terceiro lugar. Ele vê tudo e não interfere em nada.
 */
describe('espectador de downwind', () => {
  it('não entra no quórum: o grupo encerra sem esperar por quem ficou em casa', () => {
    const participantes = [
      { userId: 'a', papel: 'velejador' as const, ehOrganizador: false, estado: 'encerrado' as const },
      { userId: 'org', papel: 'espectador' as const, ehOrganizador: true, estado: 'confirmado' as const },
    ];
    expect(velejadoresPendentes(participantes)).toEqual([]);
    expect(podeEncerrarDownwind(participantes)).toBe(true);
  });

  it('o MESMO organizador como velejador trava o encerramento (o bug relatado)', () => {
    const participantes = [
      { userId: 'a', papel: 'velejador' as const, ehOrganizador: false, estado: 'encerrado' as const },
      { userId: 'org', papel: 'velejador' as const, ehOrganizador: true, estado: 'confirmado' as const },
    ];
    expect(velejadoresPendentes(participantes)).toHaveLength(1);
    expect(podeEncerrarDownwind(participantes)).toBe(false);
  });

  it('não transmite posição, nem o servidor aceita', () => {
    expect(transmitePosicao('espectador')).toBe(false);
    expect(transmitePosicao('velejador')).toBe(true);
    expect(transmitePosicao('apoio_terra')).toBe(true);

    const veredito = podeReportarPosicao({
      statusDownwind: 'em_andamento',
      participacao: espectador,
    });
    expect(veredito.permitido).toBe(false);
    expect(veredito.status).toBe(403);
  });

  it('não vira marcador no mapa dos outros', () => {
    expect(apareceNoMapa('espectador', 'confirmado')).toBe(false);
    expect(apareceNoMapa('espectador', 'navegando')).toBe(false);
    expect(apareceNoMapa('velejador', 'navegando')).toBe(true);
    // A trava antiga (só o estado) continua valendo para quem saiu da água.
    expect(apareceNoMapa('velejador', 'encerrado')).toBe(false);
  });

  it('VÊ o mapa — é para isso que ele existe', () => {
    expect(
      podeVerPosicoes({ statusDownwind: 'em_andamento', participacao: espectador }).permitido
    ).toBe(true);
    expect(
      podeVerReplayAoVivo({ visibilidade: 'privado', participacao: espectador, ehModerador: false })
    ).toBe(true);
  });

  it('não inicia a travessia do grupo', () => {
    const v = podeIniciarDownwind({ statusDownwind: 'aberto', participacao: espectador });
    expect(v.permitido).toBe(false);
    expect(v.status).toBe(403);
  });

  it('não pode ser carro de apoio de ninguém, nem ter um', () => {
    // Ser escolhido como apoio: só apoio_terra passa nesse filtro.
    expect(
      apoioValido({
        alvoUserId: 'v1',
        alvoPapel: 'velejador',
        apoioUserId: 'esp',
        participantes: [
          { userId: 'v1', papel: 'velejador' },
          { userId: 'esp', papel: 'espectador' },
        ],
      }).permitido
    ).toBe(false);

    // Ter um apoio: quem não entra na água não precisa de carro na praia.
    expect(
      apoioValido({
        alvoUserId: 'esp',
        alvoPapel: 'espectador',
        apoioUserId: 'carro',
        participantes: [
          { userId: 'esp', papel: 'espectador' },
          { userId: 'carro', papel: 'apoio_terra' },
        ],
      }).permitido
    ).toBe(false);
  });

  it('a aba Mapa não é sequestrada por uma travessia que ele não está fazendo', () => {
    expect(souParticipanteDaAgua('espectador', 'confirmado')).toBe(false);
    expect(souParticipanteDaAgua('velejador', 'confirmado')).toBe(true);

    const dw = {
      status: 'em_andamento',
      minhaParticipacao: { estado: 'confirmado', papel: 'espectador' },
    };
    expect(mapaMostraDownwind({ downwind: dw, abertoDeliberadamente: false })).toBe(false);
    // Mas ele continua podendo abrir a tela quando pede.
    expect(mapaMostraDownwind({ downwind: dw, abertoDeliberadamente: true })).toBe(true);
  });

  it('não é impedido de iniciar o próprio velejo solo', () => {
    // O app dizia "você está na água no downwind X" para quem estava em casa.
    const estado = determinarAtividadeAtual({
      modoNavegacaoAtivo: false,
      downwindAtivo: {
        id: 'dw-1',
        nome: 'Jeri → Preá',
        status: 'em_andamento',
        minhaParticipacao: { estado: 'confirmado', papel: 'espectador' },
      },
    });
    expect(estado.podeIniciarOutra).toBe(true);
  });

  it('fica fora da lista de socorristas do SOS', () => {
    // Não é filtro de tela: é uma condição na própria consulta. Uma lista de
    // resgate inflada com quem não pode chegar faz parecer que gente está a
    // caminho quando não está.
    const src = semComentarios(readFileSync('lib/sosCandidates.ts', 'utf8'));
    expect(src).toContain("p.papel != 'espectador'");
    expect(src).toContain("eu.papel != 'espectador'");
  });

  it('as três rotas de mapa omitem o espectador da lista', () => {
    for (const arquivo of [
      'app/api/downwind/[id]/posicoes/route.ts',
      'app/api/downwind/[id]/live/route.ts',
      'app/api/downwind/[id]/resumo/route.ts',
    ]) {
      expect(semComentarios(readFileSync(arquivo, 'utf8'))).toContain("papel != 'espectador'");
    }
  });

  it('o banco aceita o papel novo', () => {
    const schema = readFileSync('lib/schema.sql', 'utf8');
    expect(schema).toContain("CHECK (papel IN ('velejador', 'apoio_terra', 'espectador'))");
  });

  it('a tela oferece "só assistir" e o beacon não liga para ele', () => {
    const view = semComentarios(readFileSync('views/EventsAndAlertsView.tsx', 'utf8'));
    expect(view).toMatch(/onClick=\{\(\) => handleAssistirDownwind\(/);

    const ctx = semComentarios(readFileSync('context/DownwindContext.tsx', 'utf8'));
    expect(ctx).toContain('emAndamento && !souEspectador');
  });

  it('não é chamado de "Apoio em terra" na tela do downwind', () => {
    // O rótulo era um ternário de dois braços: qualquer coisa que não fosse
    // 'velejador' virava "Apoio em terra". Chamar o espectador assim é
    // exatamente a confusão que este papel existe para evitar — apoio em
    // terra é o CARRO, e quem só assiste não prometeu carro a ninguém.
    const view = semComentarios(readFileSync('views/DownwindAoVivoView.tsx', 'utf8'));
    expect(view).toContain("'Só assistindo'");
    expect(view).toMatch(/papel === 'apoio_terra'\s*\?\s*'Apoio em terra'/);
  });

  it('tem como abrir o chat do grupo', () => {
    // Ele ficava sem os dois caminhos: o botão era exclusivo do velejador e o
    // split fixo é exclusivo do apoio_terra. Acompanhar a travessia sem poder
    // falar com quem está na água é metade do que a tela promete.
    const view = semComentarios(readFileSync('views/DownwindAoVivoView.tsx', 'utf8'));
    expect(view).toMatch(/papel !== 'apoio_terra' && \(\s*<button/);
  });

  it('participante de downwind PRIVADO enxerga o botão do mapa ao vivo', () => {
    // A trava antiga exigia visibilidade 'comunidade' e escondia o botão de
    // quem participa — inclusive de quem criou o downwind.
    const view = semComentarios(readFileSync('views/EventsAndAlertsView.tsx', 'utf8'));
    expect(view).toContain('event.downwindMeuPapel != null');
  });
});
