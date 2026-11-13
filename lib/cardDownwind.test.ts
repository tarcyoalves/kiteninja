import { describe, expect, it } from 'vitest';
import { acoesDoCardDownwind } from './cardDownwind';

const base = { podeVerSemParticipar: false };

describe('acoesDoCardDownwind — T11, opção A', () => {
  it('quem já encerrou, com o grupo ainda na água: ASSISTIR, e não "entrar"', () => {
    const a = acoesDoCardDownwind({
      ...base,
      status: 'em_andamento',
      meuPapel: 'velejador',
      meuEstado: 'encerrado',
    });
    // O defeito: aqui o botão principal era "entrar", que devolvia a pessoa
    // ao quórum e travava o encerramento do grupo.
    expect(a.principal).toBe('assistir');
    expect(a.jaEncerrei).toBe(true);
  });

  it('quem já encerrou não recebe "Só assistir": virar espectador apagaria o lugar no resumo', () => {
    const a = acoesDoCardDownwind({
      ...base,
      status: 'em_andamento',
      meuPapel: 'velejador',
      meuEstado: 'encerrado',
    });
    expect(a.virarEspectador).toBe(false);
  });

  it('voltar para a água continua possível, como gesto separado', () => {
    const a = acoesDoCardDownwind({
      ...base,
      status: 'em_andamento',
      meuPapel: 'velejador',
      meuEstado: 'encerrado',
    });
    expect(a.voltarParaAgua).toBe(true);
    // E sem botão duplicado para o mesmo mapa.
    expect(a.mapaAoVivo).toBe(false);
  });

  it('apoio em terra que já encerrou também só assiste', () => {
    const a = acoesDoCardDownwind({
      ...base,
      status: 'em_andamento',
      meuPapel: 'apoio_terra',
      meuEstado: 'encerrado',
    });
    expect(a.principal).toBe('assistir');
  });

  it.each(['confirmado', 'navegando'])('quem está na travessia (%s) segue vendo "entrar"', (estado) => {
    const a = acoesDoCardDownwind({
      ...base,
      status: 'em_andamento',
      meuPapel: 'velejador',
      meuEstado: estado,
    });
    expect(a.principal).toBe('entrar');
    expect(a.jaEncerrei).toBe(false);
    expect(a.voltarParaAgua).toBe(false);
    expect(a.mapaAoVivo).toBe(true);
  });

  it('quem desistiu pode reentrar normalmente (comportamento de antes)', () => {
    const a = acoesDoCardDownwind({
      ...base,
      status: 'em_andamento',
      meuPapel: 'velejador',
      meuEstado: 'desistiu',
    });
    expect(a.principal).toBe('entrar');
    expect(a.jaEncerrei).toBe(false);
  });

  it('quem não participa: entrar e só assistir; mapa só se puder ver', () => {
    const fechado = acoesDoCardDownwind({
      status: 'em_andamento',
      meuPapel: null,
      meuEstado: null,
      podeVerSemParticipar: false,
    });
    expect(fechado.principal).toBe('entrar');
    expect(fechado.virarEspectador).toBe(true);
    expect(fechado.mapaAoVivo).toBe(false);

    const publico = acoesDoCardDownwind({
      status: 'em_andamento',
      meuPapel: null,
      meuEstado: null,
      podeVerSemParticipar: true,
    });
    expect(publico.mapaAoVivo).toBe(true);
  });

  it('espectador não recebe de novo o botão de virar espectador', () => {
    const a = acoesDoCardDownwind({
      ...base,
      status: 'em_andamento',
      meuPapel: 'espectador',
      meuEstado: 'confirmado',
    });
    expect(a.virarEspectador).toBe(false);
    expect(a.mapaAoVivo).toBe(true);
    expect(a.jaEncerrei).toBe(false);
  });

  it('downwind agendado: ninguém "já encerrou", e não há mapa ao vivo', () => {
    const a = acoesDoCardDownwind({
      ...base,
      status: 'aberto',
      meuPapel: 'velejador',
      // Estado impossível na prática; a regra não pode se confundir com ele.
      meuEstado: 'encerrado',
    });
    expect(a.principal).toBe('entrar');
    expect(a.jaEncerrei).toBe(false);
    expect(a.mapaAoVivo).toBe(false);
  });

  it.each(['encerrado', 'cancelado', null, undefined])('downwind %s: nenhum botão', (status) => {
    const a = acoesDoCardDownwind({
      ...base,
      status,
      meuPapel: 'velejador',
      meuEstado: 'encerrado',
    });
    expect(a).toEqual({
      principal: null,
      voltarParaAgua: false,
      virarEspectador: false,
      mapaAoVivo: false,
      jaEncerrei: false,
    });
  });
});
